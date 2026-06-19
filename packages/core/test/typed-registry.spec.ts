import diagnostics_channel from 'node:diagnostics_channel';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { channelName, emit } from '../src/channel.js';
import { setContextAccessor } from '../src/context_accessor.js';
import { resetRegistry } from '../src/registry.js';
import { trace } from '../src/trace.js';
import type { DiagnosticEvent, EventOf, LibOf, PayloadOf } from '../src/types.js';

/**
 * The typed-registry mechanism is declaration-merging based: a consuming library
 * augments {@link import('../src/types.js').ChannelRegistry} to declare its
 * `lib → event → payload` shapes. This test file augments it locally so the
 * type-level assertions below exercise the real merged surface.
 */
declare module '../src/types.js' {
  interface ChannelRegistry {
    billing: {
      'invoice-paid': { invoiceId: string; amount: number };
    };
    durable: {
      step: { name: string; attempt: number };
    };
  }
}

/** Subscribe to a channel for the duration of a test; returns captured envelopes. */
function capture(name: string): { events: DiagnosticEvent[]; stop: () => void } {
  const events: DiagnosticEvent[] = [];
  const channel = diagnostics_channel.channel(name);
  const onMessage = (msg: unknown) => events.push(msg as DiagnosticEvent);
  channel.subscribe(onMessage);
  return { events, stop: () => channel.unsubscribe(onMessage) };
}

describe('typed channel registry', () => {
  let stop: (() => void) | undefined;

  beforeEach(() => {
    resetRegistry();
    setContextAccessor(null);
  });
  afterEach(() => {
    stop?.();
    stop = undefined;
  });

  it('runtime: emit on a registered channel still publishes normally', () => {
    const cap = capture(channelName('billing', 'invoice-paid'));
    stop = cap.stop;

    // Type-checked payload: { invoiceId: string; amount: number }.
    emit('billing', 'invoice-paid', { invoiceId: 'inv_1', amount: 100 });

    expect(cap.events).toHaveLength(1);
    expect(cap.events[0]?.payload).toEqual({ invoiceId: 'inv_1', amount: 100 });
  });

  it('runtime: emit on an UNregistered channel still works (untyped path)', () => {
    const cap = capture(channelName('adhoc', 'whatever'));
    stop = cap.stop;

    emit('adhoc', 'whatever', { anything: true, goes: 1 });

    expect(cap.events).toHaveLength(1);
    expect(cap.events[0]?.payload).toEqual({ anything: true, goes: 1 });
  });

  it('runtime: trace on a registered channel publishes start+end', async () => {
    const cap = capture(`${channelName('durable', 'step')}:start`);
    const capEnd = capture(`${channelName('durable', 'step')}:end`);
    stop = () => {
      cap.stop();
      capEnd.stop();
    };

    const out = trace('durable', 'step', () => 'done', { name: 'ship', attempt: 1 });

    expect(out).toBe('done');
    expect(cap.events).toHaveLength(1);
    expect(capEnd.events).toHaveLength(1);
  });

  it('type-level: PayloadOf resolves registered payloads and falls back to unknown', () => {
    // These are compile-time assertions; the runtime body is a trivial truthy check.
    type BillingPaid = PayloadOf<'billing', 'invoice-paid'>;
    const a: BillingPaid = { invoiceId: 'x', amount: 1 };
    // @ts-expect-error — missing required `amount`
    const bad: BillingPaid = { invoiceId: 'x' };

    type Unknownish = PayloadOf<'mystery', 'event'>;
    const u: Unknownish = { literally: 'anything' } as Unknownish;

    type Libs = LibOf;
    const lib: Libs = 'billing';
    type Events = EventOf<'billing'>;
    const ev: Events = 'invoice-paid';

    expect(a.amount).toBe(1);
    expect(bad).toBeDefined();
    expect(u).toBeDefined();
    expect(lib).toBe('billing');
    expect(ev).toBe('invoice-paid');
  });

  it('type-level: emit rejects a mismatched payload for a registered channel', () => {
    const cap = capture(channelName('billing', 'invoice-paid'));
    stop = cap.stop;

    // @ts-expect-error — `amount` must be a number for the registered channel
    emit('billing', 'invoice-paid', { invoiceId: 'x', amount: 'not-a-number' });

    expect(cap.events).toHaveLength(1);
  });
});
