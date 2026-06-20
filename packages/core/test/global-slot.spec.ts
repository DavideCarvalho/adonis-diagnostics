import { describe, expect, it } from 'vitest';
import { globalSlot } from '../src/global-slot.js';

describe('globalSlot', () => {
  it('initializes once and returns the same instance thereafter', () => {
    const key = Symbol.for('@agora/test:global-slot:once');
    let inits = 0;
    const a = globalSlot(key, () => {
      inits += 1;
      return new Set<string>(['seed']);
    });
    const b = globalSlot(key, () => {
      inits += 1;
      return new Set<string>(['other']);
    });
    expect(b).toBe(a); // same instance — second init ignored
    expect(inits).toBe(1);
    a.add('mutated');
    expect(b.has('mutated')).toBe(true); // shared mutable state
  });

  it('resolves the same instance for a second lookup of the same Symbol.for key', () => {
    const created = globalSlot<{ current: number }>(
      Symbol.for('@agora/test:global-slot:holder'),
      () => ({
        current: 7,
      }),
    );
    // A second, independently-computed Symbol.for(...) resolves to the same key, mirroring a second
    // physical copy of a package reading the same slot.
    const seen = globalSlot<{ current: number }>(
      Symbol.for('@agora/test:global-slot:holder'),
      () => ({
        current: -1,
      }),
    );
    expect(seen).toBe(created);
    expect(seen.current).toBe(7);
  });
});
