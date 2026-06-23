/**
 * Anti-drift guard for contract tests: assert that EVERY token a lib exports follows the canonical
 * `@agora/<lib>:<name>` naming (i.e. was minted by {@link capability}). `Symbol.for(k).description`
 * is `k`, so checking the `description` prefix is enough — no identity comparison needed. Throws an
 * error that NAMES the offending export, turning naming drift into a red test.
 *
 * ```ts
 * import { capability, assertCapabilityNaming } from '@adonis-agora/diagnostics';
 *
 * it('exports canonically-named capability tokens', () => {
 *   assertCapabilityNaming('context', { ACCESSOR: capability('context', 'accessor') });
 * });
 * ```
 */
export function assertCapabilityNaming(lib: string, tokens: Record<string, symbol>): void {
  const prefix = `@agora/${lib}:`;
  for (const [exportName, token] of Object.entries(tokens)) {
    const desc = token.description;
    if (desc === undefined || !desc.startsWith(prefix)) {
      throw new Error(
        `Capability token "${exportName}" has description ${JSON.stringify(desc)}, ` +
          `expected to start with "${prefix}". Use capability('${lib}', <name>).`,
      );
    }
  }
}
