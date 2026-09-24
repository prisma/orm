# ADR 207 — Codec call context: per-query `AbortSignal` and column metadata

## Status

Accepted. Apr 30, 2026.

Codec query-time methods (`encode`, `decode`) gain an optional second argument: a per-call context object carrying `signal` (framework-level) and family-specific metadata such as SQL's `column` (family-level). The runtime's `execute(plan, { signal })` builds one context per call and threads it to every codec invocation, so codec authors can forward cancellation to their underlying SDK and identify the column at decode time. Resolves the `AbortSignal` half of [ADR 204](./ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md) §"Risks & mitigations" and the decode-side column-identity gap. The concurrency-cap half of ADR 204 §"Risks" stays open; see [framework-gaps G4](../../reference/framework-gaps.md#g4--per-cell-promiseall-codec-dispatch-is-unbounded-for-network-backed-codecs).

## Grounding example

A codec author shipping an encrypted-JSON column type with cancellation and column-aware envelopes:

```ts
import {
  CodecDescriptorImpl,
  CodecImpl,
  type CodecInstanceContext,
} from '@internal/framework-components/codec';
import type { JsonValue } from '@internal/contract/types';
import type { SqlCodecCallContext } from '@internal/sql-relational-core/ast';
import { encryptClient } from './encrypt-client';

class EncryptedJsonCodec extends CodecImpl<
  'encrypted/json@1',
  readonly [],
  string,
  { readonly value: JsonValue; readonly column?: { table: string; name: string } }
> {
  override readonly id = 'encrypted/json@1';
  override readonly traits = [] as const;

  override async encode(value: { value: JsonValue }, ctx: SqlCodecCallContext): Promise<string> {
    return encryptClient.encrypt(value.value, { signal: ctx.signal });
  }
  override async decode(
    wire: string,
    ctx: SqlCodecCallContext,
  ): Promise<{ value: JsonValue; column?: { table: string; name: string } }> {
    const plain = await encryptClient.decrypt(wire, { signal: ctx.signal });
    // SQL family ctx: column is { table, name } when the cell resolves to
    // a single underlying column, undefined for aggregates / computed
    // expressions / include aliases.
    return { value: plain, column: ctx.column };
  }
  encodeJson(v: { value: JsonValue }): JsonValue { return v.value; }
  decodeJson(j: JsonValue): { value: JsonValue } { return { value: j }; }
}

class EncryptedJsonDescriptor extends CodecDescriptorImpl<void> {
  override readonly codecId = 'encrypted/json@1';
  override readonly traits = [] as const;
  override readonly targetTypes = ['jsonb'] as const;
  override readonly paramsSchema = undefined;
  override readonly factory = () => (_ctx: CodecInstanceContext) => new EncryptedJsonCodec();
}
```

The call site supplies the signal once; the runtime forwards the same `AbortSignal` reference to every codec call inside that one query:

```ts
const controller = new AbortController();
request.on('close', () => controller.abort(new Error('client disconnected')));

for await (const row of db.execute(findDocumentsPlan, { signal: controller.signal })) {
  // …
}
```

If the request aborts mid-flight, the runtime returns promptly with a `RUNTIME.ABORTED` envelope (`{ code: 'RUNTIME.ABORTED', details: { phase }, cause }`). Codec bodies that forwarded `ctx.signal` to their SDK see the underlying network call cancel; bodies that ignored the signal complete normally in the background — the runtime does not try to terminate them.

That's the entire user-visible surface. Everything below explains how it composes.

## Decision

The codec dispatch surface gains one named per-call context object that the runtime threads to every `codec.encode` / `codec.decode` invocation for one `runtime.execute()` call. Three load-bearing choices:

- **One context, family-extensible.** The framework declares a signal-only `CodecCallContext`. SQL extends it with `SqlCodecCallContext` adding `column?: SqlColumnRef`. Other families extend with their own per-call shape when they need to. There is exactly one optional parameter to thread, regardless of which fields a given family carries.
- **Runtime owns the context's lifetime.** `runtime.execute(plan, { signal? })` builds **one** `CodecCallContext` per call and forwards the same reference through encode, decode, and the streaming loop. Codec authors observe `signal` identity (`===`) at every call inside one execution.
- **Cooperative cancellation, not termination.** When a signal aborts mid-flight, the runtime returns `RUNTIME.ABORTED` promptly via `raceAgainstAbort`; in-flight codec bodies that ignore the signal continue running in the background. Codec authors that wrap a network SDK forward `ctx.signal` to that SDK; the SDK aborts the wire-level call. The runtime never attempts to terminate the codec body itself.

Everything else — the envelope shape, the abort observation boundaries, where `ctx.column` is populated — falls out from these three choices.

## Why

### The two gaps the dispatch site has to close

Two independent codec-author needs surface at the same place — the per-cell `codec.encode` / `codec.decode` calls inside the runtime's encode and decode loops:

- **Per-query cancellation.** `AbortSignal` is the standard browser-and-Node.js cancellation primitive. KMS-backed codecs (CipherStash's ZeroKMS, Vault, similar) perform real network IO on every encode and decode; without a signal, a cancelled query still completes its in-flight HTTPS round-trip, consuming the network budget for a result no one is waiting for.
- **Decode-side column identity.** Envelope-pattern codecs (encrypted columns, signed columns, audit-stamped columns) need `(table, column)` at decode time to construct return values that participate in subsequent operations the same way the underlying SDK does. Reverse-engineering column identity from runtime data shape is a correctness bug: when the same JS data type backs multiple columns (e.g. two `text` columns), the decoder cannot tell which column produced a given wire value, and any inference from the value alone misattributes cells across columns of the same scalar type.

### Why one ctx instead of two parameters

Threading `(signal, columnRef)` as separate arguments would pin two unrelated slots on a method that callers may grow more demands on. A named context is open: codec authors can grow new fields (observability hooks, cancellation-reason metadata, plan handle) by extending the type, without changing the codec method signature again.

### Why family extension instead of one framework type

Column metadata's natural shape is family-specific. SQL identifies cells by `(table, column)`. Mongo identifies cells by document path. A future graph store would address by node/edge. Pinning a SQL-shaped `column` slot in the framework-agnostic codec context would push family shape into the framework layer — a layering violation. The shape we landed on splits cleanly: framework-agnostic concerns (signal) live on the framework type; family-shaped concerns (column-ref) live on the family type that extends it.

## How it threads

### The types

```ts
// packages/1-framework/1-core/framework-components/src/codec-types.ts
export interface CodecCallContext {
  readonly signal?: AbortSignal;
}

// packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts
export interface SqlColumnRef {
  readonly table: string;
  readonly name: string;
}

export interface SqlCodecCallContext extends CodecCallContext {
  readonly column?: SqlColumnRef;
}
```

The framework `Codec` declares `encode(value, ctx: CodecCallContext)` / `decode(wire, ctx: CodecCallContext)`. The SQL `Codec` redeclares both methods with `ctx: SqlCodecCallContext`. Method-syntax declarations are bivariant under TypeScript's `strictFunctionTypes`, so the SQL interface narrows the parameter type without an unsound cast.

Only the user-facing `runtime.execute(plan, { signal? })` boundary keeps `signal` optional; every internal interface flowing from there — including the codec dispatch surface — declares `ctx` as **non-optional**. The runtime allocates one `CodecCallContext` per `runtime.execute()` call (an empty `{}` when no `signal` was supplied) and threads it as a non-optional reference to every codec call. Codec authors who write `(value) => …` continue to compile via TypeScript's bivariance for trailing parameters, so single-arg author ergonomics are unchanged. Two-arg authors observe the per-call context.

### `runtime.execute(plan, { signal? })`

```ts
// packages/1-framework/1-core/framework-components/src/runtime-middleware.ts
export interface RuntimeExecuteOptions {
  readonly signal?: AbortSignal;
}

export interface RuntimeExecutor<TPlan extends QueryPlan> {
  execute<Row>(
    plan: TPlan & { readonly _row?: Row },
    options?: RuntimeExecuteOptions,
  ): AsyncIterableResult<Row>;
}
```

`RuntimeCore.execute` builds one `CodecCallContext` per call from `options.signal` and forwards it to the abstract `lower(plan, ctx)`. The user-facing boundary `execute(plan, options?)` keeps `options.signal?` optional, but every internal `ctx` parameter from there on is non-optional — the runtime allocates the ctx object once and threads the same reference everywhere. The `signal` field inside the ctx may be `undefined` (when the caller didn't supply one) but the ctx object itself is always present. SQL's `lower` forwards into `encodeParams`. Mongo's `lower` forwards into `MongoAdapter.lower → resolveValue`. SQL's per-row `decodeRow` receives the same ctx and constructs per-cell `SqlCodecCallContext` wrappers carrying `column = { table, name }` for resolvable cells.

### Flow

```text
RuntimeCore.execute({ signal? })
  └─ codecCtx = signal === undefined ? {} : { signal }   // ctx always allocated
     ├─ lower(plan, codecCtx)
     │   ├─ SQL: encodeParams(plan, registry, codecCtx)
     │   │       └─ raceAgainstAbort(Promise.all(codec.encode(v, ctx)), signal, 'encode')
     │   └─ Mongo: adapter.lower(plan, codecCtx)
     │             └─ resolveValue(value, codecs, codecCtx)
     │                   └─ raceAgainstAbort(Promise.all(...), signal, 'encode')
     │                       └─ codec.encode(v, ctx)
     │
     └─ stream (SQL only):
         for await (rawRow of driver.cursor) {
           checkAborted(codecCtx, 'stream')
           decodeRow(rawRow, exec, registry, validators, codecCtx)
             └─ raceAgainstAbort(Promise.all(decodeField(...)), signal, 'decode')
                   └─ codec.decode(wire, { ...rowCtx, column: { table, name } })
         }
```

### Where the runtime observes abort


| Boundary                                              | SQL phase tag | Mongo phase tag                         |
| ----------------------------------------------------- | ------------- | --------------------------------------- |
| Entry pre-check (before any work)                     | `stream`      | `stream` (inherited from `RuntimeCore`) |
| Mid-encode (per-level `Promise.all` of codec encodes) | `encode`      | `encode`                                |
| Mid-decode (per-cell `Promise.all` of codec decodes)  | `decode`      | — (Mongo read path doesn't decode)      |
| Between rows in the stream loop                       | `stream`      | —                                       |


Phase tags map onto codec dispatch sites; families gain more tags as they gain more dispatch.

### The error envelope

```ts
// packages/1-framework/1-core/framework-components/src/runtime-error.ts
export const RUNTIME_ABORTED = 'RUNTIME.ABORTED' as const;
export type RuntimeAbortedPhase = 'encode' | 'decode' | 'stream';

export function runtimeAborted(
  phase: RuntimeAbortedPhase,
  cause?: unknown,
): RuntimeErrorEnvelope;
```

`runtimeAborted(phase, cause?)` builds an envelope with `code: 'RUNTIME.ABORTED'`, `details: { phase }`, and `cause` carrying `signal.reason` verbatim — native abort produces a `DOMException`; explicit `controller.abort(reason)` produces whatever the caller passed; if the caller passes nothing, `cause` is `undefined`. No synthesis happens. Falsy reasons (`null`, `false`, `0`, `''`) round-trip unchanged. Every dispatch site goes through this helper so the envelope shape is identical regardless of phase.

### Where `ctx.column` is populated

`SqlCodecCallContext.column` is populated **at decode time, for resolvable cells**:

- The SQL decoder projects `column = { table, name }` per cell from the same `ColumnRef` resolution that `RUNTIME.DECODE_FAILED` envelope construction already runs — one resolution per cell, two consumers.
- Cells that don't resolve to a single underlying column (aggregate aliases, computed projections, include-aggregate fields) get `column: undefined`. Codec authors that need column identity must handle the undefined case explicitly; the runtime never silently defaults it.
- When the runtime cannot project `column` for a cell, the per-cell ctx **drops the field entirely** rather than passing the row-level context through unchanged — preventing a previously-populated `rowCtx.column` from leaking into unrelated cells when callers reuse a context object.

Encode-side `ctx.column` is intentionally always undefined. The same encode site encodes parameters for predicates, expressions, and aggregations whose column identity is ambiguous. Encode-time column context is the middleware's domain — a middleware that walks a plan can attach richer column metadata to outbound parameters before encode begins (documented as still-open encode-side enrichment under [framework-gaps G1](../../reference/framework-gaps.md#g1--codecs-receive-no-per-call-column-metadata)).

## What this enables

- **KMS-backed codecs forward `ctx.signal` to their SDK.** `bulkEncrypt({ signal: ctx.signal })`, `fetch(url, { signal: ctx.signal })`. Aborted requests stop talking to the network service; cold-start budgets stop being consumed for results no one is waiting for; transaction deadlines propagate down to the codec's underlying IO.
- **Envelope-pattern decryption.** A codec wrapping a wire value into a return object carrying column identity can construct that envelope from `ctx.column` directly, instead of reverse-engineering column identity from JS data type.
- **Future bulk-encrypt / bulk-decrypt at the middleware layer.** The decode-side column metadata is now plumbed end-to-end; a future middleware that walks a plan can colocate per-column codec calls into bulk SDK calls without touching the codec author surface.
- **Prompt cancellation for both families.** Mongo callers consuming long aggregations get prompt `RUNTIME.ABORTED { phase: 'stream' }` on already-aborted entry. SQL callers get the same plus prompt `phase: 'encode'` and `phase: 'decode'` mid-flight observation.

## Non-goals (deliberate)

- **No concurrency cap, no rate limit, no batched dispatch.** A query that touches N rows × M codec'd cells still issues N × M concurrent codec calls. Bounding fan-out is tracked under [framework-gaps G4](../../reference/framework-gaps.md#g4--per-cell-promiseall-codec-dispatch-is-unbounded-for-network-backed-codecs). The codec author surface is forward-compatible — a future `bulkEncode` / `bulkDecode` slot lands additively.
- **No driver-level statement cancellation.** When the runtime returns `RUNTIME.ABORTED` mid-stream, the underlying database driver's in-flight statement is not cancelled at the wire level. Iterator-close cleanup runs (cursor released, connection returned to pool); the server may keep producing rows for a moment after the runtime stops consuming. Wiring `signal` into Postgres `pg_cancel_backend` / Mongo `killCursors` is separate work.
- **No transaction-scoped abort composition.** Each `runtime.execute` builds its own per-execute context; the transaction wrapper doesn't compose deadline / cancel-on-rollback signals automatically. Callers compose their own controllers if they need transaction-scoped timeouts.
- **No structured cancellation reason taxonomy.** `cause` carries `signal.reason` verbatim; no normalization, no enrichment.

## Edge cases worth knowing

### Cooperative cancellation, not termination

`raceAgainstAbort(work, signal, phase)` returns `RUNTIME.ABORTED` as soon as the signal aborts, but the rejected `Promise.all` does not stop the underlying codec bodies. In-flight HTTPS round-trips, file reads, etc. continue to run and complete in the background. The contract codec authors are expected to honour: if your codec wraps a network SDK, forward `ctx.signal` to the SDK so the SDK aborts the wire-level call. If your codec is pure CPU work, ignore the signal and complete normally — abandoning a few microseconds of computation is fine.

### Phase tags are sampled, not subscribed

Between-rows `signal.aborted` checks are sampled at the SQL streaming for-await body. A signal that aborts immediately after a check passes won't trigger `phase: 'stream'`; the next `decodeRow`'s race triggers `phase: 'decode'` instead. The runtime cannot get into a stuck state — but the `phase` tag is a hint about which await observed the abort, not a hard guarantee. The cause chain (`error.cause === signal.reason`) and the envelope shape (`code === 'RUNTIME.ABORTED'`) are stable.

### Driver iterator cleanup runs on abort

When the streaming generator throws `RUNTIME.ABORTED`, the runtime explicitly calls `iterator.return?.()` in a `finally` block, which propagates cleanup down to the driver's `try/finally` (releasing cursors, returning connections). Drivers that yield rows via async iterators must clean up under iterator-close. This is not a new contract — it has always been required for normal `break`-out-of-for-await consumption — but `RUNTIME.ABORTED` makes it observable.

### Ordering: abort check before next driver row

The streaming loop is hand-driven (`while (true) { check; await iterator.next(); … }`) rather than `for-await-of`, so the between-rows abort check fires *before* the driver is asked for the next row. With `for-await-of`, the loop awaits `iterator.next()` first and the check fires after — leaving a window where one extra row is pulled even after the signal aborted.

## Alternatives considered

### A single `CodecCallContext` with a SQL-shaped `column` slot

The first round of this work landed `column?: { table; name }` on the framework-level `CodecCallContext`. We rejected it on the second round: SQL's column identity is family-specific (Mongo identifies cells by document path, a future graph store by node/edge), so pinning a SQL slot at the framework level pushes family shape into the framework layer. The corrective shape — framework declares signal-only, families extend with their own per-call metadata — is what we landed.

### Two parameters: `(value, signal, columnRef)`

Threading `signal` and `columnRef` as separate arguments would pin two unrelated slots on a method that callers may grow more demands on. A named context grows additively: future fields (observability, cancellation-reason metadata, plan handle) land without re-touching the method signature.

### Standard `abortable(signal)` instead of closure-local sentinel

The natural way to race a promise against a signal is `Promise.race([work, abortable(signal)])`, where `abortable` rejects with `signal.reason ?? new DOMException(...)`. That makes the rejection source ambiguous: a codec body that itself throws a `DOMException` is not stably distinguishable from an abort. We use a closure-local sentinel object instead — only the listener installed in this call ever rejects with this object reference — and an `error === sentinel` identity check after the race is unambiguous. This is load-bearing: a codec that throws `RUNTIME.ENCODE_FAILED` / `RUNTIME.DECODE_FAILED` passes that envelope through unchanged, even when a signal is supplied. The abort race never rewraps a codec-thrown envelope.

### Synchronous abort in the codec body

We considered having the runtime forcibly terminate codec bodies on abort, by passing an `AbortSignal` that the codec is expected to throw on. Rejected: termination semantics for in-flight network IO live in the SDK, not the runtime. The cooperative-cancellation model — runtime returns promptly, codec bodies clean up via the SDK — matches every other `AbortSignal`-aware Promise API in the broader ecosystem and avoids the runtime trying to express semantics the codec body is the right place to own.

### Encode-side `ctx.column`

We considered populating `ctx.column` for encode calls too. Rejected: the same encode site encodes parameters for predicates, expressions, and aggregations whose column identity is ambiguous. Encode-time column context is the middleware's domain — a middleware can walk the plan and attach richer column metadata to outbound parameters before encode begins. See [framework-gaps G1](../../reference/framework-gaps.md#g1--codecs-receive-no-per-call-column-metadata).

### Eager driver-level cancellation

We considered wiring `signal.aborted` directly into the driver's wire-level cancellation primitive (Postgres `pg_cancel_backend`, Mongo `killCursors`) so that `RUNTIME.ABORTED` cancels the server's in-flight statement too. Out of scope for this ADR — the ctx seam is the prerequisite, not the implementation. A future change wires the driver side; the runtime side is ready.

### Interaction with ADR 204's walk-back constraints

ADR 204 enumerates seven shapes the public codec surface must not regrow as concurrency / cancellation work lands. We considered each before landing this design:


| ADR 204 walk-back constraint                                                                         | Held?                                                                                |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| No `TRuntime` generic on `Codec`                                                                     | Held — `Codec` retains exactly four type parameters.                                 |
| No `kind` / `runtime` discriminator field on `Codec`                                                 | Held — `ctx` is a method parameter, not an interface field.                          |
| No conditional return types on `encode` / `decode`                                                   | Held — return types remain `Promise<TWire>` / `Promise<TInput>` regardless of arity. |
| No exported sync-vs-async predicates                                                                 | Held — no new predicates exported.                                                   |
| No `Codec.context` alias tying context shape to async-ness                                           | Held — `CodecCallContext` is a named context interface, not a `Codec.context` alias. |
| Codec author surface stays "may write sync or async; factory accepts both" — now plus optional `ctx` | Held — the factory accepts sync or async authors of either arity, lifts uniformly.   |
| `Codec` retains exactly four type parameters                                                         | Held.                                                                                |


The required second-arg shape on the `Codec` interface doesn't tie context to async-ness or runtime-shape; it adds a per-call value the dispatch surface threads orthogonally. Single-arg author functions remain legal via bivariance for trailing parameters. The future additive `codecSync()` opt-in ADR 204 framed remains available — `codecSync({ encode: (value, ctx) => … })` is the natural extension if the sync fast-path lands later.

## References and implementation pointers

- [ADR 204 — Single-Path Async Codec Runtime](./ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md). Establishes the always-await codec runtime model and names `AbortSignal` plumbing as a known gap; this ADR resolves that half.
- [ADR 027 — Error Envelope Stable Codes](./ADR%20027%20-%20Error%20Envelope%20Stable%20Codes.md). Defines the envelope shape (`code`, `details`, `cause`) used by `RUNTIME.ABORTED`.
- [framework-gaps G4](../../reference/framework-gaps.md#g4--per-cell-promiseall-codec-dispatch-is-unbounded-for-network-backed-codecs) — concurrency cap / bulk-codec dispatch (still open alongside this ADR's `AbortSignal` work).
- [framework-gaps G1](../../reference/framework-gaps.md#g1--codecs-receive-no-per-call-column-metadata) — encode-side richer column metadata via middleware (out of scope for this ADR).
- [WHATWG `AbortSignal` / `AbortController](https://dom.spec.whatwg.org/#interface-abortsignal)`. The cancellation primitive used end-to-end.

Implementation lives across `framework-components` (`codec-types.ts`, `runtime-error.ts`, `race-against-abort.ts`, `runtime-core.ts`, `runtime-middleware.ts`), `relational-core/src/ast/codec-types.ts`, the SQL runtime's encode/decode/streaming paths, and the Mongo adapter / runtime threading. Behavioural and type-level test pins sit alongside each subject file under `test/`. End-to-end abort coverage against real drivers lives at `test/integration/test/sql-builder/execution-abort.test.ts` and `test/integration/test/mongo/execution-abort.test.ts`. Full implementation history is in PR [#400](https://github.com/prisma/prisma-next/pull/400).