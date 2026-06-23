/**
 * The capability protocol — the typed, cross-repo contract for the optional peer capabilities the
 * `@adonis-agora/*` family publishes on `globalThis`.
 *
 * Every Agora lib that exposes a capability for siblings to consume — `@adonis-agora/context`'s accessor,
 * `@adonis-agora/diagnostics`'s `emit`, the OTel traceparent, etc. — does so under a `Symbol.for` key. This
 * module is the single source of that key's naming and its type, mirroring the event-transport side:
 * `capability(lib, name)` is to the capability registry what {@link channelName} is to the channel
 * registry, and {@link CapabilityRegistry} is the typed mirror of `ChannelRegistry`.
 *
 * Producer and consumer live in different repos and never import each other; resolving the SAME
 * `Symbol.for(...)` is what wires them, with zero dependency and a graceful `undefined` when the peer
 * is absent. Keeping the key behind `capability()` (rather than open-coding the string) means the
 * naming can be conformance-checked — see {@link assertCapabilityNaming}.
 */

/**
 * The stable DI token for the capability `<lib>:<name>`. Single source of the `@agora/<lib>:<name>`
 * naming. Because it uses the global symbol registry (`Symbol.for`), a producer and a consumer in
 * different libs — without importing each other — resolve the identical symbol.
 *
 * ```ts
 * const ACCESSOR = capability('context', 'accessor'); // Symbol.for('@agora/context:accessor')
 * ```
 */
export function capability(lib: string, name: string): symbol {
  return Symbol.for(`@agora/${lib}:${name}`);
}

/**
 * Typed registry of capabilities, augmented by libs via declaration merging — the exact mirror of
 * the event transport's `ChannelRegistry`. Empty by default; the untyped (`unknown`) path is always
 * available for capabilities no one has declared.
 *
 * ```ts
 * declare module '@adonis-agora/diagnostics' {
 *   interface CapabilityRegistry {
 *     context: { accessor: ContextAccessor };
 *   }
 * }
 * ```
 */
export interface CapabilityRegistry {}

/**
 * The declared payload type for `(TLib, TName)` in {@link CapabilityRegistry}, or `unknown` when the
 * pair is not registered. Mirrors `PayloadOf` from the event transport.
 */
export type CapabilityOf<
  TLib extends string,
  TName extends string,
> = TLib extends keyof CapabilityRegistry
  ? TName extends keyof CapabilityRegistry[TLib]
    ? CapabilityRegistry[TLib][TName]
    : unknown
  : unknown;
