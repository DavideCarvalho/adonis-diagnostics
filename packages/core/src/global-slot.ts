/**
 * Read — or lazily initialize — a process-wide value held under a `Symbol.for` key on `globalThis`.
 *
 * The `@agora/*` family publishes a few registries/holders this way so that even when more than one
 * physical copy of a package is loaded (divergent version ranges pnpm can't dedupe into one
 * instance, or the dual ESM/CJS build evaluated once via `import` and once via `require`), every
 * copy resolves the SAME object — the registered symbol collapses all copies to one identity.
 *
 * This is the read-or-init half of that pattern: return the value any copy already created,
 * otherwise store and return `init()`. Mutable shared state is held inside the returned object
 * (a `Set`, `Map`, or `{ current }` cell) so every copy mutates the one instance.
 *
 * Write-once and delete-style slots (e.g. the `emit` fn, the OTel traceparent) assign their global
 * slot directly rather than through here — there is nothing to lazily initialize.
 */
export function globalSlot<T>(key: symbol, init: () => T): T {
  const store = globalThis as Record<symbol, T | undefined>;
  const existing = store[key];
  if (existing !== undefined) return existing;
  const created = init();
  store[key] = created;
  return created;
}
