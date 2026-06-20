import { describe, expect, it } from 'vitest';
import { assertCapabilityNaming, capability } from '../src/index.js';

describe('capability', () => {
  it('mints the canonical @agora/<lib>:<name> Symbol.for token', () => {
    expect(capability('context', 'accessor')).toBe(Symbol.for('@agora/context:accessor'));
    expect(capability('diagnostics', 'emit')).toBe(Symbol.for('@agora/diagnostics:emit'));
  });

  it('returns the same symbol across calls and across copies (Symbol.for identity)', () => {
    expect(capability('otel', 'traceparent')).toBe(capability('otel', 'traceparent'));
    // A second, independently-computed key resolves to the same registered symbol — the mechanism
    // that lets a producer and a consumer in different repos share one token.
    expect(capability('otel', 'traceparent')).toBe(Symbol.for('@agora/otel:traceparent'));
  });
});

describe('assertCapabilityNaming', () => {
  it('passes when every token follows the canonical naming', () => {
    expect(() =>
      assertCapabilityNaming('context', {
        ACCESSOR: capability('context', 'accessor'),
      }),
    ).not.toThrow();
  });

  it('throws, naming the offending export, on a non-canonical token', () => {
    expect(() => assertCapabilityNaming('context', { BAD: Symbol('ad-hoc') })).toThrowError(/BAD/);
  });

  it('throws when a token belongs to a different lib', () => {
    expect(() =>
      assertCapabilityNaming('diagnostics', { ACCESSOR: capability('context', 'accessor') }),
    ).toThrowError(/@agora\/diagnostics:/);
  });
});
