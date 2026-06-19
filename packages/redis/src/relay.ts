import { randomUUID } from 'node:crypto';
import {
  CHANNEL_PREFIX,
  type DiagnosticEvent,
  channelName,
  getChannel,
  onChannelRegistered,
  registeredChannels,
} from '@agora/diagnostics';

/** The minimal Redis pub/sub surface the relay uses. An ioredis instance satisfies it structurally. */
export interface RedisLike {
  publish(channel: string, message: string): unknown;
  subscribe(channel: string, callback?: (err: Error | null, count: number) => void): unknown;
  on(event: 'message', listener: (channel: string, message: string) => void): unknown;
  removeListener(event: 'message', listener: (channel: string, message: string) => void): unknown;
  unsubscribe(channel: string): unknown;
}

export interface ChannelRef {
  lib: string;
  event: string;
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

/** Strip the `agora:` prefix and split on the FIRST colon — the event segment may contain dots
 *  (e.g. `durable:run.failed`), but the lib/event boundary is the first colon after the prefix. */
function parseChannelName(name: string): ChannelRef | null {
  const prefix = `${CHANNEL_PREFIX}:`;
  if (!name.startsWith(prefix)) return null;
  const rest = name.slice(prefix.length);
  const idx = rest.indexOf(':');
  if (idx <= 0 || idx === rest.length - 1) return null;
  return { lib: rest.slice(0, idx), event: rest.slice(idx + 1) };
}

/**
 * Relay diagnostics events across processes over Redis pub/sub. Forwards selected local
 * `agora:<lib>:<event>` channels to Redis and re-emits Redis-received events onto the local bus, so
 * `@OnDiagnostic` handlers / `getChannel(...).subscribe(...)` fire cross-process. Loop-safe via nodeId
 * echo suppression and a re-emit guard. Never throws into `emit()` or the Redis handler. Does NOT
 * close the `pub`/`sub` connections — the caller owns them.
 *
 * @returns a teardown that removes all local subscriptions and the Redis message handler.
 */
export function createDiagnosticsRedisRelay(options: DiagnosticsRedisRelayOptions): () => void {
  const { pub, sub } = options;
  const redisChannel = options.redisChannel ?? DEFAULT_REDIS_CHANNEL;
  const nodeId = options.nodeId ?? randomUUID();
  const forwardAll = options.all === true;
  const libs = options.libs ?? [];
  const exact = options.channels ?? [];

  const subscriptions: Array<{ ref: ChannelRef; listener: (msg: unknown) => void }> = [];
  const subscribed = new Set<string>();
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

  const subscribeRef = (ref: ChannelRef): void => {
    const name = channelName(ref.lib, ref.event);
    if (subscribed.has(name)) return;
    getChannel(ref.lib, ref.event).subscribe(forward);
    subscribed.add(name);
    subscriptions.push({ ref, listener: forward });
  };

  const wildcardMatches = (name: string): boolean => {
    if (forwardAll) return name.startsWith(`${CHANNEL_PREFIX}:`);
    return libs.some((lib) => name.startsWith(`${CHANNEL_PREFIX}:${lib}:`));
  };

  for (const ref of exact) subscribeRef(ref);

  const hasWildcard = forwardAll || libs.length > 0;
  if (hasWildcard) {
    for (const name of registeredChannels()) {
      if (wildcardMatches(name)) {
        const ref = parseChannelName(name);
        if (ref) subscribeRef(ref);
      }
    }
  }
  const offRegistered = hasWildcard
    ? onChannelRegistered((name) => {
        if (wildcardMatches(name)) {
          const ref = parseChannelName(name);
          if (ref) subscribeRef(ref);
        }
      })
    : null;

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
    for (const { ref, listener } of subscriptions) {
      getChannel(ref.lib, ref.event).unsubscribe(listener);
    }
    subscriptions.length = 0;
    subscribed.clear();
    offRegistered?.();
    sub.removeListener('message', onMessage);
    sub.unsubscribe(redisChannel);
  };
}
