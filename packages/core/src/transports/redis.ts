import { randomUUID } from 'node:crypto';
import { getChannel } from '../channel.js';
import { type ChannelRef, createChannelSelector } from '../relay.js';
import type { DiagnosticEvent } from '../types.js';

export type { ChannelRef };

/** The minimal Redis pub/sub surface the relay uses. An ioredis instance satisfies it structurally. */
export interface RedisLike {
  publish(channel: string, message: string): unknown;
  subscribe(channel: string, callback?: (err: Error | null, count: number) => void): unknown;
  on(event: 'message', listener: (channel: string, message: string) => void): unknown;
  removeListener(event: 'message', listener: (channel: string, message: string) => void): unknown;
  unsubscribe(channel: string): unknown;
}

export interface DiagnosticsRedisRelayOptions {
  /** Publisher connection. */
  pub: RedisLike;
  /** Subscriber connection (separate from `pub`). For ioredis: `const sub = pub.duplicate()`. */
  sub: RedisLike;
  /** Forward every event of these libs (current + future channels). */
  libs?: string[];
  /** Forward these exact channels, in addition to `libs`. */
  channels?: ChannelRef[];
  /** Forward EVERY agora channel (current + future). Overrides `libs`/`channels`. Default false. */
  all?: boolean;
  /** Redis channel to relay on. Default 'agora:diagnostics:relay'. */
  redisChannel?: string;
  /** Unique id for THIS process, for echo suppression. Default a random id. */
  nodeId?: string;
}

const DEFAULT_REDIS_CHANNEL = 'agora:diagnostics:relay';

/**
 * Relay diagnostics events across processes over Redis pub/sub. Forwards selected local
 * `agora:<lib>:<event>` channels to Redis and re-emits Redis-received events onto the local bus, so
 * `onDiagnostic` handlers / `getChannel(...).subscribe(...)` fire cross-process. Loop-safe via nodeId
 * echo suppression and a re-emit guard. Never throws into `emit()` or the Redis handler. Does NOT
 * close the `pub`/`sub` connections — the caller owns them.
 *
 * Usually you don't call this directly: `config/diagnostics.ts` selects it via
 * `transports.redis({ ... })` and the provider starts it for you.
 *
 * @returns a teardown that removes all local subscriptions and the Redis message handler.
 */
export function createDiagnosticsRedisRelay(options: DiagnosticsRedisRelayOptions): () => void {
  const { pub, sub } = options;
  const redisChannel = options.redisChannel ?? DEFAULT_REDIS_CHANNEL;
  const nodeId = options.nodeId ?? randomUUID();

  const reEmitting = new WeakSet<object>();

  const forward = (msg: unknown): void => {
    if (typeof msg !== 'object' || msg === null) return;
    if (reEmitting.has(msg)) return; // a re-emitted remote event — do not send it back
    try {
      pub.publish(redisChannel, JSON.stringify({ node: nodeId, env: msg }));
    } catch {
      // never throw back into the synchronous emit() that triggered this
    }
  };

  const selector = createChannelSelector(options, forward);

  const onMessage = (channel: string, raw: string): void => {
    if (channel !== redisChannel) return;
    let parsed: { node?: unknown; env?: DiagnosticEvent };
    try {
      parsed = JSON.parse(raw) as { node?: unknown; env?: DiagnosticEvent };
    } catch {
      return; // ignore malformed
    }
    if (parsed.node === nodeId) return; // our own echo
    const env = parsed.env;
    if (!env || typeof env.lib !== 'string' || typeof env.event !== 'string') return;
    reEmitting.add(env);
    try {
      getChannel(env.lib, env.event).publish(env);
    } catch {
      // a local subscriber threw — never propagate into the message handler
    } finally {
      reEmitting.delete(env);
    }
  };

  sub.subscribe(redisChannel);
  sub.on('message', onMessage);

  return () => {
    selector.stop();
    sub.removeListener('message', onMessage);
    sub.unsubscribe(redisChannel);
  };
}
