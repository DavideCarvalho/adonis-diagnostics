import { afterEach, describe, expect, it } from 'vitest';
import { emit } from '../src/channel.js';
import { resetRegistry } from '../src/registry.js';
import { onDiagnostic, unsubscribeAll } from '../src/subscriber.js';

afterEach(() => {
  unsubscribeAll();
  resetRegistry();
});

describe('onDiagnostic', () => {
  it('subscribes to an exact channel', () => {
    const seen: unknown[] = [];
    onDiagnostic('billing', 'paid', (e) => {
      seen.push(e.payload);
    });
    emit('billing', 'paid', { id: 1 });
    expect(seen).toEqual([{ id: 1 }]);
  });

  it('wildcard subscribes to every event of a lib (current and future)', () => {
    const seen: string[] = [];
    onDiagnostic('authz', (e) => {
      seen.push(e.event);
    });
    emit('authz', 'decision', {}); // channel registered now
    emit('authz', 'denied', {}); // future channel — auto-subscribed
    expect(seen).toEqual(['decision', 'denied']);
  });

  it('returns an unsubscribe that stops delivery', () => {
    const seen: number[] = [];
    const off = onDiagnostic('billing', 'paid', () => {
      seen.push(1);
    });
    emit('billing', 'paid', {});
    off();
    emit('billing', 'paid', {});
    expect(seen).toHaveLength(1);
  });

  it('isolates a throwing handler from the emitter', () => {
    let errored: unknown;
    onDiagnostic(
      'billing',
      'paid',
      () => {
        throw new Error('boom');
      },
      {
        onError: (err) => {
          errored = err;
        },
      },
    );
    expect(() => emit('billing', 'paid', {})).not.toThrow();
    expect((errored as Error).message).toBe('boom');
  });

  it('routes async handler rejections to onError', async () => {
    let errored: unknown;
    onDiagnostic(
      'billing',
      'paid',
      async () => {
        throw new Error('async-boom');
      },
      {
        onError: (err) => {
          errored = err;
        },
      },
    );
    emit('billing', 'paid', {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((errored as Error).message).toBe('async-boom');
  });

  it('unsubscribeAll tears down every live subscription', () => {
    const seen: number[] = [];
    onDiagnostic('a', 'x', () => seen.push(1));
    onDiagnostic('b', 'y', () => seen.push(1));
    unsubscribeAll();
    emit('a', 'x', {});
    emit('b', 'y', {});
    expect(seen).toHaveLength(0);
  });
});
