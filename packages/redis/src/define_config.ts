import type { ChannelRef } from './relay.js';

/**
 * Shape of `config/diagnostics_redis.ts`. Selects which local `agora:<lib>:<event>`
 * channels are relayed across processes over Redis pub/sub.
 */
export interface DiagnosticsRedisConfig {
  /** `@adonisjs/redis` connection name to relay over. Defaults to the default connection. */
  connection?: string;
  /** Forward every event of these libs (current + future channels). */
  libs?: string[];
  /** Forward these exact channels, in addition to `libs`. */
  channels?: ChannelRef[];
  /** Forward EVERY `agora:` channel. Overrides `libs`/`channels`. Default false. */
  all?: boolean;
  /** Redis channel to relay on. Default `agora:diagnostics:relay`. */
  redisChannel?: string;
  /** Unique id for THIS process, for echo suppression. Default a random id. */
  nodeId?: string;
}

/** Identity helper giving `config/diagnostics_redis.ts` full type-checking. */
export function defineConfig(config: DiagnosticsRedisConfig): DiagnosticsRedisConfig {
  return config;
}
