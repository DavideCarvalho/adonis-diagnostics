import diagnostics_channel from 'node:diagnostics_channel';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { channelName } from '../src/channel.js';
import { setContextAccessor } from '../src/context_accessor.js';
import { resetRegistry } from '../src/registry.js';
import { SPAN_SCHEMA_VERSION, trace, traceChannelNames, tracingChannel } from '../src/trace.js';
import type { SpanEvent } from '../src/types.js';

/** Subscribe to a span sub-channel for the duration of a test. */
function capture(name: string): { events: SpanEvent[]; stop: () => void } {
  const events: SpanEvent[] = [];
  const channel = diagnostics_channel.channel(name);
  const onMessage = (msg: unknown) => events.push(msg as SpanEvent);
  channel.subscribe(onMessage);
  return { events, stop: () => channel.unsubscribe(onMessage) };
}

/** Capture all five span sub-channels for a (lib,event) pair. */
function captureAll(
  lib: string,
  event: string,
): {
  start: SpanEvent[];
  end: SpanEvent[];
  asyncStart: SpanEvent[];
  asyncEnd: SpanEvent[];
  error: SpanEvent[];
  stop: () => void;
} {
  const names = traceChannelNames(lib, event);
  const start = capture(names.start);
  const end = capture(names.end);
  const asyncStart = capture(names.asyncStart);
  const asyncEnd = capture(names.asyncEnd);
  const error = capture(names.error);
  return {
    start: start.events,
    end: end.events,
    asyncStart: asyncStart.events,
    asyncEnd: asyncEnd.events,
    error: error.events,
    stop: () => {
      start.stop();
      end.stop();
      asyncStart.stop();
      asyncEnd.stop();
      error.stop();
    },
  };
}

describe('trace', () => {
  let stop: (() => void) | undefined;

  beforeEach(() => {
    resetRegistry();
    setContextAccessor(null);
  });
  afterEach(() => {
    stop?.();
    stop = undefined;
    setContextAccessor(null);
  });

  it('uses the agora:<lib>:<event> naming convention for sub-channels', () => {
    const names = traceChannelNames('authz', 'decision');
    const base = channelName('authz', 'decision');
    expect(names.start).toBe(`${base}:start`);
    expect(names.end).toBe(`${base}:end`);
    expect(names.asyncStart).toBe(`${base}:asyncStart`);
    expect(names.asyncEnd).toBe(`${base}:asyncEnd`);
    expect(names.error).toBe(`${base}:error`);
  });

  it('sync success: publishes start + end with a result, no error/async', () => {
    const cap = captureAll('authz', 'decision');
    stop = cap.stop;

    const out = trace('authz', 'decision', () => ({ allow: true }), { subject: 'u1' });

    expect(out).toEqual({ allow: true });
    expect(cap.start).toHaveLength(1);
    expect(cap.end).toHaveLength(1);
    expect(cap.error).toHaveLength(0);
    expect(cap.asyncStart).toHaveLength(0);
    expect(cap.asyncEnd).toHaveLength(0);

    expect(cap.start[0]?.lib).toBe('authz');
    expect(cap.start[0]?.event).toBe('decision');
    expect(cap.start[0]?.phase).toBe('start');
    expect(cap.start[0]?.payload).toEqual({ subject: 'u1' });
    expect(cap.end[0]?.phase).toBe('end');
    expect(cap.end[0]?.result).toEqual({ allow: true });
    expect(typeof cap.end[0]?.durationMs).toBe('number');
    expect(cap.end[0]?.durationMs).toBeGreaterThanOrEqual(0);
    expect(cap.start[0]?.v).toBe(SPAN_SCHEMA_VERSION);
  });

  it('async success: publishes start + asyncEnd (and end) with timing', async () => {
    const cap = captureAll('durable', 'step');
    stop = cap.stop;

    const out = await trace(
      'durable',
      'step',
      async () => {
        await new Promise((r) => setTimeout(r, 5));
        return 'ok';
      },
      { name: 'ship' },
    );

    expect(out).toBe('ok');
    expect(cap.start).toHaveLength(1);
    expect(cap.asyncEnd).toHaveLength(1);
    expect(cap.error).toHaveLength(0);
    expect(cap.asyncEnd[0]?.phase).toBe('asyncEnd');
    expect(cap.asyncEnd[0]?.result).toBe('ok');
    expect(cap.asyncEnd[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('sync throw: publishes start + error, re-throws to the caller', () => {
    const cap = captureAll('authz', 'decision');
    stop = cap.stop;

    const boom = new Error('denied');
    expect(() =>
      trace('authz', 'decision', () => {
        throw boom;
      }),
    ).toThrow('denied');

    expect(cap.start).toHaveLength(1);
    expect(cap.error).toHaveLength(1);
    expect(cap.error[0]?.phase).toBe('error');
    expect(cap.error[0]?.error).toBe(boom);
    expect(cap.end).toHaveLength(0);
  });

  it('async reject: publishes start + error, rejects to the caller', async () => {
    const cap = captureAll('durable', 'step');
    stop = cap.stop;

    const boom = new Error('step failed');
    await expect(
      trace('durable', 'step', async () => {
        throw boom;
      }),
    ).rejects.toThrow('step failed');

    expect(cap.start).toHaveLength(1);
    expect(cap.error).toHaveLength(1);
    expect(cap.error[0]?.error).toBe(boom);
  });

  it('fills traceId from the registered context accessor', () => {
    setContextAccessor({
      traceId: () => 'trace-xyz',
      tenantId: () => undefined,
      userRef: () => undefined,
      get: () => undefined,
    });
    const cap = captureAll('authz', 'decision');
    stop = cap.stop;

    trace('authz', 'decision', () => 1);

    expect(cap.start[0]?.traceId).toBe('trace-xyz');
    expect(cap.end[0]?.traceId).toBe('trace-xyz');
  });

  it('lets an explicit opts.traceId win over the accessor', () => {
    setContextAccessor({
      traceId: () => 'from-accessor',
      tenantId: () => undefined,
      userRef: () => undefined,
      get: () => undefined,
    });
    const cap = captureAll('authz', 'decision');
    stop = cap.stop;

    trace('authz', 'decision', () => 1, undefined, { traceId: 'explicit' });

    expect(cap.start[0]?.traceId).toBe('explicit');
  });

  it('correlates start/end/error of one span by a shared spanId', () => {
    const cap = captureAll('authz', 'decision');
    stop = cap.stop;

    trace('authz', 'decision', () => 1);

    const id = cap.start[0]?.spanId;
    expect(typeof id).toBe('string');
    expect(cap.end[0]?.spanId).toBe(id);
  });

  it('near-zero cost with no subscribers: still runs fn and returns, no throw', () => {
    let ran = 0;
    const out = trace('authz', 'no-listener', () => {
      ran++;
      return 'value';
    });
    expect(ran).toBe(1);
    expect(out).toBe('value');
  });

  it('with no subscribers an async op still resolves to fn result', async () => {
    const out = await trace('durable', 'no-listener', async () => {
      await new Promise((r) => setTimeout(r, 1));
      return 7;
    });
    expect(out).toBe(7);
  });

  it('registers the base channel for discovery when traced', async () => {
    const { registeredChannels } = await import('../src/registry.js');
    resetRegistry();
    trace('inertia', 'render', () => 1);
    expect(registeredChannels()).toContain(channelName('inertia', 'render'));
  });

  it('exposes a tracingChannel() factory bound to a (lib,event) pair', () => {
    const tc = tracingChannel('authz', 'decision');
    const cap = captureAll('authz', 'decision');
    stop = cap.stop;
    const out = tc.trace(() => 'z');
    expect(out).toBe('z');
    expect(cap.start).toHaveLength(1);
    expect(cap.end).toHaveLength(1);
  });
});
