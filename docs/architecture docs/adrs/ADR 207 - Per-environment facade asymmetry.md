# ADR 207 — Per-environment facade asymmetry

**Status:** Implemented
**Date:** 2026-05-01
**Domain:** Adapters / Targets, Runtime

## At a glance

A user writing against `@internal/postgres` picks one of two import paths depending on where their code runs.

In a long-lived Node process:

```ts
import { postgres } from '@internal/postgres/runtime';
import contractJson from './contract.json' with { type: 'json' };
import type { Contract } from './contract';

const db = postgres<Contract>({ contractJson, url: process.env.DATABASE_URL! });

// Anywhere in the process:
const users = await db.orm.User.limit(10).all();
```

In a per-request runtime (Cloudflare Workers, AWS Lambda Node, Vercel Edge / Vercel Serverless, Deno Deploy, Bun edge):

```ts
import { postgresServerless } from '@internal/postgres/serverless';
import { withTransaction } from '@internal/sql-runtime';
import { createOrmClient } from './orm-client';
import contractJson from './contract.json' with { type: 'json' };
import type { Contract } from './contract';

const db = postgresServerless<Contract>({ contractJson });

export default {
  async fetch(_req: Request, env: Env): Promise<Response> {
    await using runtime = await db.connect({ url: env.HYPERDRIVE.connectionString });
    const orm = createOrmClient(runtime);
    const users = await orm.User.limit(10).all();
    return Response.json(users);
  },
};
```

The same package; the same `Contract` type; the same `db.sql` plan-builder if either side reaches for it. The two factories take the same option keys at construction (`contractJson`, `extensions`, `middleware`). What differs is everything that touches a connection: the long-lived client gives you a closure-cached `Runtime` (and an `orm` member, and a `transaction()` member, all bound to that runtime); the per-request client gives you a `connect()` entrypoint that returns a fresh `Runtime & AsyncDisposable` per call, and nothing else. ORM and transactions on the per-request side are constructed from the just-acquired runtime, not reached for from a closure.

## Decision

`@internal/postgres` exports two clients with deliberately asymmetric runtime surfaces.

- `postgres()` (`@internal/postgres/runtime`) suits long-lived processes. It closure-caches a `Runtime` and exposes `db.orm`, `db.runtime()`, and `db.transaction(...)` as members of the returned client.
- `postgresServerless()` (`@internal/postgres/serverless`) suits per-request runtimes. It exposes `db.connect(binding)` returning `Promise<Runtime & AsyncDisposable>`, and **omits** `db.orm`, `db.runtime()`, and `db.transaction(...)`. Per-request callers acquire a runtime via `connect()`, build the ORM client from it, run transactions through `withTransaction(runtime, ...)`, and release the connection by letting the `using` scope exit.

The static authoring surface (`db.sql`, `db.context`, `db.stack`, `db.contract`) is identical on both sides — it is a pure function of the contract and never touches a connection. Cursor defaults differ to match the dominant per-side shape (off on Node, on under serverless); both expose a `cursor` option for parity.

The two clients compose the same execution stack underneath (`postgresTarget + postgresAdapter + postgresDriver`). The driver layer is unchanged from one side to the other.

This document is the rationale. The remainder explains why two clients, why they share construction but diverge at the runtime seam, and what each asymmetric difference exists to protect.

## Why two clients, not one

### A long-lived process has one runtime lifetime; the wrapper can match it

A Node process has one beginning and (essentially) one end. A `Runtime` constructed at boot is a `Runtime` valid until shutdown: the underlying `pg.Pool` (or singleton `pg.Client`) handles connection lifecycle internally, query routing serializes through the pool's checkout/release dance, and call sites never have to remember to release anything. Closure-caching the `Runtime` over `(stack, context, contract, driver)` is exactly right for this lifecycle. The same is true of the `orm` client and the `transaction()` member — they thread the cached runtime, and `db.orm.User.limit(10).all()` reads the way a long-lived API should read.

### A per-request runtime has many short, parallel runtime lifetimes; the wrapper cannot match them all with one cache

A per-request runtime — a Cloudflare Worker, a Lambda invocation, a Vercel Edge function, a Deno Deploy handler, a Bun edge response — has no long-lived process to anchor a `Runtime` to. There is an isolate that may handle one `fetch` invocation, several invocations in succession, several invocations in parallel, or be evicted between invocations. The natural unit of "one runtime lifetime" is the `fetch` body itself: it has a clear start (the request arrives) and a clear end (the response is returned, or an error propagates).

Apply the long-lived wrapper shape to that environment and three specific things go wrong:

1. **Stale connections after isolate idle.** A closure-cached `Runtime` outlives any single `fetch`. After a minutes-long idle, the underlying TCP connection has been reaped by the network or the origin, but the cached client object is still in scope. The next `fetch` reaches for `db.orm` and fails with a stale-socket error far from the misconfiguration that caused it.

2. **Head-of-line blocking + cross-`fetch` transaction-state contamination on a shared `pg.Client`.** Multiple `fetch` invocations within one isolate share the closure. `pg.Client` queues queries client-side (FIFO), so concurrent invocations don't race for the wire — they wait. Fetch B's query queues behind fetch A's query and only runs after A's response is parsed, defeating the parallelism the runtime is designed to give. Worse, if fetch A opens a transaction with `BEGIN`, fetch B's queries run inside A's transaction until A's `COMMIT` (or `ROLLBACK`) clears it, contaminating B's reads and writes with A's transaction state. The Node facade avoids this with `pg.Pool` (each query gets its own checked-out connection), but `pg.Pool` is itself a long-lived-process construct: background connection reaping, idle eviction, periodic health checks. Constructing a fresh `pg.Pool` per `fetch` would mean spinning up and tearing down those background tasks on every request — costly and pointless.

3. **No release point.** A `fetch` returning is the natural moment to call `client.end()`, but the closure-cached client has no idea a `fetch` returned. The connection lingers until the isolate evicts. Memory pressure, file-descriptor pressure, or origin-side connection-count limits all surface as later, harder-to-diagnose failures.

The per-request lifecycle therefore needs a wrapper whose runtime acquisition is per-`fetch`, whose runtime release is `using`-bound, and whose surface omits the closure-cached members that would re-introduce all three failure modes.

### What this implies for the wrapper

Reverse the three failure modes and you get the per-request shape:

- The runtime is constructed per `fetch`, not at boot. → `db.connect(binding)` returns a fresh `Runtime` per call.
- The runtime's lifetime is the `fetch` body. → `connect()` returns `Runtime & AsyncDisposable`; consumers use `await using runtime = await db.connect(...)` and disposal is automatic.
- Closure-cached convenience members would re-introduce the cache. → They are omitted; ORM and transactions are constructed from the per-request runtime.

That is the shape the per-request client provides. The static authoring surface (`sql`, `context`, `stack`, `contract`) is preserved as-is because it never touches a connection — it is a pure function of the contract. Caching it once per isolate is a win on both sides.

## What's the same, and what's different

Four concrete differences between the two clients. Each exists to enforce one part of the lifecycle invariant above.

### 1. The static authoring surface is shared; the runtime-bound surface is not

Both sides expose `db.sql` (the plan-builder), `db.context`, `db.stack`, and `db.contract`. None of these reach a connection: `db.sql` builds plans against the contract; `db.context` and `db.stack` are descriptor-shaped values; `db.contract` is the validated contract.

The long-lived client *additionally* exposes `db.orm`, `db.runtime()`, and `db.transaction(...)`. Each of these reaches for the closure-cached `Runtime` and is therefore shape-incompatible with the per-request lifecycle. The per-request client omits all three.

### 2. `connect()` returns an `AsyncDisposable` runtime; consumers use `await using`

```ts
await using runtime = await db.connect({ url: env.HYPERDRIVE.connectionString });
// ... use runtime, ORM, transactions ...
// runtime.close() runs automatically when the fetch body returns
// (including on the throw-and-rethrow path).
```

The returned object carries `[Symbol.asyncDispose]` that calls `runtime.close()`, which ends the underlying `pg.Client`. This is the seam that makes the asymmetry honest. The long-lived client has no scope at which "the runtime is done"; the per-request client does — it is the `fetch` body. Encoding that scope as an `AsyncDisposable` returned from `connect()` makes the lifetime visible at every call site and makes it impossible to forget release.

### 3. ORM and transactions take the runtime; they are not closure-cached

```ts
const orm = createOrmClient(runtime);
const users = await orm.User.limit(10).all();

await withTransaction(runtime, async (tx) => {
  await tx.execute(/* ... */);
  await tx.execute(/* ... */);
});
```

`createOrmClient(runtime)` and `withTransaction(runtime, ...)` are runtime-parameterized helpers that already exist for the Node side (the demo's ORM client follows this pattern). The per-request client uses them unchanged. Re-introducing closure-cached `db.orm` / `db.transaction(...)` members on the per-request client would re-introduce the closure cache they depend on, which would re-introduce the stale-connection failure mode the per-request client exists to prevent.

### 4. Cursor defaults differ to match the dominant per-side shape

The long-lived `postgres()` client defaults `cursor: { disabled: true }`. Long-lived consumers commonly materialize results into containers (arrays, paginated views, batch processors) that benefit from the buffered path's predictability and lower per-row overhead.

The `postgresServerless()` client leaves cursor enabled by default. The dominant per-request shape is "stream a result and return early via `for-await … break`" — exactly what `pg-cursor` is built for, and exactly what isolate memory pressure makes a buffered fetch dangerous for (a 10 000-row result materialized before the first row yields is a foot-gun under any per-request memory budget).

Both clients expose a `cursor` option for parity; the default reflects the dominant shape on each side.

## Consequences

### Positive

- **The lifecycle is visible at the call site.** `await using runtime = await db.connect(...)` reads as "acquire a runtime for this scope; release it when the scope exits". A reviewer can see that the connection is bounded by the `fetch` body without consulting documentation.
- **Stale-connection failures are structurally impossible on the per-request side.** The per-request runtime cannot outlive its `fetch`; there is no closure to cache it in. An isolate that handles two `fetch` invocations gets two independent runtimes.
- **Cross-`fetch` interference is structurally impossible on the per-request side.** Each `fetch` constructs its own `pg.Client`. Concurrent invocations within one isolate cannot block on each other's queue or contaminate each other's transaction state.
- **The runtime-threading pattern is uniform.** `createOrmClient(runtime)` and `withTransaction(runtime, ...)` work the same way on both sides. A user who learns the pattern in one environment carries it forward to the other.
- **Cursor default reflects the dominant shape.** Each side's default fits how that side typically reads results.

### Trade-offs

- **The per-request client is not a drop-in replacement for the long-lived client.** Migrating a Node app to a per-request runtime is not "swap one import for another"; it is also "thread `runtime` through every call site that previously used `db.orm` / `db.runtime()` / `db.transaction()`". This is intended — the lifecycle change *is* the migration — but it is a real cost.
- **Two surfaces to keep symmetric at construction.** The same option keys appear on both factories at the construction boundary (`contractJson`, `extensions`, `middleware`). There is no type-level constraint that enforces this; drift between the two surfaces is an authoring mistake, not a compiler error.
- **One extra line per per-request route to construct the ORM client.** `const orm = createOrmClient(runtime)` is repeated per route. The cost is negligible (the ORM client is a closure over the runtime, not a heavy object) but it is observable.

## Interaction with other ADRs

- **[ADR 159 — Runtime Driver Lifecycle](ADR%20159%20-%20Driver%20Terminology%20and%20Lifecycle.md)** defines the unbound → bound → connected lifecycle of `SqlDriver`. The per-request client uses that lifecycle unchanged: it constructs a fresh `pg.Client` per `connect()` call and routes through the existing `pgClient` `PostgresBinding` kind, which already implements the per-request shape (lazy `client.connect()`, no `pg.Pool`, explicit `client.end()`, mutex-serialized `acquireConnection` for transaction affinity). No new binding kinds were needed.
- **[ADR 155 — Driver/Codec Boundary and Lowering Responsibilities](ADR%20155%20-%20Driver%20Codec%20Boundary%20and%20Lowering%20Responsibilities.md)** governs the codec/driver/lowering split. Both clients sit above that split and inherit it; the asymmetry is at the wrapper layer, not at the driver layer.
- **[ADR 152 — Execution Plane Descriptors and Instances](ADR%20152%20-%20Execution%20Plane%20Descriptors%20and%20Instances.md)** defines the descriptor/instance pattern that both clients compose (`postgresTarget + postgresAdapter + postgresDriver`). The execution stack is the same on both sides.

## Alternatives considered

### One client, runtime always per-call

Keep one `postgres()` factory; have it return a runtime that is *always* per-call. Drop the closure-cached `orm` / `runtime()` / `transaction(...)` from Node too, and require Node consumers to write `await using runtime = await db.connect(...)` per request as well.

**Rejected.** Long-lived processes legitimately benefit from closure-caching: the `pg.Pool` is the right unit of connection lifecycle, the runtime threading is amortized, and the call-site idiom matches the lifetime. Forcing per-call acquisition adds either pool-checkout churn or a layer of indirection that obscures the pooling story, for no safety gain. It would also be a breaking change to every existing Node consumer with no migration story other than "rewrite every route handler".

### One client, `AsyncLocalStorage`-based per-request convenience surface

Keep the `db.orm` / `db.transaction(...)` members. Implement them as accessors that read the "current request's runtime" from an `AsyncLocalStorage` set up at the top of `fetch`.

**Rejected.** Three reasons:

1. The lifecycle becomes invisible. Call sites read like the long-lived shape but behave correctly only if the ALS context is threaded. Forgetting to set it up surfaces as a runtime error far from the cause.
2. It introduces a load-bearing dependency on `node:async_hooks` semantics. Workable on Node and on Workers under `nodejs_compat`, but the polyfill story across other per-request runtimes (Bun, Deno Deploy, edge runtimes that disable Node-compat shims) is uneven.
3. It dilutes the design intent. The per-request client exists to make the per-request lifecycle *explicit and visible*. ALS exists to make context *implicit and invisible*. The two are at odds.

### Per-product clients (`postgresWorkers`, `postgresLambda`, …) instead of per-environment-class

Ship one client per per-request product. Each could carry product-specific ergonomics — e.g. `postgresWorkers({ hyperdrive: env.HYPERDRIVE })` instead of `postgresServerless({ contractJson }) … db.connect({ url: env.HYPERDRIVE.connectionString })`.

**Rejected.** Two reasons:

1. The product-specific ergonomic is shallow. Every per-request runtime exposes "a connection string from somewhere" — `env.HYPERDRIVE.connectionString` on Workers, `process.env.DATABASE_URL` on Lambda, `Deno.env.get('DATABASE_URL')` on Deno, etc. Wrapping each in a bespoke factory just to skip a `.connectionString` field access trades a generic surface for N near-identical surfaces with N maintenance footprints.
2. The lifecycle invariants are uniform across products. Per-request is per-request whether the host is Workers or Lambda. Making the API shape track product instead of lifecycle would invite product-specific lifecycle drift.

The per-environment-class shape (one client, one shape, sourced URL) reflects the actual invariant.
