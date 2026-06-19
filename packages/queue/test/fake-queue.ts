import type { DiagnosticsEventEnvelope, DiagnosticsEventJobLike } from '../src/relay.js';

/**
 * In-memory stand-in for the `@adonisjs/queue` job used by the relay. Records every dispatched
 * envelope so tests can assert what the relay forwarded — and replay envelopes through a bound
 * re-emitter to simulate a worker in another process running the real job's `execute()`.
 */
export class FakeJob implements DiagnosticsEventJobLike {
  public readonly dispatched: DiagnosticsEventEnvelope[] = [];
  public dispatchCount = 0;
  /** When set, dispatch rejects with this reason (to exercise `onDispatchError`). */
  public rejectWith: unknown = undefined;

  dispatch(payload: DiagnosticsEventEnvelope): Promise<void> {
    this.dispatchCount += 1;
    this.dispatched.push(payload);
    if (this.rejectWith !== undefined) return Promise.reject(this.rejectWith);
    return Promise.resolve();
  }
}
