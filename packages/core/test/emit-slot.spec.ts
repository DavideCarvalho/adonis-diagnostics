import { describe, expect, it } from 'vitest';
import { EMIT_SLOT, emit } from '../src/index.js';

describe('EMIT_SLOT', () => {
  it('publishes emit on the @agora/diagnostics:emit global slot', () => {
    expect(EMIT_SLOT).toBe(Symbol.for('@agora/diagnostics:emit'));
    expect((globalThis as Record<symbol, unknown>)[EMIT_SLOT]).toBe(emit);
  });
});
