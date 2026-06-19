import { type Context, context, propagation } from '@opentelemetry/api';

/**
 * The cross-copy-stable global slot the ecosystem reads {@link otelTraceparent}
 * from. Other Agora libs (e.g. `@agora/durable`) read
 * `globalThis[Symbol.for('@agora/otel:traceparent')]` STRUCTURALLY to continue
 * traces on remote steps, so they never import this package and no-op when it is
 * absent. Same decoupling contract as `@agora/diagnostics`'s `EMIT_SLOT`.
 */
export const TRACEPARENT_SLOT = Symbol.for('@agora/otel:traceparent');

type TraceparentFn = () => string | undefined;

/**
 * The current active span as a W3C `traceparent` string, or `undefined` when
 * there's no active span (or no propagator registered). Wire it into a durable
 * engine so remote steps continue the trace on the worker:
 *
 * ```ts
 * engine.configure({ traceparent: () => otelTraceparent() });
 * ```
 *
 * Uses the globally-registered OTel propagator (`propagation.inject`), so a
 * standard W3C setup (e.g. `@adonisjs/otel`) needs no extra wiring. With no SDK
 * registered, the no-op propagator injects nothing and this returns `undefined`.
 * Never throws.
 */
export function otelTraceparent(ctx: Context = context.active()): string | undefined {
  try {
    const carrier: Record<string, string> = {};
    propagation.inject(ctx, carrier);
    return carrier.traceparent;
  } catch {
    return undefined;
  }
}

/**
 * Publish {@link otelTraceparent} on the cross-copy-stable global slot so
 * `@agora/durable` (and any other consumer) can continue traces with zero
 * config. Idempotent.
 */
export function publishTraceparentSlot(): void {
  (globalThis as Record<symbol, unknown>)[TRACEPARENT_SLOT] = otelTraceparent as TraceparentFn;
}

/** Clear the global traceparent slot, if it currently holds our function. */
export function clearTraceparentSlot(): void {
  const store = globalThis as Record<symbol, unknown>;
  if (store[TRACEPARENT_SLOT] === otelTraceparent) {
    delete store[TRACEPARENT_SLOT];
  }
}
