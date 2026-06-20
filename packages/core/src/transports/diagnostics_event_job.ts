import { Job } from '@adonisjs/queue';
import { type DiagnosticsEventEnvelope, getActiveReEmitter } from './queue.js';

/**
 * The `@adonisjs/queue` job that carries a relayed diagnostics event across processes.
 *
 * The forward side ({@link createDiagnosticsQueueRelay}) dispatches this job for each selected local
 * `agora:<lib>:<event>` event. A worker running in ANOTHER process loads this class (via the queue
 * `locations` glob) and runs `execute()`, which re-emits the event onto that process's local bus so
 * `onDiagnostic` handlers fire there too.
 *
 * Re-emission is delegated to the process-local re-emitter bound by the relay
 * ({@link bindRelayReEmitter}): it suppresses the worker process's own echoes (`node === nodeId`)
 * and guards the re-emitted event from being forwarded back to the queue. If no relay has started in
 * the worker process the job is a no-op — it never throws into the worker.
 *
 * Imports `@adonisjs/queue` at module load, so it is loaded lazily by `transports.queue(...)` rather
 * than from the package barrel — keeping `@adonisjs/queue` an optional peer dependency.
 */
export default class DiagnosticsEventJob extends Job<DiagnosticsEventEnvelope> {
  /** Stable name so dispatch/process resolve the same class regardless of bundling/minification. */
  static override options = { name: 'agora.diagnostics.event' };

  async execute(): Promise<void> {
    const reEmitter = getActiveReEmitter();
    if (!reEmitter) return; // no relay bound in this process — nothing to re-emit onto
    reEmitter.reEmit(this.payload);
  }
}
