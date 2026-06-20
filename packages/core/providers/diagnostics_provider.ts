import type { ApplicationService } from '@adonisjs/core/types';
import type { DiagnosticsConfig } from '../src/define_config.js';
import { unsubscribeAll } from '../src/subscriber.js';

/**
 * Wires `@agora/diagnostics` into the AdonisJS application.
 *
 * The emit/trace/onDiagnostic surface is just process-global functions over
 * `node:diagnostics_channel`, so there is little to register at boot. The
 * provider's jobs are:
 *
 * 1. **Lifecycle** — tear down every {@link onDiagnostic} subscription on graceful
 *    shutdown so a reloaded process (dev watcher, tests) does not leak listeners.
 * 2. **OpenTelemetry auto-bridge** — when `@opentelemetry/api` is resolvable (an
 *    OTel SDK such as `@adonisjs/otel` is installed), dynamically load the OTel
 *    bridge and start it, so every `trace()` span becomes a real OTel span and
 *    the W3C `traceparent` is published on the global slot for `@agora/durable`.
 *    The import is dynamic so the bridge module (and its `@opentelemetry/api`
 *    import) is never loaded when OTel is absent — the `emit`/`trace` hot path
 *    stays OTel-free. Opt out with `otel: false` in `config/diagnostics.ts`.
 *
 * The trace-id auto-fill is wired from the other side: `@agora/context`'s provider
 * soft-detects this package at boot and registers its accessor via
 * `setContextAccessor`, so `emit()` correlates by `traceId` with zero config here.
 *
 * Register diagnostics handlers in `start/diagnostics.ts` (published by
 * `node ace configure @agora/diagnostics`).
 */
export default class DiagnosticsProvider {
  #stopOtel: (() => void) | null = null;
  #stopTransport: (() => void) | null = null;

  constructor(protected app: ApplicationService) {}

  async boot() {
    const config = this.app.config.get<{ otel?: boolean } | undefined>('diagnostics', {});
    if (config?.otel === false) return;
    // Dynamic so the @opentelemetry/api-importing bridge never loads without an
    // OTel SDK present — keeping emit/trace OTel-free by default. Only the IMPORT
    // is allowed to fail (module-not-found = OTel absent); a real bug inside
    // start() must surface, not be silently swallowed as "OTel not installed".
    let otel: typeof import('../src/otel/index.js');
    try {
      otel = await import('../src/otel/index.js');
    } catch {
      return;
    }
    otel.start();
    this.#stopOtel = otel.stop;
  }

  /**
   * Start the configured cross-process transport, if any. Runs after the container is ready so the
   * transport can resolve connections/loggers. `config.default` names the transport (a key of
   * `config.transports`) whose relay starts in this process; omit it for local-only diagnostics.
   */
  async ready() {
    const config = this.app.config.get<DiagnosticsConfig>('diagnostics', {});
    const name = config.default;
    if (!name) return;

    const provider = config.transports?.[name];
    if (!provider) {
      throw new Error(
        `@agora/diagnostics: config.default is "${name}", but config.transports.${name} is not defined`,
      );
    }

    this.#stopTransport = await provider({
      app: this.app,
      forward: config.forward ?? {},
      ...(config.nodeId !== undefined ? { nodeId: config.nodeId } : {}),
    });
  }

  async shutdown() {
    this.#stopTransport?.();
    this.#stopTransport = null;
    this.#stopOtel?.();
    this.#stopOtel = null;
    unsubscribeAll();
  }
}
