import type { ApplicationService } from '@adonisjs/core/types';
import { unsubscribeAll } from '../src/subscriber.js';

/**
 * Wires `@agora/diagnostics` into the AdonisJS application.
 *
 * The emit/trace/onDiagnostic surface is just process-global functions over
 * `node:diagnostics_channel`, so there is little to register at boot. The
 * provider's job is lifecycle: tear down every {@link onDiagnostic} subscription
 * on graceful shutdown so a reloaded process (dev watcher, tests) does not leak
 * listeners.
 *
 * The trace-id auto-fill is wired from the other side: `@agora/context`'s provider
 * soft-detects this package at boot and registers its accessor via
 * `setContextAccessor`, so `emit()` correlates by `traceId` with zero config here.
 *
 * Register diagnostics handlers in `start/diagnostics.ts` (published by
 * `node ace configure @agora/diagnostics`).
 */
export default class DiagnosticsProvider {
  constructor(protected app: ApplicationService) {}

  async shutdown() {
    unsubscribeAll();
  }
}
