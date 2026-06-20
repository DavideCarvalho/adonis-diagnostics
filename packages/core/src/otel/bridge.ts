import diagnostics_channel from 'node:diagnostics_channel';
import {
  type AttributeValue,
  type Attributes,
  type Span,
  SpanStatusCode,
  type Tracer,
  context,
  trace,
} from '@opentelemetry/api';
import { onChannelRegistered, registeredChannels } from '../registry.js';
import { parseChannelName } from '../relay.js';
import { traceChannelNames } from '../trace.js';
import type { DiagnosticEvent, SpanEvent } from '../types.js';
import { clearTraceparentSlot, publishTraceparentSlot } from './traceparent.js';

/** Resolved options for the bridge — every field defaulted by {@link start}. */
export interface BridgeOptions {
  /** Tracer name for `trace.getTracer(...)`. Default `@agora/diagnostics`. */
  tracerName?: string;
  /** Record POINT `emit`s as events on the active span. Default `true`. */
  recordPointEvents?: boolean;
  /** Cap on open (un-ended) spans before the oldest is force-ended. Default `10000`. */
  maxOpenSpans?: number;
}

const DEFAULT_TRACER_NAME = '@agora/diagnostics';
const DEFAULT_MAX_OPEN_SPANS = 10_000;

/** A live subscription so {@link stop} can tear it down. */
interface ActiveSub {
  name: string;
  listener: (msg: unknown) => void;
}

/** True when `value` is a valid OTel attribute value (primitive or array of them). */
function isAttributeValue(value: unknown): value is AttributeValue {
  if (value === null) return false;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return true;
  if (Array.isArray(value)) {
    return value.every((v) => {
      const it = typeof v;
      return v == null || it === 'string' || it === 'number' || it === 'boolean';
    });
  }
  return false;
}

/**
 * Flatten a payload's own enumerable scalar/array fields into namespaced span
 * attributes (`agora.payload.<key>`). Best-effort: non-objects and non-scalar
 * fields are skipped; never throws.
 */
function payloadAttributes(payload: unknown): Attributes {
  const attrs: Attributes = {};
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return attrs;
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (isAttributeValue(value)) attrs[`agora.payload.${key}`] = value;
  }
  return attrs;
}

/**
 * The OTel bridge. Subscribes to every `agora:<lib>:<event>` base channel (for
 * POINT events) and its five span sub-channels (for spans). Reconstructs an OTel
 * span per agora `spanId`: `start` opens a span (parented to `context.active()`
 * at publish time), `end`/`asyncEnd` close it OK, `error` records the exception
 * and closes it ERROR.
 *
 * Zero-overhead when no OTel SDK is registered: every `@opentelemetry/api` call
 * resolves to a no-op span/tracer, so the bridge still subscribes but produces
 * nothing. Safe to ship on by default.
 */
export class DiagnosticsOtelBridge {
  readonly #tracerName: string;
  readonly #recordPointEvents: boolean;
  readonly #maxOpenSpans: number;

  /** Lazily-resolved tracer — re-read each `start` so a late-registered SDK wins. */
  #tracer: Tracer | null = null;

  /** Open spans keyed by agora `spanId`. Insertion order = age, for the LRU cap. */
  readonly #open = new Map<string, Span>();

  readonly #subs: ActiveSub[] = [];
  #offRegistered: (() => void) | null = null;
  #started = false;

  constructor(opts: BridgeOptions = {}) {
    this.#tracerName = opts.tracerName ?? DEFAULT_TRACER_NAME;
    this.#recordPointEvents = opts.recordPointEvents ?? true;
    this.#maxOpenSpans = opts.maxOpenSpans ?? DEFAULT_MAX_OPEN_SPANS;
  }

  /** Number of currently-open (un-ended) spans. Exposed for tests/introspection. */
  get openSpanCount(): number {
    return this.#open.size;
  }

  #tracerFor(): Tracer {
    if (this.#tracer === null) this.#tracer = trace.getTracer(this.#tracerName);
    return this.#tracer;
  }

  /**
   * Subscribe to all current + future agora channels and publish the global
   * traceparent slot. Idempotent.
   */
  start(): void {
    if (this.#started) return;
    this.#started = true;

    for (const base of registeredChannels()) this.#subscribeBase(base);
    this.#offRegistered = onChannelRegistered((name) => this.#subscribeBase(name));

    publishTraceparentSlot();
  }

  /** Unsubscribe everything, force-end any open spans, and clear the global slot. */
  stop(): void {
    if (!this.#started) return;
    this.#started = false;

    this.#offRegistered?.();
    this.#offRegistered = null;
    for (const { name, listener } of this.#subs) {
      diagnostics_channel.channel(name).unsubscribe(listener);
    }
    this.#subs.length = 0;

    for (const span of this.#open.values()) {
      try {
        span.end();
      } catch {
        // Defensive cleanup must never throw.
      }
    }
    this.#open.clear();

    clearTraceparentSlot();
  }

  /** Subscribe the POINT base channel and its five span sub-channels. */
  #subscribeBase(base: string): void {
    const point = (msg: unknown) => this.#onPoint(msg as DiagnosticEvent);
    this.#subscribe(base, point);

    const names = deriveSpanChannels(base);
    if (names === null) return;
    const span = (msg: unknown) => this.#onSpan(msg as SpanEvent);
    this.#subscribe(names.start, span);
    this.#subscribe(names.end, span);
    this.#subscribe(names.asyncStart, span);
    this.#subscribe(names.asyncEnd, span);
    this.#subscribe(names.error, span);
  }

  #subscribe(name: string, listener: (msg: unknown) => void): void {
    diagnostics_channel.channel(name).subscribe(listener);
    this.#subs.push({ name, listener });
  }

  /** Handle a POINT event: add it to the active span as an event, best-effort. */
  #onPoint(event: DiagnosticEvent): void {
    if (!this.#recordPointEvents) return;
    try {
      const active = trace.getActiveSpan();
      if (active === undefined) return;
      const attrs: Attributes = {
        'agora.lib': event.lib,
        'agora.event': event.event,
        ...payloadAttributes(event.payload),
      };
      active.addEvent(`agora.${event.lib}.${event.event}`, attrs, event.ts);
    } catch {
      // Observability must never break the emitting path.
    }
  }

  /** Handle one span phase event, mutating the per-spanId OTel span. */
  #onSpan(event: SpanEvent): void {
    try {
      switch (event.phase) {
        case 'start':
          this.#onStart(event);
          break;
        // `end` for a SYNC op completes the span; for an ASYNC op it only marks
        // the synchronous portion (asyncEnd carries the real result) — keep the
        // span open and let asyncEnd/error close it. We distinguish by presence:
        // the async `end` carries no `result`, only `durationMs`.
        case 'end':
          this.#onEnd(event, /* allowOpenForAsync */ true);
          break;
        case 'asyncStart':
          // The continuation began — nothing to record on the span itself.
          break;
        case 'asyncEnd':
          this.#onEnd(event, /* allowOpenForAsync */ false);
          break;
        case 'error':
          this.#onError(event);
          break;
      }
    } catch {
      // Never let span reconstruction break the traced path.
    }
  }

  #onStart(event: SpanEvent): void {
    const span = this.#tracerFor().startSpan(
      `agora.${event.lib}.${event.event}`,
      {
        startTime: event.ts,
        attributes: {
          'agora.lib': event.lib,
          'agora.event': event.event,
          ...(event.traceId !== undefined ? { 'agora.trace_id': event.traceId } : {}),
          ...payloadAttributes(event.payload),
        },
      },
      context.active(),
    );
    this.#open.set(event.spanId, span);
    this.#enforceCap();
  }

  /**
   * Close a span OK. `end` (sync) closes immediately; the async `end` phase has
   * no `result` and is followed by `asyncEnd` — so when `allowOpenForAsync` is
   * set and this looks like the async `end` (no `result` key present), we leave
   * the span open for `asyncEnd`. The async `end` and `asyncEnd` are
   * disambiguated by phase, so this is only consulted for `phase === 'end'`.
   */
  #onEnd(event: SpanEvent, allowOpenForAsync: boolean): void {
    const span = this.#open.get(event.spanId);
    if (span === undefined) return;

    // For phase 'end' that is the synchronous prelude of an async op, asyncEnd
    // will follow with the result — defer closing. The sync 'end' carries a
    // `result` key; the async 'end' does not.
    if (allowOpenForAsync && event.phase === 'end' && !('result' in event)) return;

    if (event.result !== undefined) {
      const resultAttr = scalarAttr(event.result);
      if (resultAttr !== undefined) span.setAttribute('agora.result', resultAttr);
    }
    if (event.durationMs !== undefined) {
      span.setAttribute('agora.duration_ms', event.durationMs);
    }
    span.setStatus({ code: SpanStatusCode.OK });
    this.#endSpan(event.spanId, span, event.ts);
  }

  #onError(event: SpanEvent): void {
    const span = this.#open.get(event.spanId);
    if (span === undefined) return;
    const err = event.error;
    if (err instanceof Error) {
      span.recordException(err);
    } else if (err !== undefined) {
      span.recordException({ message: String(err) });
    }
    if (event.durationMs !== undefined) {
      span.setAttribute('agora.duration_ms', event.durationMs);
    }
    span.setStatus({
      code: SpanStatusCode.ERROR,
      ...(err instanceof Error ? { message: err.message } : {}),
    });
    this.#endSpan(event.spanId, span, event.ts);
  }

  #endSpan(spanId: string, span: Span, ts: number): void {
    span.end(ts);
    this.#open.delete(spanId);
  }

  /** Force-end the oldest open spans when over the configured cap. */
  #enforceCap(): void {
    while (this.#open.size > this.#maxOpenSpans) {
      const oldest = this.#open.keys().next();
      if (oldest.done === true) break;
      const spanId = oldest.value;
      const span = this.#open.get(spanId);
      this.#open.delete(spanId);
      if (span === undefined) continue;
      try {
        span.setStatus({ code: SpanStatusCode.ERROR, message: 'span capped (no end observed)' });
        span.end();
      } catch {
        // Defensive cleanup must never throw.
      }
    }
  }
}

/** Coerce a result into a single scalar attribute, or `undefined` if unusable. */
function scalarAttr(value: unknown): AttributeValue | undefined {
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return value as AttributeValue;
  return undefined;
}

/**
 * Derive the five span sub-channel names from an `agora:<lib>:<event>` base
 * name, or `null` when the name doesn't match the convention. Parses the name
 * through the shared {@link parseChannelName} (single source of the lib/event
 * boundary) and builds the suffixes via {@link traceChannelNames}.
 */
function deriveSpanChannels(base: string): ReturnType<typeof traceChannelNames> | null {
  const ref = parseChannelName(base);
  if (ref === null) return null;
  return traceChannelNames(ref.lib, ref.event);
}
