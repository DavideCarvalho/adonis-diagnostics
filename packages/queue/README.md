# `@agora/diagnostics-queue`

Cross-process transport for [`@agora/diagnostics`](https://www.npmjs.com/package/@agora/diagnostics)
— relay `agora:<lib>:<event>` events over [`@adonisjs/queue`](https://www.npmjs.com/package/@adonisjs/queue)
so `onDiagnostic` handlers fire across processes. The queue-backed counterpart of
`@agora/diagnostics-redis`.

```sh
npm i @agora/diagnostics-queue
node ace configure @adonisjs/queue   # if not already set up
node ace configure @agora/diagnostics-queue
```

```ts
// config/diagnostics_queue.ts
import { defineConfig } from '@agora/diagnostics-queue'
export default defineConfig({ all: true })
```

## How it works

A relay is **fan-out** (no back-channel), which fits the queue model. The provider:

- subscribes to the selected local channels (`channels` + wildcard `libs`, or `all`);
- on each event, **dispatches a `DiagnosticsEventJob`** carrying `{ node, env }`;
- a worker running in **another** process (`node ace queue:work`) executes that job, which
  **re-emits** the event onto that process's local bus — so `onDiagnostic` handlers fire there.

Loop-safe: a process suppresses its own echoes (`node === nodeId`) and a re-emit guard stops a
re-emitted event from being forwarded back to the queue. Forwarding is fire-and-forget and never
throws into `emit()`; the job's `execute()` never throws into the worker. The relay does not own the
queue lifecycle — `@adonisjs/queue` does.

## Notes / limitations of `@adonisjs/queue` v0.6

- Job processing happens in a **separate worker process** that discovers job classes by name (via
  the queue `Locator` / `locations` glob). Re-emission must therefore live in the job's `execute()`,
  not in an in-process message handler like the Redis relay's `on('message')`. The provider
  registers `DiagnosticsEventJob` with the `Locator` and binds a process-local re-emitter so the job
  can publish onto the local bus.
- Re-emission only happens in processes where this provider has started (i.e. where a re-emitter is
  bound). A bare `queue:work` process re-emits only if it also boots the app with this provider.
- Delivery latency and ordering follow the queue backend, unlike Redis pub/sub's synchronous fan-out.

## License

MIT © Davi Carvalho
