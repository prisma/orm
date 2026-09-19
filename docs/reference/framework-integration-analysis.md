# Framework Integration Analysis for Prisma 8

## Purpose

A key success metric for Prisma 8 is integration into popular JavaScript/TypeScript frameworks. This document identifies the characteristics of the framework ecosystem that create requirements on Prisma 8's architecture — specifically, the hard integration problems that the framework and adapter layers must solve.

The audience is the Prisma 8 engineering team: the architect designing the framework, and the engineers implementing it.

## How Prisma 8 changes the integration picture

In Prisma ORM, `PrismaClient` is a single instantiated object with a built-in connection pool and Rust query engine binary. Framework integration boils down to: instantiate the client, keep it alive for the right scope, and call methods on it. The main pain points are binary size, cold starts, edge runtime incompatibility, connection exhaustion, and mocking difficulty.

Prisma 8's architecture changes the integration surface:

- **No query engine binary**: Pure TypeScript. Removes the most common edge/serverless friction (binary size, cold starts, read-only filesystems).
- **Contract + context, not client**: The unit of integration is `ExecutionContext` (contract + operations + codecs + adapter), not a monolithic `PrismaClient`.
- **Adapter-provided connections**: Database connections are managed by the target adapter, not by an internal engine. This doesn't make connection management simple — it changes where the complexity lives.
- **Streaming by default**: All queries return `AsyncIterableResult<Row>` (also `PromiseLike` for `await`). No `Promise<Row[]>` API.
- **No shared global state**: Each instantiation of the stack (driver → runtime → ORM client) is fully independent. Users can create separate stacks per tenant, per request, or per anything — resource allocation tradeoffs are theirs.
- **End-to-end type safety without codegen**: The contract type parameter pattern flows concrete, narrowed types through every query — `db.users.select('id', 'email').all()` resolves to `{ id: number; email: string }[]`. Framework-level inference (SvelteKit `PageData`, Nuxt `useAsyncData`, tRPC) propagates these types to the client automatically. See [Architectural advantages: Type safety](#typescript-type-safety).
- **Invisible contract emit via build tool plugins**: The entire emit pipeline is pure TypeScript — unlike Prisma ORM's Rust binary, which made build tool integration impractical. A working Vite plugin already exists and is validated on Vite 7 and Vite 8; equivalent plugins for other build systems are equally straightforward. See [Build tool integration](#build-tool-integration-invisible-contract-emit).

These changes solve several Prisma ORM pain points outright (see [Appendix B](#appendix-b-prisma-orm-pain-points-comparison)), but introduce new integration challenges around connection management, concurrent statefulness, and streaming composition.

---

## Hard problem 1: Connection management

Connection management is the hardest part of framework integration. The difficulty isn't Prisma-specific — it's inherent to the mismatch between database connection models (long-lived TCP, limited slots) and modern compute models (ephemeral, massively parallel, sometimes without TCP).

Prisma 8's pure-TS architecture removes the *engine binary* problem but does **not** remove the *connection* problem. The adapter still needs a database connection, and how that connection is obtained, pooled, and released varies dramatically by execution model.

### The four execution models

#### 1. Long-lived server process

**Frameworks**: Express, Fastify, NestJS, Koa, Hapi (dedicated deployment)

A connection pool is created at startup and lives for the lifetime of the process. Requests borrow and return connections. On shutdown, the pool drains gracefully. This is the model databases were designed for — very little can go wrong beyond misconfigured pool sizes or failure to drain on shutdown.

**What the adapter must do**: Accept pool configuration (min/max connections, idle timeout), expose `connect()` / `disconnect()` lifecycle hooks.

#### 2. Serverless function (Node.js runtime)

**Frameworks**: Next.js (Vercel Node runtime), Remix (Vercel/Netlify/AWS), Nuxt (Nitro on Lambda), Astro (SSR on Lambda), any framework on AWS Lambda

Each serverless function instance is an isolated Node.js process. On cold start, it creates a connection. On warm invocations, the same process reuses it. The platform may freeze the process between invocations and thaw it later.

**What can go wrong**:

- **Connection exhaustion on scale-up**: 100 concurrent cold starts = 100 new connections. Each instance's internal pool is useless for *cross-instance* sharing — it only pools within a single process. If the database has a 100-connection limit (common for managed Postgres), the pool is saturated.

- **Connection leaks on freeze**: When an instance is frozen, its connections remain open but idle. Idle timers don't fire during freeze. The connections are wasted until the DB server reclaims them or the instance is destroyed. This is the problem Vercel's `attachDatabasePool` solves: it ensures idle connections close *before* suspension.

- **Stale connections on thaw**: Cached connections may have been closed by the DB server's idle timeout. The pool thinks they're alive, hands one to a query, and the query fails or hangs silently.

**What the adapter must do**: Support **external connection poolers** transparently (PgBouncer, Supavisor, Neon pooler, AWS RDS Proxy). Support **per-request connection** mode. Expose a **pool handle** that platform helpers (`attachDatabasePool`) can manage.

**What the docs must recommend**: `globalThis` singleton pattern for warm-instance reuse. Short idle timeouts (5s). External poolers in production.

#### 3. Edge isolate (V8 isolate, no traditional TCP)

**Frameworks**: Hono (Cloudflare Workers), Next.js (Edge Runtime), Nuxt (Cloudflare/Edge)

Edge isolates are lightweight V8 contexts that often lack TCP socket support. Database access must go through **HTTP-based drivers** or a **connection proxy**. Isolates may be frozen between requests; cached TCP connections go stale silently (no error, no timeout — queries just hang).

**What can go wrong**:

- **No TCP = no traditional pool**: HTTP-based protocol required.
- **Stale connections on reuse**: TCP connections via `cloudflare:sockets` go dead during freeze. Silent hangs.
- **Connection storms at scale**: Thousands of isolates, each hitting the proxy/pooler.

**Solutions in the ecosystem**:

| Solution | How it works | Provider |
|---|---|---|
| **Cloudflare Hyperdrive** | Managed connection proxy within Cloudflare's network; maintains pool near origin database | Cloudflare |
| **Neon serverless driver** | HTTP or WebSocket instead of TCP; stateless per-query or pooled on Neon's side | Neon |
| **PlanetScale serverless driver** | HTTP-based, stateless per-query | PlanetScale |
| **Cloudflare D1** | SQLite-at-the-edge; no external DB connection | Cloudflare |
| **Supabase pooler** | Supavisor in transaction mode; per-request connection | Supabase |

**What the adapter must do**: Accept HTTP-based drivers and connection proxy bindings. Not assume TCP is available. Support per-request connections as default.

#### 4. Dev server with HMR

**Frameworks**: Next.js, Nuxt, SvelteKit, Remix, Astro (in development)

HMR reloads application modules on file changes, re-executing the module that creates the database context. Without protection, each save creates a new abandoned connection pool. After 20-30 saves, the database hits its connection limit.

**What the docs must recommend**: The `globalThis` singleton pattern:

```typescript
const globalForDb = globalThis as unknown as { db: ReturnType<typeof createDb> };
export const db = globalForDb.db ??= createDb({ contractJson, url: process.env['DATABASE_URL']! });
```

This is framework-agnostic — the same pattern works in every meta-framework.

### Summary

| Execution model | Connection strategy | Who pools? | Prisma 8's role |
|---|---|---|---|
| Long-lived server | TCP pool, shared across requests | **Adapter** (internal pool) | Pool config + lifecycle hooks |
| Serverless (Node) | TCP, reused in warm instances | **External pooler** (PgBouncer, RDS Proxy, etc.) | Accept pooler endpoint; expose pool handle |
| Edge isolate | HTTP per-query or connection proxy | **Proxy** (Hyperdrive, Neon HTTP, etc.) | Accept HTTP drivers and proxy bindings; no TCP assumption |
| Dev with HMR | TCP pool, singleton via `globalThis` | **Adapter** (protected from HMR) | Document the singleton pattern |

### Open design decision: adapter driver architecture

Should the adapter be **driver-agnostic** (accept any driver — `pg.Pool`, Neon HTTP, Hyperdrive — and wrap it uniformly), or should there be **separate adapters per driver** (`@internal/postgres-pg`, `@internal/postgres-neon`, `@internal/postgres-hyperdrive`)?

Drizzle chose separate entry points (`drizzle-orm/node-postgres`, `drizzle-orm/neon-http`, etc.). Prisma ORM chose driver adapters as a layer on top of the engine. Both have trade-offs — separate entry points are simpler but fragment the API surface; a uniform adapter with pluggable drivers is more elegant but adds abstraction.

This decision affects every framework integration and must be made before publishing framework guides.

---

## Hard problem 2: Concurrent statefulness under RSC

Next.js (11.2M downloads/week) and Remix (1.1M) use React Server Components. This is the highest-impact integration surface. The challenge is that while the contract is static and easy to import, the **runtime and ORM client are highly stateful**.

### What is stateful

- The **runtime** (`RuntimeCore`) manages a driver (wrapping a connection pool or HTTP client), tracks verification state (`verified`, `startupVerified`, `_telemetry`), holds plugin context, and provides `connection()` / `transaction()` methods that acquire and release database resources.

- The **ORM client** (`orm()`) is a Proxy that lazily caches Collection instances in a `Map` and holds a reference to the runtime. Each query execution goes through `acquireRuntimeScope()` which borrows a connection, executes, and releases.

- **Mutations** are wrapped in transactions (`withMutationScope()`) — open transaction, execute statements, commit/rollback. Inherently stateful and connection-scoped.

### How RSC exposes the statefulness

In RSC, multiple Server Components render **concurrently within the same request**, each independently querying the database through the same shared runtime and ORM client instance.

**Reads in parallel Server Components**: Multiple components calling `db.users.all()` and `db.posts.all()` concurrently should be fine — each `acquireRuntimeScope()` borrows and releases a connection independently. The statefulness is scoped to the connection lifetime, not the ORM client instance.

**Server Actions (mutations)**: Run sequentially (one at a time per request in Next.js). Mutations go through `withMutationScope()` which handles transaction lifecycle automatically. Should work, but the runtime's state must be safe for concurrent reads happening alongside.

**Transactions across components**: If a user wants a transaction spanning operations in different Server Components, the current API has no way to express this — and shouldn't. Transactions should be scoped to a single logical operation, not spread across UI components.

**Connection pool pressure**: A page with 10 Server Components = 10 concurrent connection acquisitions from the pool. A few concurrent page renders could exhaust a pool sized at 10-20 connections. This is the component-level equivalent of N+1.

### What needs validation

The right next step is a **proof-of-concept**: build a Next.js App Router page with multiple parallel Server Components querying through a shared Prisma 8 runtime. Observe connection pool behavior, Collection cache behavior under concurrent access, and runtime state transitions. The PoC should answer:

1. **Concurrency safety of runtime state**: `RuntimeCoreImpl` has mutable flags (`verified`, `startupVerified`) read and written during query execution. Node.js is single-threaded, so there are no CPU-level data races, but `async` interleaving between `await` points can still produce surprising behavior if state transitions aren't atomic across awaits. Does the PoC surface any issues?

2. **ORM client Collection cache**: The `Map` in `orm()` is populated lazily on first access. Concurrent first-access to the same model from parallel Server Components could race on cache population. Is duplicate construction benign (identical instances), or does it cause observable bugs?

3. **Pool sizing guidance**: How should pool size account for RSC's concurrent rendering? The PoC should measure connection acquisition patterns to inform guidance (e.g., expected parallel components per page × concurrent requests).

---

## Hard problem 3: Streaming composition

Prisma 8 is designed around streaming (ADR 124, ADR 125). All queries return `AsyncIterable<Row>`. This is a differentiator over Prisma ORM, which always buffers the entire result set. But the streaming story has three layers, and only the first is designed.

### Layer 1: Database → Runtime (designed)

The runtime returns `AsyncIterableResult<Row>`, wrapping an `AsyncGenerator`. The runtime decides buffer vs. stream based on EXPLAIN estimates or a probe fetch (ADR 125). When streaming, rows arrive via server-side cursor. Backpressure is natural via the async iterator protocol.

Well-specified and partially implemented. The adapter SPI defines `openCursor()`, `execute()`, and `explain()`. Capability flags (`canServerCursor`, `canExplain`) let the runtime degrade gracefully.

### Layer 2: Runtime → Framework response (not designed)

Two fundamentally different use cases:

**Pattern A — Progressive page rendering** (Next.js RSC, Remix `defer`, SvelteKit nested promises): The framework streams HTML chunks. Each Suspense boundary resolves all at once — it collects the query result, renders, and flushes. **Already works.** `AsyncIterableResult` is `PromiseLike`, so `await db.users.all()` in a Server Component collects into an array naturally.

```typescript
async function UserList() {
  const users = await db.users.all()
  return <ul>{users.map(u => <li key={u.id}>{u.name}</li>)}</ul>
}
```

Progressive rendering needs *query-level* concurrency (multiple queries in parallel, each resolving independently), not row-level streaming. This already works.

**Pattern B — Row-level streaming** (API routes, SSE, NDJSON, CSV export): Streams individual rows to the client as they arrive. Requires bridging `AsyncIterable<Row>` to the framework's streaming primitive (`ReadableStream`, `res.write()`, RxJS `Observable`).

| Framework | Streaming primitive | Bridge |
|---|---|---|
| Next.js Route Handler | `ReadableStream` | `ReadableStream.from(result)` or `toReadableStream()` helper |
| Hono | `c.stream()` with `write()` | `for await` loop |
| Express / Fastify | `res.write()` | `for await` loop |
| NestJS | `Observable` or `StreamableFile` | `AsyncIterable` → `Observable` conversion |

The bridges are straightforward, but Prisma 8 should provide a `toReadableStream()` helper with serialization options (NDJSON, CSV) to avoid boilerplate. **This is a lower-priority use case** — most frameworks use Pattern A for page renders, and row-level streaming is primarily for backend export endpoints.

**What must be built for Layer 2**:

1. **`AbortSignal` integration**: ADR 125 specifies it but `AsyncIterableResult` doesn't implement it. When a client disconnects mid-stream, the signal must propagate to close the cursor and release the connection. Without this, abandoned streams leak connections.

2. **`ReadableStream` bridge**: `toReadableStream()` helper with serialization options, working across runtimes.

### Layer 3: Connection lifetime during streaming (intersects connection management)

When a query streams via cursor, the connection is held for the entire stream duration. This creates execution-model-specific problems:

| Execution model | Streaming risk | Mitigation |
|---|---|---|
| **Long-lived server** | Slow client holds connection longer → pool pressure | Budget guardrails (`idleTimeoutMs`, `maxLatencyMs`) abort stalled streams |
| **Serverless** | Connection held for HTTP response duration; frozen function orphans cursor | External poolers time out; but mid-stream freeze is genuinely dangerous |
| **Edge (HTTP driver)** | HTTP drivers don't support cursors — each query is a stateless HTTP request | Force `defaultMode: 'buffer'` when `canServerCursor: false` |
| **Edge (Hyperdrive)** | TCP-like connections, cursors may work within request scope | Should work if cursor completes within the request |

**Key observation**: Row-level streaming use cases (CSV export, large NDJSON feeds) are most common on long-lived backend servers, not edge functions. Edge functions typically serve page renders (Pattern A). Defaulting to `'buffer'` on edge is acceptable — the API surface (`AsyncIterable`) is the same, only the internal strategy changes.

---

## Build tool integration: invisible contract emit

The contract emit step must be invisible to the developer. If users have to remember to run a manual command after editing their schema — the way `prisma generate` worked — then types go stale, the DX is broken, and we've recreated the exact pain point we're trying to eliminate.

### Why Prisma 8 can solve this

In Prisma ORM, the query engine was a Rust binary invoked via a child process. Building build tool plugins that transparently re-run it was impractical — too slow, too fragile, too many platform-specific binaries. In Prisma 8, the entire emit pipeline is pure TypeScript, invoked via `executeContractEmit()` from `@internal/cli/control-api`. This makes build tool plugin integration trivial.

### Proof of concept: Vite plugin

`@internal/vite-plugin-contract-emit` (in this repo) is a working implementation. It watches the config file and its transitive dependencies via Vite's module graph, debounces changes, cancels superseded emits, surfaces errors in Vite's error overlay, and triggers HMR on success. The repo's support promise is intentionally narrow: the package is validated on Vite 7 and Vite 8 via the same HMR integration suite, and there is no separate Vite-8-specific code path today. Usage:

```typescript
import { prismaVitePlugin } from '@internal/vite-plugin-contract-emit';
export default defineConfig({
  plugins: [prismaVitePlugin()],
});
```

### What needs to be built

Equivalent plugins for the remaining build systems:

| Build tool | Frameworks served | Effort estimate |
|---|---|---|
| **Vite** | Nuxt, SvelteKit, Remix, Astro, Hono | **Done for Vite 7/8** (`@internal/vite-plugin-contract-emit`) |
| **Webpack / Turbopack** | Next.js | Medium — Next.js is the highest-priority framework; Turbopack plugin API is still maturing |
| **esbuild** | Cloudflare Workers (Wrangler) | Low — esbuild plugin API is simple |
| **Bun bundler** | Elysia | Low — Bun plugins follow a similar model |

### Unsolved interaction: HMR re-emit and runtime state

When the build tool plugin re-emits the contract after a schema change, HMR fires and downstream modules re-execute. But if the runtime is cached on `globalThis` (the recommended pattern for avoiding connection leaks during HMR — see [Dev server with HMR](#4-dev-server-with-hmr)), the cached runtime instance holds the **old contract**. The re-emitted `contract.json` and `contract.d.ts` are picked up by newly imported modules, but the runtime and ORM client remain stale.

This creates a DX footgun: the types update (IDE shows new fields, renames), but the runtime doesn't (queries use the old contract). The user's code typechecks but fails at runtime — exactly the kind of silent mismatch that erodes trust.

**Likely solution**: Memoize the runtime on the contract hash. The `globalThis` singleton pattern becomes:

```typescript
const globalForDb = globalThis as unknown as { db: ReturnType<typeof createDb>; hash: string };
// (DRY up the following with a helper like createDevDb())
const currentHash = contractJson.storageHash;
if (globalForDb.hash !== currentHash) {
  globalForDb.db = createDb({ contractJson, url: process.env['DATABASE_URL']! });
  globalForDb.hash = currentHash;
}
export const db = globalForDb.db;
```

When the contract is re-emitted with a new hash, HMR re-executes the module, the hash comparison fails, and the runtime reconstructs with the new contract. The old runtime's connection pool is abandoned (acceptable in dev — the DB will reclaim idle connections). This could be encapsulated in a helper (e.g., `createDevDb()`) to avoid boilerplate.

This should be validated during the Next.js PoC to confirm that HMR module re-execution reliably picks up the new `contractJson` import.

### Mechanical bundle requirements

Pure ESM, `contract.json` importable via `with { type: 'json' }`, no Node.js built-ins in core packages, correct `exports` field in all packages. Secondary to the plugin story, but breakage here blocks specific framework setups.

---

## Architectural advantages (solved by design)

These are integration properties that Prisma 8's architecture provides out of the box. They require no further design work, but should be validated during Tier 1 framework integration.

### TypeScript type safety

End-to-end type safety is one of Prisma 8's core promises and a key competitive advantage for framework integration. The type inference chain:

1. **`contract.d.ts`** provides literal types for every model, field, and relation — the source of truth.
2. **`DefaultModelRow<TContract, ModelName>`** maps contract field types to concrete JavaScript types (e.g., `string`, `number`, `boolean`).
3. **Query builders narrow types precisely**: `.select('id', 'email')` produces `Pick<DefaultModelRow<...>, 'id' | 'email'>`, `.include('posts')` extends the row type with the related model's rows.
4. **`AsyncIterableResult<Row>`** implements `PromiseLike<Row[]>`, so `await db.users.select('id', 'email').all()` infers `{ id: number; email: string }[]` — a concrete, inspectable type.

Framework-level type utilities that rely on return-type inference — SvelteKit's `PageData`, Nuxt's `useAsyncData`, tRPC router definitions, Next.js Server Component props — propagate Prisma 8's types to the client automatically, with zero type boilerplate.

**One edge case to validate**: `AsyncIterableResult` implements `PromiseLike`, not `Promise`. TypeScript's `Awaited<T>` handles this correctly, but a framework utility that explicitly checks for `Promise` (via `instanceof` or a nominal type) could reject it. No known framework does this today.

### Multi-tenancy

The architecture supports all tenancy models out of the box. Each instantiation of the stack is fully independent — no module-level singletons or shared global state. Users create separate stacks per tenant, shared stacks with per-connection schema switching, or single stacks with query-level filtering. Resource allocation tradeoffs are theirs.

---

## Remaining integration concerns

### Server-only guarantees

All meta-frameworks enforce a server/client boundary. Prisma 8's runtime packages should never be importable on the client side. Need to verify that tree-shaking and package `exports` don't accidentally expose server code.

### NestJS dependency injection

NestJS (~5M/week) is the only framework that structurally requires a DI wrapper — a `PrismaNextModule` with `forRoot()` configuration and an injectable provider. This is trivial to build (see [Appendix A: NestJS integration pattern](#nestjs-integration-pattern)), but it does need to be published as a package.

---

## Gaps and prioritization

### Blocking gaps (must resolve before framework integration)

| # | Gap | Hard problem | Impact |
|---|---|---|---|
| 1 | **Adapter driver architecture is undefined** — single adapter with pluggable drivers vs. separate packages per driver | Connection mgmt | Blocks every framework integration; the user-facing API depends on this |
| 2 | **RSC concurrency safety is untested** — runtime mutable state and ORM lazy cache under parallel Server Component rendering | RSC statefulness | Blocks confident Next.js integration (11.2M/week) |

### High-priority gaps

| # | Gap | Hard problem | Impact |
|---|---|---|---|
| 3 | **No Webpack/Turbopack contract emit plugin** — Next.js users have no automatic re-emit; must run manual step | Build tool plugins | Breaks the "invisible emit" promise for the #1 priority framework |
| 4 | **HMR re-emit + runtime state mismatch** — `globalThis`-cached runtime holds old contract after re-emit | Build tool plugins | Types update but runtime is stale; silent mismatch in dev |
| 5 | **No `AbortSignal` in `AsyncIterableResult`** — abandoned streams leak connections | Streaming | All frameworks; connection safety |
| 6 | **No framework integration guide** — no documented pattern for Next.js, NestJS, etc. | All | No validated integration surface |
| 7 | **Edge runtime not validated** — untested on Workers, Deno Deploy, Bun | Connection mgmt | Blocks edge differentiation claim |
| 8 | **Connection lifecycle undocumented** — no guidance per execution model | Connection mgmt | Framework guide authors can't recommend correct patterns |

### Medium-priority gaps

| # | Gap | Hard problem | Impact |
|---|---|---|---|
| 9 | **Streaming + connection lifetime undesigned** — no `'buffer'` policy when `canServerCursor: false` | Streaming | Edge/serverless safety |
| 10 | **Bundle size unmeasured** — key competitive claim without data | Other | Can't substantiate edge advantage |
| 11 | **`contract.json` import compatibility** — `with { type: 'json' }` untested across bundlers | Other | Could break specific framework setups |

### Lower-priority gaps

| # | Gap | Hard problem | Impact |
|---|---|---|---|
| 12 | **No NestJS wrapper** — trivial DI wrapper package not yet published | Other | Blocks NestJS adoption (~5M/week), but implementation is straightforward |
| 13 | **No `ReadableStream` bridge** — `toReadableStream()` helper for row-level streaming | Streaming | Advanced use case; most frameworks use Pattern A |

### Recommended framework prioritization

**Tier 1 — Validate first** (highest user impact, proves the integration model):

1. **Next.js** — 11.2M/week. Covers RSC, Server Actions, API Routes, Edge Runtime, serverless. Validates hard problems 1, 2, and 3 simultaneously. Requires a dedicated `@internal/nextjs` plugin (Webpack/Turbopack emit, `globalThis` lifecycle management, RSC patterns).
2. **Express / Fastify** — 30M + 4M/week. Simplest integration (singleton). Validates basic adapter API and lifecycle hooks.
3. **Hono on Cloudflare Workers** — 1.5M/week. Validates edge runtime compatibility — the #1 architectural advantage over Prisma ORM.

**Tier 2 — Build adapters** (requires dedicated packages):

4. **Edge-specific adapters** — HTTP-based drivers for Workers (Neon, PlanetScale, D1).
5. **NestJS module** (`@internal/nestjs`) — 5M/week. Trivial DI wrapper; enterprise adoption depends on it.

**Tier 3 — Documentation** (no new code, just guides):

6. **Nuxt** — 3.1M/week. Similar to Next.js but with Nitro.
7. **SvelteKit** — 1.6M/week. Server load functions.
8. **Remix** — 1.1M/week. Loaders and actions.
9. **Astro** — 1.9M/week. SSR pages and API routes.

**Not prioritized**: RedwoodSDK (Cloudflare-native framework built on Prisma + D1; depends on D1 adapter existing first), Koa/Hapi (declining), Elysia (niche).

---

## Appendix A: Framework landscape

### Adoption tiers (weekly npm downloads, early 2026)

| Tier | Framework | Downloads/wk | Ecosystem | Category |
|---|---|---|---|---|
| **Dominant** | Express | ~30M | Node.js | Backend (legacy) |
| **Dominant** | Next.js | ~11.2M | React | Fullstack meta-framework |
| **Major** | NestJS | ~5M | Node.js | Backend (enterprise) |
| **Major** | Fastify | ~4M | Node.js | Backend (performance) |
| **Major** | Nuxt | ~3.1M | Vue | Fullstack meta-framework |
| **Growing** | Astro | ~1.9M | Agnostic | Content/hybrid meta-framework |
| **Growing** | SvelteKit | ~1.6M | Svelte | Fullstack meta-framework |
| **Growing** | Hono | ~1.5M | Multi-runtime | Backend (edge-native) |
| **Growing** | Remix | ~1.1M | React | Fullstack meta-framework |
| **Niche** | Elysia | ~100K | Bun | Backend (Bun-native) |
| **Niche** | RedwoodSDK | — | React | Fullstack (Cloudflare-native, Prisma + D1) |

### Per-framework integration reference

| Framework | Execution models | Integration pattern | Adapter/package needed? |
|---|---|---|---|
| **Next.js** | Serverless, Edge, HMR | `globalThis` singleton; RSC async components; Route Handlers | **Yes — `@internal/nextjs`** (Webpack/Turbopack emit plugin, lifecycle management, RSC patterns) |
| **Nuxt** | Serverless (Nitro), HMR | Server plugin singleton; `useAsyncData` server-side | No — docs only |
| **SvelteKit** | Serverless, HMR | Module export singleton; `+page.server.ts` load functions | No — docs only |
| **Remix** | Serverless, HMR | Module export singleton; `loader` / `action` | No — docs only |
| **Astro** | Serverless, HMR | Module export singleton; page frontmatter / API routes | No — docs only |
| **Express** | Long-lived server | Module-level singleton | No — docs only |
| **Fastify** | Long-lived server | Plugin registration with lifecycle hooks | No — docs only |
| **NestJS** | Long-lived server | DI module + injectable provider | **Yes — `@internal/nestjs`** |
| **Hono** | Edge (Workers), Node.js, Deno, Bun | Per-request from env bindings (Workers) or singleton (Node) | **Yes — per-driver adapters** |
| **Elysia** | Bun | Singleton | No — same as Hono pattern |
| **RedwoodSDK** | Edge (Workers + D1) | Framework-managed (Prisma + D1) | Not directly — Cloudflare-native framework; depends on D1 adapter existing first |

### NestJS integration pattern

NestJS is the only framework that structurally requires a wrapper package:

```typescript
@Module({
  imports: [PrismaNextModule.forRoot({ contractJson, url: process.env['DATABASE_URL']! })],
})
export class AppModule {}

@Injectable()
export class UserService {
  constructor(@Inject(PRISMA) private db: PrismaHandle) {}
  findAll() { return this.db.orm.user.all(); }
}
```

### Backend singleton pattern

All non-DI backend frameworks (Express, Fastify, Koa, Hapi) use the same pattern:

```typescript
import postgres from '@internal/postgres/runtime';
import type { Contract, TypeMaps } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const db = postgres<Contract, TypeMaps>({
  contractJson,
  url: process.env['DATABASE_URL']!,
});
```

### HMR singleton pattern

All meta-frameworks in dev use the same `globalThis` pattern:

```typescript
const globalForDb = globalThis as unknown as { db: ReturnType<typeof createDb> };
export const db = globalForDb.db ??= createDb({ contractJson, url: process.env['DATABASE_URL']! });
```

---

## Appendix B: Prisma ORM pain points comparison

| Pain point | Root cause in Prisma ORM | Status in Prisma 8 |
|---|---|---|
| Connection exhaustion in Next.js dev | HMR creates new `PrismaClient` instances, each with its own pool | **Same problem, lighter form.** Singleton pattern still needed, but adapter pool is lighter than engine pool. |
| Edge runtime incompatibility | Rust query engine binary can't run in V8 isolates | **Solved.** No binary — pure TypeScript. |
| 1-3s cold starts in serverless | Engine binary initialization | **Solved.** No engine — should be <100ms. |
| ~2MB+ client bundle | Generated client + engine | **Solved.** Contract IR + adapter should be orders of magnitude smaller. |
| Driver adapter complexity | Workaround for edge; adds configuration burden | **Partially solved.** Adapters are primary architecture, not a workaround. But user still chooses driver for their execution model. |
| Serverless connection storms | Each function instance opens its own pool; no cross-instance sharing | **Not solved by architecture alone.** External poolers still required. |
| No result streaming | Always buffers entire result set (`Promise<Row[]>`) | **Solved by design.** `AsyncIterableResult<Row>` streams from cursor. Framework-level integration (AbortSignal, ReadableStream bridge) not yet implemented. |
| `prisma generate` required; stale types | Manual Rust binary invocation; couldn't integrate into build tools because of native binary dependency. Forgetting to run it meant stale types and confusing errors. | **Solved.** Contract emit is pure TypeScript. Build tool plugins (Vite done, Webpack/Turbopack planned) re-emit `contract.json` + `contract.d.ts` automatically on schema change. Users never run a manual step. |
| Mocking difficulty | `PrismaClient` is a complex class with many methods | **Solved.** Interface-based context — plain objects, trivially mockable. |
