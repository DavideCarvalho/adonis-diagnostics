import type { ApplicationService } from '@adonisjs/core/types';
import redis from '@adonisjs/redis/services/main';
import type { DiagnosticsRedisConfig } from '../src/define_config.js';
import { type RedisLike, createDiagnosticsRedisRelay } from '../src/relay.js';

/**
 * Wires `@agora/diagnostics-redis` into the AdonisJS application: starts the
 * cross-process relay over an `@adonisjs/redis` connection so diagnostics events
 * (and thus `onDiagnostic` handlers) fan out across processes.
 *
 * Uses the raw ioredis client behind the AdonisJS connection — `publish`/`subscribe`
 * with the `(channel, message)` `message` event the relay expects — and a
 * `duplicate()` for the subscriber leg. The connections are owned by
 * `@adonisjs/redis`; the relay never closes them.
 */
export default class DiagnosticsRedisProvider {
  #teardown: (() => void) | null = null;

  constructor(protected app: ApplicationService) {}

  async ready() {
    const config = this.app.config.get<DiagnosticsRedisConfig>('diagnostics_redis', {});
    const connection = config.connection
      ? redis.connection(config.connection as Parameters<typeof redis.connection>[0])
      : redis.connection();
    // The raw ioredis client behind the AdonisJS connection satisfies RedisLike.
    const pub = (connection as unknown as { ioConnection: RedisLike }).ioConnection;
    const sub = (pub as unknown as { duplicate(): RedisLike }).duplicate();

    this.#teardown = createDiagnosticsRedisRelay({
      pub,
      sub,
      ...(config.libs !== undefined ? { libs: config.libs } : {}),
      ...(config.channels !== undefined ? { channels: config.channels } : {}),
      ...(config.all !== undefined ? { all: config.all } : {}),
      ...(config.redisChannel !== undefined ? { redisChannel: config.redisChannel } : {}),
      ...(config.nodeId !== undefined ? { nodeId: config.nodeId } : {}),
    });
  }

  async shutdown() {
    this.#teardown?.();
    this.#teardown = null;
  }
}
