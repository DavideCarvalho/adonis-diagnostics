# `@agora/diagnostics` — DESIGN

> Port of `@dudousxd/nestjs-diagnostics` (aviary) to AdonisJS (Agora).

## 1. Papel

Convenção de emissão de eventos de observabilidade sobre `node:diagnostics_channel`,
no canal `agora:<lib>:<event>`. Desacopla **emissor** (qualquer lib Agora) de
**observador** (telescope, exporter, handler do app) — não há import entre eles,
só o contrato de nome de canal.

> O prefixo do canal mudou de `aviary` → **`agora`**: ecossistema distinto, com seu
> próprio telescope. Um observador Agora assina `agora:*`.

## 2. Núcleo (framework-agnostic, portado verbatim)

`channel.ts` (`emit`/`getChannel`), `trace.ts` (spans start/end/asyncStart/
asyncEnd/error), `registry.ts` (descoberta de canais via `Symbol.for` global,
cross-copy estável), `context_accessor.ts` (auto-fill de `traceId`), `types.ts`
(envelope + `ChannelRegistry` tipada). Tudo puro `node:diagnostics_channel` —
copiado sem mudança além do prefixo/marca.

- `emit` é **free quando ninguém assina** (`hasSubscribers` gate antes de alocar).
- `trace` idem (gate em qualquer sub-canal).
- Nunca lança no caminho do emissor.

## 3. O que mudou do Nest → Adonis

O Nest descobria handlers via `@OnDiagnostic` + um explorer que escaneava os
providers da DI no bootstrap. Adonis não tem esse scan idiomático. Extraí a lógica
do explorer numa função **agnóstica**:

```ts
onDiagnostic('resilience', handler)            // wildcard: todo agora:resilience:*
onDiagnostic('authz', 'decision', handler)     // canal exato
```

- Suporta exato + wildcard (com auto-subscribe de canais **futuros** via
  `onChannelRegistered`).
- `safe-invoke`: throw/rejeição do handler nunca quebra o `emit`.
- Retorna unsubscribe; `unsubscribeAll()` (chamado no `shutdown` do provider)
  derruba tudo — sem leak no dev-watcher/testes.

Handlers são registrados em `start/diagnostics.ts` (preload publicado pelo
`configure`), o ponto idiomático Adonis equivalente ao "import o módulo na raiz".

## 4. Wiring Adonis

- **Provider** (`diagnostics_provider.ts`): só lifecycle — `shutdown()` →
  `unsubscribeAll()`. O auto-fill de `traceId` vem do outro lado: o provider do
  `@agora/context` soft-detecta este pacote no boot e chama `setContextAccessor`.
- **`node ace configure @agora/diagnostics`**: registra o provider, publica
  `start/diagnostics.ts` e o adiciona como preload.

## 5. Cross-process (`@agora/diagnostics-redis`)

`relay.ts` é agnóstico (interface `RedisLike` estrutural — ioredis satisfaz).
Encaminha canais locais selecionados pro Redis pub/sub e re-emite os recebidos no
bus local, então `onDiagnostic` dispara cross-process. Loop-safe (echo suppression
por `nodeId` + guard de re-emit). No Adonis, o provider pega o ioredis cru do
`@adonisjs/redis` (`connection.ioConnection` + `.duplicate()` pro subscriber) a
partir do `config/diagnostics_redis.ts`. As conexões são do `@adonisjs/redis` — o
relay nunca as fecha.

## 6. Pacotes

- `@agora/diagnostics` — núcleo (emit/trace/onDiagnostic + registry + context bridge)
- `@agora/diagnostics-redis` — relay cross-process sobre `@adonisjs/redis`
- `@agora/diagnostics-queue` — relay cross-process (fan-out) sobre `@adonisjs/queue`

## 7. Não-objetivos

- Não é um storage/dashboard (isso é o `@agora/telescope`).
- Não impõe schema de payload (opaco; `ChannelRegistry` é opt-in só pra tipos).
