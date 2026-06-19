/** Keep in sync with this package's `version` in package.json. */
export const VERSION = '0.1.0';

export { createDiagnosticsQueueRelay } from './relay.js';
export {
  bindRelayReEmitter,
  getActiveReEmitter,
} from './relay.js';
export type {
  ChannelRef,
  DiagnosticsEventEnvelope,
  DiagnosticsEventJobLike,
  DiagnosticsQueueRelayOptions,
  RelayReEmitter,
} from './relay.js';
export { default as DiagnosticsEventJob } from './diagnostics_event_job.js';
export { defineConfig } from './define_config.js';
export type { DiagnosticsQueueConfig } from './define_config.js';
