import type { ApplicationService } from '@adonisjs/core/types';
import { Locator } from '@adonisjs/queue';
import type { DiagnosticsQueueConfig } from '../src/define_config.js';
import DiagnosticsEventJob from '../src/diagnostics_event_job.js';
import { type DiagnosticsEventEnvelope, createDiagnosticsQueueRelay } from '../src/relay.js';

/**
 * Wires `@agora/diagnostics-queue` into the AdonisJS application: starts the cross-process relay over
 * `@adonisjs/queue` so diagnostics events (and thus `onDiagnostic` handlers) fan out across
 * processes.
 *
 * Forward side: a local diagnostics event is dispatched as a {@link DiagnosticsEventJob} via the
 * `@adonisjs/queue` manager. Receive side: a worker (`node ace queue:work`) running in another
 * process executes that job, which re-emits the event onto its local bus. The provider registers the
 * job class with the queue `Locator` so the worker can resolve it even if the app's `locations` glob
 * does not include this package. The queue lifecycle itself is owned by `@adonisjs/queue`.
 */
export default class DiagnosticsQueueProvider {
  #teardown: (() => void) | null = null;

  constructor(protected app: ApplicationService) {}

  async ready() {
    const config = this.app.config.get<DiagnosticsQueueConfig>('diagnostics_queue', {});
    const logger = await this.app.container.make('logger');

    // Ensure a worker in this process (or one sharing this registry) can resolve the job by name.
    const jobName = DiagnosticsEventJob.options.name ?? 'agora.diagnostics.event';
    Locator.register(jobName, DiagnosticsEventJob);

    const queue = config.queue;
    const job = {
      dispatch(payload: DiagnosticsEventEnvelope) {
        const dispatcher = DiagnosticsEventJob.dispatch(payload);
        return queue ? dispatcher.toQueue(queue) : dispatcher;
      },
    };

    this.#teardown = createDiagnosticsQueueRelay({
      job,
      ...(config.libs !== undefined ? { libs: config.libs } : {}),
      ...(config.channels !== undefined ? { channels: config.channels } : {}),
      ...(config.all !== undefined ? { all: config.all } : {}),
      ...(config.nodeId !== undefined ? { nodeId: config.nodeId } : {}),
      onDispatchError: (error) => {
        logger.error({ err: error }, 'failed to relay diagnostics event to queue');
      },
    });
  }

  async shutdown() {
    this.#teardown?.();
    this.#teardown = null;
  }
}
