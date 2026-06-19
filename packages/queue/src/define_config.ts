import type { ChannelRef } from './relay.js';

/**
 * Shape of `config/diagnostics_queue.ts`. Selects which local `agora:<lib>:<event>` channels are
 * relayed across processes over `@adonisjs/queue`.
 */
export interface DiagnosticsQueueConfig {
  /**
   * `@adonisjs/queue` queue name to dispatch the relay job onto. A worker must process this queue
   * (e.g. `node ace queue:work {queue}`). Omit to use the job's default queue (`default`).
   */
  queue?: string;
  /** Forward every event of these libs (current + future channels). */
  libs?: string[];
  /** Forward these exact channels, in addition to `libs`. */
  channels?: ChannelRef[];
  /** Forward EVERY `agora:` channel. Overrides `libs`/`channels`. Default false. */
  all?: boolean;
  /** Unique id for THIS process, for echo suppression. Default a random id. */
  nodeId?: string;
}

/** Identity helper giving `config/diagnostics_queue.ts` full type-checking. */
export function defineConfig(config: DiagnosticsQueueConfig): DiagnosticsQueueConfig {
  return config;
}
