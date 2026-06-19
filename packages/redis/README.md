# `@agora/diagnostics-redis`

Cross-process transport for [`@agora/diagnostics`](https://www.npmjs.com/package/@agora/diagnostics)
— relay `agora:<lib>:<event>` events over `@adonisjs/redis` pub/sub so
`onDiagnostic` handlers fire across processes.

```sh
npm i @agora/diagnostics-redis
node ace configure @agora/diagnostics-redis
```

```ts
// config/diagnostics_redis.ts
import { defineConfig } from '@agora/diagnostics-redis'
export default defineConfig({ all: true })
```

Loop-safe (per-process echo suppression). The relay never closes the
`@adonisjs/redis` connections it borrows.

## License

MIT © Davi Carvalho
