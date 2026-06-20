import { randomUUID } from 'node:crypto';
import {
  type ChannelRef,
  type DiagnosticEvent,
  createChannelSelector,
  getChannel,
} from '@agora/diagnostics';

export type { ChannelRef };

/**
 * The envelope a relayed diagnostics event is dispatched as. `node` is the id of the process that
 * forwarded the event (for echo suppression); `env` is the original {@link DiagnosticEvent}.
 */
export interface DiagnosticsEventEnvelope {
  /** Id of the process that forwarded the event. */
  node: string;
  /** The original diagnostics event envelope. */
  env: DiagnosticEvent;
}

/**
 * The minimal `@boringnode/queue` `Job.dispatch` surface the relay needs to forward an event. The
 * `DiagnosticsEventJob` class exported by this package satisfies it structurally, as does any job
 * class whose `dispatch(payload)` returns an awaitable. Keeping it structural lets the relay be
 * tested without a queue backend.
 */
export interface DiagnosticsEventJobLike {
  dispatch(payload: DiagnosticsEventEnvelope): PromiseLike<unknown> | unknown;
}

export interface DiagnosticsQueueRelayOptions {
  /**
   * The job class used to forward events. Its `dispatch(envelope)` is called for each selected local
   * event. In an AdonisJS app this is {@link DiagnosticsEventJob}, registered with `@adonisjs/queue`
   * so a worker in another process re-emits it locally via {@link bindRelayReEmitter}.
   */
  job: DiagnosticsEventJobLike;
  /** Forward every event of these libs (current + future channels). */
  libs?: string[];
  /** Forward these exact channels, in addition to `libs`. */
  channels?: ChannelRef[];
  /** Forward EVERY agora channel (current + future). Overrides `libs`/`channels`. Default false. */
  all?: boolean;
  /** Unique id for THIS process, for echo suppression. Default a random id. */
  nodeId?: string;
  /**
   * Invoked if `job.dispatch(...)` rejects asynchronously. Forwarding is fire-and-forget so a queue
   * outage never throws into `emit()`; this hook lets callers log the failure. Default: ignored.
   */
  onDispatchError?: (error: unknown) => void;
}

/**
 * Process-local state a {@link DiagnosticsEventJob} needs when its `execute()` runs in a worker:
 * the local `nodeId` (to suppress this process's own echoes) and the re-emit guard (to stop the
 * re-emitted event from being forwarded back to the queue). Populated by {@link bindRelayReEmitter}.
 */
export interface RelayReEmitter {
  /** Id of THIS process. Envelopes whose `node` equals it are this process's own echo. */
  readonly nodeId: string;
  /** Re-emit a queue-received envelope onto the local bus, guarded against re-forwarding. */
  reEmit(envelope: DiagnosticsEventEnvelope): void;
}

/**
 * Re-emit guard shared between the relay (forward side) and the job (receive side) within a process.
 * Holds the `nodeId` and the `reEmitting` WeakSet so an event re-emitted from the queue is not
 * forwarded back to the queue, mirroring the Redis relay's loop guard.
 */
class ReEmitGuard implements RelayReEmitter {
  readonly reEmitting = new WeakSet<object>();
  constructor(readonly nodeId: string) {}

  reEmit(envelope: DiagnosticsEventEnvelope): void {
    if (envelope.node === this.nodeId) return; // our own echo
    const env = envelope.env;
    if (!env || typeof env.lib !== 'string' || typeof env.event !== 'string') return;
    this.reEmitting.add(env);
    try {
      getChannel(env.lib, env.event).publish(env);
    } catch {
      // a local subscriber threw — never propagate into the worker
    } finally {
      this.reEmitting.delete(env);
    }
  }
}

/**
 * The active re-emitter for this process. The {@link DiagnosticsEventJob}'s `execute()` reads it so
 * a worker re-emits received events onto the local bus. `null` until a relay starts in this process.
 */
let activeReEmitter: ReEmitGuard | null = null;

/**
 * Bind the process-local re-emitter the {@link DiagnosticsEventJob} uses to publish queue-received
 * events. Called by {@link createDiagnosticsQueueRelay}; exported for advanced setups (e.g. a
 * worker-only process that forwards nothing but must still re-emit). Returns an unbind function.
 */
export function bindRelayReEmitter(reEmitter: RelayReEmitter): () => void {
  const guard = reEmitter instanceof ReEmitGuard ? reEmitter : new ReEmitGuard(reEmitter.nodeId);
  activeReEmitter = guard;
  return () => {
    if (activeReEmitter === guard) activeReEmitter = null;
  };
}

/** The re-emitter bound for this process, or `null` if no relay has started. Used by the job. */
export function getActiveReEmitter(): RelayReEmitter | null {
  return activeReEmitter;
}

/**
 * Relay diagnostics events across processes over `@adonisjs/queue`. Forwards selected local
 * `agora:<lib>:<event>` channels by dispatching a job carrying `{ node, env }`; a worker running in
 * ANOTHER process executes that job and re-emits the event onto its local bus (see
 * {@link DiagnosticsEventJob}), so `onDiagnostic` handlers / `getChannel(...).subscribe(...)` fire
 * cross-process.
 *
 * A relay is fan-out (no back-channel), which fits the queue model. Loop-safe: own-process echoes
 * are suppressed by `nodeId`, and a re-emit guard stops a re-emitted event from being forwarded
 * back. Forwarding is fire-and-forget and never throws into `emit()`; the job's `execute()` never
 * throws into the worker. Does NOT own the queue lifecycle — `@adonisjs/queue` does.
 *
 * @returns a teardown that removes all local subscriptions and unbinds the process re-emitter.
 */
export function createDiagnosticsQueueRelay(options: DiagnosticsQueueRelayOptions): () => void {
  const { job } = options;
  const nodeId = options.nodeId ?? randomUUID();
  const onDispatchError = options.onDispatchError;

  const guard = new ReEmitGuard(nodeId);
  const unbindReEmitter = bindRelayReEmitter(guard);

  const forward = (msg: unknown): void => {
    if (typeof msg !== 'object' || msg === null) return;
    if (guard.reEmitting.has(msg)) return; // a re-emitted remote event — do not send it back
    try {
      const result = job.dispatch({ node: nodeId, env: msg as DiagnosticEvent });
      // dispatch is async (push to the queue backend) — fire-and-forget, but surface rejections
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        (result as PromiseLike<unknown>).then(undefined, (err) => onDispatchError?.(err));
      }
    } catch (err) {
      // never throw back into the synchronous emit() that triggered this
      onDispatchError?.(err);
    }
  };

  const selector = createChannelSelector(options, forward);

  return () => {
    selector.stop();
    unbindReEmitter();
  };
}
