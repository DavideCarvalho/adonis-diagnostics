/** Keep in sync with this package's `version` in package.json. */
export const VERSION = '0.1.0';

export { createDiagnosticsRedisRelay } from './relay.js';
export type { ChannelRef, DiagnosticsRedisRelayOptions, RedisLike } from './relay.js';
export { defineConfig } from './define_config.js';
export type { DiagnosticsRedisConfig } from './define_config.js';
