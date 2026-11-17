# Framework Gaps — what Prisma 8 is missing for an extension like CipherStash

> Companion to [system-design-review.md](./system-design-review.md), [code-review.md](./code-review.md), and [walkthrough.md](./walkthrough.md).
>
> Audience: the **Prisma 8 framework team**. The CipherStash integration is the first non-trivial real-world consumer of the post-#379 / [ADR 204](../../../docs/architecture%20docs/adrs/ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md) extension surface. This document collects every place where the integration paid a measurable tax — code it had to write, types it had to vendor, behavior it had to document around — because of a missing or under-specified framework seam. Each gap names the workaround the integration ships today and what the framework should provide so the workaround can be deleted.
>
> Scope: branch `prisma-next` of `cipherstash/stack` vs `origin/main`, head commit `8e8e5a2`. Integration code under [reference/cipherstash/stack/packages/stack/src/prisma/](../../../reference/cipherstash/stack/packages/stack/src/prisma/).

---

## How to read this document

Each gap is presented as:

- **Symptom** — what an extension author or end user sees today.
- **Why the extension needs this** — the underlying requirement that *forces* the gap, plus where the requirement comes from (CipherStash-specific vs broadly applicable). This is the section that informs whether the right solution lives framework-side or extension-side.
- **Today's workaround** — what the integration does to ship without the framework support, with a code link.
- **What the framework should provide** — the concrete API or behavior change.
- **Payoff** — the file/code that would delete or shrink in the integration once it lands.

Severity:

- **🟥 Correctness** — without this, the integration cannot deliver the right answer in some real contracts; today's workaround is "fail closed" or "document and warn".
- **🟧 Author DX / capability** — the integration ships, but the surface it can offer to the end user is smaller / less ergonomic than the framework should make possible.
- **🟨 Papercut** — the integration works fine, but writing it took more code or more cleverness than it should have.

---

## 🟥 Correctness gaps

### G1 — Codecs receive no per-call column metadata

> **Status: 🟡 Partially resolved (2026-04-30).** Decode-side `(table, name)` is now plumbed via `SqlCodecCallContext.column` — see [ADR 207 — Codec call context: per-query `AbortSignal` and column metadata](../architecture%20docs/adrs/ADR%20207%20-%20Codec%20call%20context%20per-query%20AbortSignal%20and%20column%20metadata.md). SQL codec authors that take a `(value, ctx)` author signature on `decode` observe `ctx.column = { table, name }` for cells the runtime can resolve, and `undefined` for unresolvable cells (aggregate aliases, computed projections). Encode-side richer column metadata (search-mode flags, full column descriptors) stays open: encode-time enrichment is the middleware's domain — the per-cell `ctx.column` is intentionally undefined on encode because the same encode site encodes parameters for predicates and expressions whose column identity is ambiguous. See *Middleware-driven param transformation* ([TML-2359](https://linear.app/prisma-company/issue/TML-2359)). The original problem statement below stands as historical context; the integration's `dataType → first matching ColumnBinding` workaround can be replaced for the decode path today.

**Symptom.** A contract that has two encrypted columns of the same JS data type (e.g. `users.email` with `equality: true` and `users.notes` with `freeTextSearch: true`, both `string`) silently encrypts both under the **first** matching column's index configuration. The wrong indexes get attached to the cipher; equality lookups on `email` work, free-text search on `notes` is silently broken.

**Why the extension needs this.** CipherStash's `bulkEncrypt` is a **column-aware operation**: the cipher payload it produces embeds the column's `(table, column)` identity (the SDK reads `i.t` / `i.c` off the cipher) **and** an index payload whose shape depends on the column's enabled search modes. The same plaintext value `'alice@example.com'` encrypts *differently* for `users.email` (`equality: true` → cipher carries the HMAC index payload) than for `users.notes` (`freeTextSearch: true` → cipher carries the bloom-filter payload). So at encode time the codec **must** know the destination column. The framework's `encode(value)` signature gives it only the value.

This is unusual among codecs: most codecs map `(input, typeParams) → wire` deterministically, with column identity irrelevant. CipherStash needs column identity because *the wire format itself encodes column-specific configuration*. Other extensions that would have this requirement: tokenization vaults with column-scoped tokens, signing codecs with column-scoped keys, audit-stamping codecs with column-specific schema. **It's a narrow class** — most "real" codecs (compression, custom JSON, uuid, vector) do not need it. But the class includes everything in the "encrypt-or-tokenize sensitive data" bucket, which is broadly important.

The deeper observation: what CipherStash actually wants is for the column-specific configuration (table name, column name, search modes) to be *fixed at codec construction time*, not passed at every encode. If the framework instantiated **one codec per `StorageTypeInstance`** (one per `(table, column)` pair declared in the contract), the codec's `init(params)` could close over the column identity, and `encode(value)` could remain pure. The codec doesn't need column metadata at encode time; it needs column-keyed *instances*.

**Today's workaround.** The integration approximates `(table, column)` from the JS-runtime data type by pre-indexing the contract `dataType → first matching ColumnBinding`:

```68:96:reference/cipherstash/stack/packages/stack/src/prisma/core/encryption-client.ts
function indexSchemasByDataType(
  schemas: ReadonlyArray<EncryptedTable<EncryptedTableColumn>>,
): ReadonlyMap<EncryptedDataType, ColumnBinding> {
  const index = new Map<EncryptedDataType, ColumnBinding>()
  for (const table of schemas) {
    const built = table.build()
    for (const [columnName, columnSchema] of Object.entries(built.columns)) {
      const castAs = columnSchema.cast_as
      const dataType = dataTypeFromCastAs(castAs)
      if (!dataType) continue
      if (index.has(dataType)) continue
      // ... first match wins
```

The JSDoc on `createEncryptionBinding` calls this out explicitly:

```17:31:reference/cipherstash/stack/packages/stack/src/prisma/core/encryption-client.ts
 * Upstream gap (documented in audit F-10/F-30): Prisma 8's
 * `encodeParam` / `decodeRow` doesn't currently surface column
 * metadata to `codec.encode` / `codec.decode`. Phase 3 approximates
 * this by dispatching by JS-runtime data type and picking the first
 * matching column's binding from the contract.
```

**What the framework should provide.** Recommended: **(2) per-instance codec parameterization**.

1. Pass `(table, column, typeParams)` (or a richer `EncodeContext` object) to `codec.encode` / `codec.decode`. **Drawback**: hot-path overhead on every encode for a need most codecs don't have; the column-aware codec class is narrow.
2. **(Recommended)** Allow extensions to register one codec instance per `StorageTypeInstance` — parameterized codec instantiation. The codec graph already knows which column it serves at construction time; `encode` stays pure. Keeps the codec interface unchanged for the codecs that don't need column identity.

(2) is the natural fit for the unified `CodecDescriptor` factory (`[reference/cipherstash/stack/packages/stack/src/prisma/exports/runtime.ts (L78–L83)](../../../reference/cipherstash/stack/packages/stack/src/prisma/exports/runtime.ts)` — the integration already declares a `paramsSchema` for the storage codec but the runtime never actually instantiates per-instance codecs from it). The descriptor's curried `factory(params)(ctx)` signature exists for exactly this use case; honoring it closes the gap.

Tracked upstream as part of [TML-2330](https://linear.app/prisma-company/issue/TML-2330) (column-context plumbing).

**Payoff.** Delete `indexSchemasByDataType`, `dataTypeFromCastAs`, the `ColumnBinding` map, and `requireColumnFor` in `core/encryption-client.ts`. Delete the `dataType` arg threading in `core/codec-storage.ts`'s batcher map. Delete the entire NO_COLUMN_FOR_DATATYPE error path. The risk **R3** in `./spec.md` and architectural risk **A1** in `./system-design-review.md` go away.

---

### G2 — `planTypeOperations` receives `typeName`, not `(table, column)`

**Symptom.** The migration planner can't tell the codec hook *which column* a `StorageTypeInstance` belongs to. The integration must guess, and a guess that fails produces silent no-DDL.

**Why the extension needs this.** The DDL the extension generates contains the table name and column name as **literal SQL string arguments**, not just metadata:

```sql
SELECT eql_v2.add_search_config('users', 'email', 'unique', 'text')
```

`(table, column)` are baked into the generated SQL in three places per emitted operation:

1. The `add_search_config(...)` call (positional args 1 and 2).
2. The precheck SQL: `data #> ARRAY['tables', 'users', 'email', 'indexes'] ? 'unique'` — EQL's configuration is stored as JSONB keyed by `tables → <table> → <column> → indexes → <index>`, so the extension has to write those names into the JSONB path expression.
3. The postcheck SQL (same JSONB-path shape).

Without `(table, column)`, the extension cannot generate the DDL it ships. There is no reformulation that hides the names — EQL's data model is keyed by `(table, column)`, end of story.

This is **broadly applicable** to extension authors. Every extension whose per-column DDL embeds the column name in the emitted SQL hits the same need:

- Vector indexes: `CREATE INDEX users_embedding_idx ON users USING ivfflat (embedding vector_cosine_ops)`.
- PostGIS spatial indexes: `CREATE INDEX ... ON locations USING gist (geom)`.
- Trigram FTS: `CREATE INDEX ... ON notes USING gin (body gin_trgm_ops)`.
- Per-column triggers / row-level policies / generated columns / check constraints scoped by name.

The framework already knows `(table, column)` — when it walks the contract to call `planTypeOperations`, it dispatches the call *because* a specific column references a specific type instance. The information is one stack-frame away. The integration's `<table>__<column>` parsing is reverse-engineering identity from a name the framework happens to mint.

**Today's workaround.** Parse a `<table>__<column>` separator out of `typeName`; on failure return zero operations rather than wrong DDL.

```192:209:reference/cipherstash/stack/packages/stack/src/prisma/core/database-dependencies.ts
/**
 * Identify (table, column) for a typeInstance. The post-#379 contract
 * model keeps named type instances as keys in `storage.types`, with the
 * key carrying a stable `<table>__<column>` shape *or* a custom name.
 * Phase 3 supports the `<table>__<column>` shape and falls back to the
 * raw typeName when it can't split cleanly. Real Phase 4 work will
 * read `(table, column)` directly off the contract once the planner
 * passes a richer input.
 */
function deriveTableAndColumn(
  typeName: string,
): { table: string; column: string } | null {
  const idx = typeName.lastIndexOf('__')
  if (idx <= 0 || idx >= typeName.length - 2) return null
  const table = typeName.slice(0, idx)
  const column = typeName.slice(idx + 2)
  return { table, column }
}
```

This is a handshake with the planner that neither side enforces. A user-named encrypted type, or a future planner that emits a different separator, makes the integration emit no `add_search_config(...)` calls — silently — and indexes never appear.

**What the framework should provide.** Pass `(tableName, columnName)` (and the resolved column descriptor) directly on the `PlanTypeOperationsInput`:

```ts
interface PlanTypeOperationsInput {
  readonly typeName: string
  readonly typeInstance: StorageTypeInstance
  // NEW: where this type instance is actually used.
  // For shared / reused types, the planner emits one input per call site.
  readonly usedAt: ReadonlyArray<{ table: string; column: string }>
  // ...
}
```

Optionally, allow the hook to return a structured warning when it sees a typeName / usage it can't act on, surfaceable by the planner CLI rather than swallowed.

**Payoff.** Delete `deriveTableAndColumn` and the `<table>__<column>` convention. The "fail-closed silent no-op" disappears (architectural risk **A2** in `./system-design-review.md`, finding **F05** in `./code-review.md`).

---

### G3 — `planTypeOperations` has no view of prior contract state

**Symptom.** Disabling a search mode on an encrypted column (`equality: true → false`) does not drop the EQL search index. The DDL is "additive only"; old indexes persist forever.

**Why the extension needs this.** The extension owns persistent state inside the database — entries in `eql_v2_configuration` written by previous `add_search_config(...)` calls. When the contract changes to disable a search mode, the prior configuration entry is now orphaned: it doesn't match the contract anymore, but it still consumes index space and may interfere with future `add_search_config(...)` calls on the same `(table, column, index_name)`. Cleaning it up requires emitting `eql_v2.remove_search_config(table, column, index_name)`.

To know *what to remove*, the extension needs to compute a diff: "which search modes were enabled before that aren't enabled now". That requires both `before.typeParams` and `after.typeParams`. The current `planTypeOperations` only passes `after`.

This is the **standard schema-diff problem**. Prisma's mainline migration system has always needed before/after — that's what `prisma migrate dev` does. The codec-control hook is missing the half of the input that every other migration step gets.

Applicability: **broadly relevant**. Any extension that registers persistent per-column state needs cleanup-on-removal. Vector indexes (drop the IVFFLAT index when the column type changes), PostGIS triggers, FTS materialized views, audit-log triggers, generated columns, check constraints, foreign keys with `ON DELETE` actions, RLS policies. The class is roughly "extensions whose effect on the database is *not* purely a function of the current contract — it has hysteresis, and previous state must be undone".

**Today's workaround.** The integration explicitly only emits additive `add_search_config(...)` ops and documents the limitation:

```238:244:reference/cipherstash/stack/packages/stack/src/prisma/core/database-dependencies.ts
 *   - Removing a search-mode flag (e.g. `equality: true → false`)
 *     should emit `eql_v2.remove_search_config(...)` for the dropped
 *     mode. The current `planTypeOperations` API doesn't carry the
 *     prior-state typeParams, so we can't compute the diff directly.
 *     Phase 4 should consume the `fromContract` planner input once
 *     it's standardized; for now the hook only emits additive
 *     operations.
```

**What the framework should provide.** A `fromContract` (and `fromTypeInstance` for the matching prior type instance, if any) on the planner input:

```ts
interface PlanTypeOperationsInput {
  readonly typeName: string
  readonly typeInstance: StorageTypeInstance       // current
  readonly fromTypeInstance?: StorageTypeInstance  // prior, if any
  readonly fromContract?: unknown                  // prior whole-contract for cross-cutting reasoning
  // ...
}
```

This unblocks every "destructive op needs to look at the diff" extension, not just CipherStash.

**Payoff.** A new `planRemoveSearchConfig(prior, current)` branch in `core/database-dependencies.ts` becomes implementable. Removes deferred item **D09** in `./code-review.md`.

---

### G4 — Per-cell `Promise.all` codec dispatch is unbounded for network-backed codecs

> **Status: 🔴 Open (2026-04-30).** Tracked under [TML-2330](https://linear.app/prisma-company/issue/TML-2330). The codec-call-context project ([ADR 207](../architecture%20docs/adrs/ADR%20207%20-%20Codec%20call%20context%20per-query%20AbortSignal%20and%20column%20metadata.md)) intentionally did not address concurrency control or bulk-codec dispatch — it lands the per-call `ctx` seam that a future bulk dispatcher / concurrency cap can use, but the existing `Promise.all` shape is unchanged. Microtask-coalescing batchers in extension code (the CipherStash workaround below) remain the operational path until the framework grows a `bulkEncode` / `bulkDecode` slot or a per-codec concurrency cap.

**Symptom.** Without a workaround, an `INSERT` of 100 rows × 3 encrypted cells issues 300 concurrent `bulkEncrypt` round-trips against ZeroKMS — the codec runtime treats each cell as an independent encode and `Promise.all`s them. ZeroKMS rate-limits, the request fan-out flatlines the database connection, the user sees mysterious latency.

**Why the extension needs this.** Two distinct properties of CipherStash's `bulkEncrypt(items[])` SDK call combine to make per-cell encoding catastrophic:

1. **Network-backed.** Each call is an HTTPS round-trip to ZeroKMS. RTT per call is non-trivial (10–100 ms depending on region). 300 sequential RTTs ≈ unbounded latency; 300 concurrent RTTs ≈ rate limit.
2. **Bulk-amortizable crypto.** A `bulkEncrypt([...100 items])` call performs *one* key-derivation cycle and produces 100 ciphers. Calling `encrypt(item)` 100 times performs 100 key-derivations. The marginal cost of adding values to a bulk call is near-zero; the per-call cost dominates.

So the extension needs not just "fewer round-trips" but "fewer round-trips with all the values in one payload". Microtask coalescing into a single bulk call satisfies both properties.

The deeper requirement: the codec wants to express *"I have a cheaper bulk variant than calling `encode(v)` N times"*. Today's framework gives it no way to say so; the extension reverse-engineers batching from microtask-window timing, exploiting the implementation detail that the runtime synchronously calls `encode` for every cell before any returned Promise resolves.

Applicability: **broad among "real" codecs**. Any codec that talks to a network service (KMS, vault, schema registry, signing service, remote ID-issuer) hits property (1). Any codec where bulk operations amortize setup costs (compression with shared dictionaries, batch-signed audit writes, tokenization with batched vault ops) hits property (2). Pure-CPU codecs (compression, custom JSON, uuid generation) don't need it. The split is roughly "in-process codecs vs codecs backed by services".

**Today's workaround.** A microtask-coalescing batcher embedded in the codec body:

```30:62:reference/cipherstash/stack/packages/stack/src/prisma/core/batcher.ts
export function createBatcher<TIn, TOut>(
  flush: FlushFn<TIn, TOut>,
): Batcher<TIn, TOut> {
  let pending: Array<Pending<TIn, TOut>> = []
  let scheduled = false
  const drain = async (): Promise<void> => {
    const batch = pending
    pending = []
    scheduled = false
    if (batch.length === 0) return
    try {
      const results = await flush(batch.map((entry) => entry.value))
      // ... per-entry resolve / reject ...
    }
  }
  return {
    enqueue(value: TIn): Promise<TOut> {
      return new Promise<TOut>((resolve, reject) => {
        pending.push({ value, resolve, reject })
        if (!scheduled) {
          scheduled = true
          queueMicrotask(() => { void drain() })
        }
      })
    },
  }
}
```

This is **load-bearing**. Without it the integration is operationally untenable. It works, but it lives entirely in extension code and exploits a runtime-implementation detail (that `Promise.all` of codec calls all enqueue inside one microtask window). If the runtime ever schedules codec calls across microtasks — e.g. yields between rows — the batcher silently degrades back to N×M round trips with no test failure.

It also doesn't help across rows when the runtime invokes per-row dispatch in separate microtask windows (e.g. a multi-statement transaction). The integration documents this as deferred (`./spec.md` AC11 — "cross-row batching is documented as deferred").

**What the framework should provide.** Recommended: **(1) bulk variants on the codec interface**.

1. **(Recommended)** **Per-codec / per-trait dispatcher seams** — the codec author registers a `bulkEncode(values: TInput[]): Promise<TWire[]>` alongside `encode`, and the runtime uses the bulk variant whenever it has more than one cell to process (within a row, or across rows when planner permits). The runtime owns the batching window; the codec owns the bulk semantics. This is what CipherStash actually wants — the SDK already exposes `bulkEncrypt`, the codec's batcher's `flush` function is exactly `bulkEncode`. Deletes the workaround instead of bounding it.
2. **Concurrency bound** on `Promise.all` codec dispatch with a configurable max-in-flight per codec instance. Cheaper to implement; bounds property (1) only. Doesn't unlock the bulk-API savings of property (2). Useful as a stopgap.

(1) deletes the integration's batcher entirely *and* enables cross-row batching for free. (2) leaves the batcher in place but makes the worst case bounded.

Tracked upstream under [TML-2330](https://linear.app/prisma-company/issue/TML-2330). The CipherStash integration is the first concrete consumer demonstrating that this is not optional for any network-backed codec.

**Payoff.** Delete `core/batcher.ts` (66 lines), `prisma-batcher.test.ts`, the per-dataType batcher map in `core/codec-storage.ts`, and the entire single-decode-batcher in the storage codec. ADR 204 §Risks "Unbounded Promise.all dispatch" closes.

---

### G5 — `emitTimed`-style observability cannot capture structured failure envelopes

> **Note: this is mostly an extension-space bug, not a framework gap.** Included here because (a) it surfaced during the review, and (b) it foreshadows a real framework concern *if* PN ever ships codec-author observability primitives. See the analysis below.

**Symptom.** The CipherStash SDK's `bulkEncrypt` returns `{ encryptedPayload?, failure?: { message } }` — a *successful* Promise resolution that may carry a failure. The integration's `onEvent` hook fires with `error: undefined` on these structured failures (because `emitTimed` only catches thrown rejections), even though the operation actually failed. Downstream metrics that rely on `event.error !== undefined` undercount real failures.

**Why the extension needs this.** This is more nuanced than the others. `emitTimed` is **extension code** (`[reference/cipherstash/stack/packages/stack/src/prisma/core/codec-context.ts (L85–L107)](../../../reference/cipherstash/stack/packages/stack/src/prisma/core/codec-context.ts)`). The codec body itself *does* throw a `CipherStashCodecError` when it sees `result.failure` — but it does so **after** `emitTimed` has already fired the success event. Sequence:

1. `emitTimed` calls `client.bulkEncrypt(...)`.
2. SDK resolves the promise with `{ failure: {...} }`.
3. `emitTimed`'s `try`-block sees a resolved promise → fires `event.error: undefined`.
4. The codec body inspects `result.failure`, throws `CipherStashCodecError`.
5. Codec promise rejects → runtime sees a rejection.

So at the codec/runtime boundary, the codec correctly signals failure (rejection). At the *extension's own observability boundary*, the helper fires too early. The fix is one line — add `extractError?: (result) => unknown` to `emitTimed`'s signature. **Extension-space, not framework-space.**

The framework-side concern is forward-looking: if PN ever ships its own codec-author observability primitives (timing events, request counters, structured logs around codec calls), those primitives will face the same "successful-resolution-with-failure" pattern. SDK return types like `Result<T, E>` and `{ ok: T, error?: E }` are common enough that any framework-blessed observability surface should accept an extractor.

Applicability if framework-side: any extension whose underlying SDK uses result envelopes rather than thrown failures. Increasingly common (Result types, neverthrow, fp-ts, AWS SDK v3 partial-success responses).

**Today's workaround.** Document the behavior, pin it with a test:

```85:107:reference/cipherstash/stack/packages/stack/src/prisma/core/codec-context.ts
export async function emitTimed<T>(
  ctx: CipherStashCodecContext,
  base: Omit<CipherStashEncryptionEvent, 'durationMs' | 'error'>,
  body: () => PromiseLike<T>,
): Promise<T> {
  const start = performance.now()
  try {
    const result = await body()
    ctx.emit({
      ...base,
      durationMs: performance.now() - start,
      error: undefined,   // ← always undefined on success-path, even if result.failure is set
    })
    return result
```

This is a per-extension helper (so the integration could add an extractor itself), but the underlying issue is structural: any framework-blessed observability surface that wraps async SDK calls needs to handle "resolved-with-failure" envelopes, not just rejections. `emitTimed` is the local symptom; if the runtime ever emits its own observability events around codec calls, it will hit the same shape.

**What the framework should provide.** Nothing strictly required for this gap — the integration can fix it internally by adding an `extractError` callback to its own `emitTimed`. *If* PN later ships codec-author observability primitives, the lesson is "design them to handle resolved-with-failure envelopes, not just thrown rejections" (e.g. accept an `extractError?: (result: T) => unknown` extractor, or bless a `Result<T, E>` shape).

**Payoff.** The extension's `emitTimed` adds an extractor; finding **F06** in `./code-review.md` closes. No framework change required *today*. The forward-looking concern only materializes if the framework adds observability primitives.

---

## 🟧 Author DX / capability gaps

### G6 — No `preferParam` codec trait → shorthand `where` literals can't go through encrypted codecs

**Symptom.** This breaks at parse time:

```ts
db.user.findMany({ where: { email: 'a@b.com' } })
```

…because the SQL planner inlines `'a@b.com'` as a literal without consulting the `email` codec. Encrypted columns reject the literal because plaintext can't be inlined into an `eql_v2.eq(col, plaintext)` call. Users must write the fluent form `tables.user.where(({email}) => email.eq(param('a@b.com')))`. The integration documents the limitation in `[reference/cipherstash/stack/packages/stack/src/prisma/README.md](../../../reference/cipherstash/stack/packages/stack/src/prisma/README.md)` but it's a real DX cliff.

**Why the extension needs this.** Encrypted columns have **no SQL-side literal form**. There is no syntax for "inline this plaintext as a value SQL can compare against the cipher" — comparing requires running plaintext through `eql_v2.eq_term(plaintext)`, which itself requires running plaintext through the `eq_term` codec, which requires a network call to ZeroKMS. So the value cannot be plan-time materialized as a string literal; it must travel as a parameter and pass through a codec.

The fundamental need: a way for a codec to say *"do not let the planner inline literal values targeting this codec; lift them to parameters and pipe them through `encode`"*. Today the planner inlines unconditionally for shorthand `where` clauses.

Applicability: **broadly applicable**. Any codec where the JS-side value cannot be represented as a SQL literal needs this:

- Encryption (this case): wire is cipher of value (network).
- Hashed-key lookup (Bloom-filter membership, hash-equality): wire is hash of value (CPU).
- Custom binary encodings (protobuf-typed columns, custom serializers): wire isn't a SQL string.
- Foreign-key lookups against an external ID service: wire is the resolved ID.

Generally: any codec whose `encode` is non-trivial (i.e. not `String(value)` or similar) needs literal-lifting. This is most "interesting" codecs.

**Today's workaround.** None — documented as not supported.

**What the framework should provide.** A codec trait — say `'preferParam'` — that signals the planner: when this codec appears as the column-side of a `where` shorthand, lift the literal into a parameter and run it through `codec.encode` rather than inlining. Generalizes beyond encryption: any codec where wire ≠ JS-side string representation needs this.

**Payoff.** The "Unsupported (deferred)" §1 of the prisma README disappears. Users get the natural Prisma shorthand on encrypted columns.

---

### G7 — No fluent column-side ordering surface (`.order().asc()`)

**Symptom.** Users can't write `tables.user.orderBy(({email}) => email.order().desc())` on an `orderAndRange: true` encrypted column. They must reach for raw SQL fragments via the `sqlExpression` escape hatch.

**Why the extension needs this.** ORE (Order-Revealing Encryption) ciphers can be sorted in SQL via `eql_v2.order_by(col)` — the function returns an order-comparable value that PostgreSQL's `ORDER BY` consumes. To make this work through the fluent ORM, the planner needs to:

1. Recognize `.order()` / `.asc()` / `.desc()` on a column whose codec declares it supports ordering.
2. Emit `ORDER BY eql_v2.order_by(col) ASC|DESC` instead of `ORDER BY col ASC|DESC` (the latter sorts ciphers as strings, which is meaningless).

Step (2) is a codec-specific lowering of an ORM concept onto a target-specific SQL expression — exactly the kind of seam extensions need. Today the seam exists for `where` operators (the integration registers 14 of them) but not for `order by`.

Applicability: **moderate**. Any codec where naïve `ORDER BY col` doesn't produce the desired ordering needs this:

- ORE-encrypted columns (this case): default sort is meaningless.
- Vector similarity ordering: `ORDER BY col <-> $param` — the operator is the lowering.
- Custom collations / locale-sensitive ordering: `ORDER BY col COLLATE "..."`.
- Computed-column ordering on packed/binary types.

The need is real but narrower than `where` operators (most columns sort fine with the default).

**Today's workaround.** None — documented as not supported. The fluent ORM seam for column-side ordering is unstable post-#379 and the integration sat that out for Phase 1.

**What the framework should provide.** Stabilize the fluent column-method seam for ordering (`.order()`, `.asc()`, `.desc()`) and the underlying lowering protocol so extensions can register an `eql_v2.order_by(...)` lowering analogous to the operator descriptors in `[reference/cipherstash/stack/packages/stack/src/prisma/core/operation-templates.ts](../../../reference/cipherstash/stack/packages/stack/src/prisma/core/operation-templates.ts)`.

**Payoff.** A new `cipherstashEncryption(...).orderingDescriptors()` (or similar) becomes implementable; the unsupported §3 of the prisma README disappears.

---

### G8 — No variadic / OR-fold lowering → `inArray` not expressible

**Symptom.** Users can't write `email.inArray([...])` against an encrypted equality column. They must compose `or(values.map(v => email.eq(param(v))))` manually.

**Why the extension needs this.** EQL has **no `eql_v2.in_array(col, plaintexts[])` SQL function** — the natural lowering for "value is one of N" on an encrypted column is folding into N OR'd `eq` calls:

```sql
eql_v2.eq(col, eq_term(p1)) OR eql_v2.eq(col, eq_term(p2)) OR ... OR eql_v2.eq(col, eq_term(pN))
```

So `inArray` needs to be a **macro operator** — its lowering depends on the *number* of arguments and produces N applications of another operator joined by OR. The framework's current operator-lowering shape — `{ args: ParamSpec[], lowering: { template: string } }` — assumes positional fixed-arity. There's no way to express "variadic args, fold into OR-joined applications of `eq`".

The user could compose `or(...)` manually (and that's the documented workaround), but the standalone fluent-API ergonomic of `column.inArray([...])` requires the framework to support either:

1. Variadic args with a fold mode, or
2. Operator descriptors whose lowering is a function `(args) => SqlAst` rather than a static template.

Applicability: **narrower than G6/G7**. Most extensions can express their operators as fixed-arity templates. But the general capability — *operators whose lowering is a function of their args* — is broadly useful for any extension introducing N-ary, polymorphic, or compound operators (e.g. JSON path expressions whose shape depends on a path-array arg, vector similarity functions with optional metric args, time-window operators with optional bucket args).

**Today's workaround.** None — documented as not supported. The framework's operator-lowering currently expects a single template string with positional arguments; it doesn't support variadic args or "fold values into N OR'd terms" patterns.

**What the framework should provide.** Either (a) a variadic operator lowering shape (`{ args: [...], variadic: { codecId, fold: 'or' | 'and' } }`), or (b) the ability to register a "macro" operator — an operator descriptor whose lowering is a function `(args) => SqlAst` rather than a template string. (b) is more general; (a) is cheaper.

**Payoff.** An `inArray` descriptor becomes a one-liner in `operation-templates.ts`; the unsupported §2 of the prisma README disappears.

---

### G9 — Trait-gated redaction in error envelopes (cleartext-leakage policy)

**Symptom.** A codec failure carries the underlying SDK `cause` chain through Prisma 8's error envelope and into the user's logs. The CipherStash integration is careful not to log plaintext deliberately, but `cause: { message: 'bulkEncrypt failed for "user@example.com"' }` from the SDK can leak. The integration can't redact upstream because the framework owns the envelope policy.

**Why the extension needs this.** Encrypted columns are **secret in both directions**: the input value (plaintext: `'a@b.com'`) is sensitive, and the output value (ciphertext bytes) is also sensitive (revealing structure can aid attacks). When something fails — codec error, runtime error, query error — Prisma 8's default error envelope and any default debug-logging may surface either the input value (`wirePreview` of the failed cell) or the output value (in retries, in cause chains). The extension cannot intercept upstream because:

- The error envelope is constructed inside the runtime, after the codec rejects.
- The wirePreview policy is owned by the runtime, not the codec.
- Default `console.debug` instrumentation in dev mode may include either side.

The extension needs the **codec to declare to the framework** "treat my input and output as sensitive — never include them in error envelopes, telemetry payloads, or default logging". Today there's no declarative mechanism; the extension has to trust convention.

Applicability: **narrow but high-stakes**. Encryption (canonical), tokenization vaults, signed payloads, audit-only data with PII, anything that shouldn't leak into telemetry or error logs even on failure paths. The class is small, but for compliance-bearing applications this is the difference between deployable and not.

**Today's workaround.** Don't log on the codec side; structure all extension errors as `CipherStashCodecError` without plaintext fields; trust the runtime not to amplify.

**What the framework should provide.** A trait-gated `wirePreview` redaction policy: when a codec declares (e.g.) `traits: ['redactWire', 'redactInput']`, the runtime scrubs the corresponding fields from any default error envelope, telemetry payload, or debug log it produces. Pinned codecs opt in once; the runtime enforces.

Tracked upstream under [TML-2329](https://linear.app/prisma-company/issue/TML-2329). The CipherStash integration is the canonical motivating use case.

**Payoff.** The integration can drop defensive notes from its errors and codec docs; spec risk **R1** is mitigated structurally instead of by-convention.

---

### G10 — `AbortSignal` not plumbed to codec calls

> **Status: ✅ Resolved (2026-04-30).** [ADR 207 — Codec call context: per-query `AbortSignal` and column metadata](../architecture%20docs/adrs/ADR%20207%20-%20Codec%20call%20context%20per-query%20AbortSignal%20and%20column%20metadata.md) lands the framework `CodecCallContext = { signal? }` and threads it from `runtime.execute(plan, { signal })` through every codec dispatch site (SQL `encodeParams` / `decodeRow` / between-rows stream loop; Mongo `resolveValue` recursive walk). Codec authors that take a `(value, ctx)` author signature can forward `ctx.signal` to their underlying SDK (e.g. `bulkEncrypt({ signal: ctx.signal })`). Aborts surface as `RUNTIME.ABORTED { phase: 'encode' | 'decode' | 'stream' }` with `cause = signal.reason` (or a synthesised `DOMException('AbortError')`). Cooperative cancellation: the runtime returns promptly via the abort race; in-flight codec bodies that ignore the signal complete in the background. The integration's "codecs simply ignore cancellation" workaround below can be replaced today. The original problem statement stands as historical context.

**Original symptom (preserved as historical context, resolved by ADR 207).** A query that's been cancelled (HTTP request aborted, transaction timeout) still completes its in-flight `bulkEncrypt` against ZeroKMS. The work is wasted, the budget is spent, the latency is incurred.

**Why the extension needs this.** Cancellation is correctness-relevant for any codec performing IO:

- **Resource hygiene**: an HTTP request handler that aborts (client disconnect) should not keep talking to ZeroKMS. The KMS budget is consumed even though no one is listening for the response.
- **Timeout propagation**: a transaction with a deadline needs to abort in-flight codec calls before the deadline expires; otherwise the deadline-enforcement is theoretical (the request "succeeds" arbitrarily late).
- **Backpressure**: an upstream cancellation should propagate down to the SDK so the SDK can stop sending requests, freeing connection-pool slots.

The codec's `encode` / `decode` previously had no way to receive an `AbortSignal` (or equivalent token) to forward to the SDK's `bulkEncrypt({ signal })`. ADR 207 adds the `CodecCallContext.signal` parameter and threads it from `runtime.execute(plan, { signal })` through every codec dispatch site, resolving this gap.

Applicability: **broadly applicable to IO-bound codecs**. Any codec that talks to a network service, reads from a file, or does meaningful CPU work benefits from cancellation propagation. Pure in-process codecs (fast CPU work) generally don't need it. The split mirrors G4: in-process codecs vs service-backed codecs.

**Original workaround (now obsolete).** None — the integration's codecs simply ignored cancellation. With ADR 207 in place, codec authors take a `(value, ctx)` author signature and forward `ctx.signal` to their underlying SDK.

**What the framework now provides.** `CodecCallContext.signal` on the framework `Codec.encode` / `Codec.decode` two-arg author signature, and `runtime.execute(plan, { signal })` to plumb a per-query signal in from the caller. Codec authors that wrap network calls forward `ctx.signal` to `fetch` / SDK; codec authors that don't, ignore it. See [ADR 207](../architecture%20docs/adrs/ADR%20207%20-%20Codec%20call%20context%20per-query%20AbortSignal%20and%20column%20metadata.md) for the full design.

**Payoff (now realised).** The integration can pipe `signal` through to the SDK; aborted requests stop talking to ZeroKMS. (Requires SDK plumbing too — but the framework prerequisite is now in place.)

---

## 🟨 Papercuts

### G11 — ~~Pre-publish API: extensions must vendor types~~ (corrected: extension-author surface)

> **Correction (2026-04-29).** This gap was originally filed citing the comment in CipherStash's `internal-types/prisma-next.ts` that says *"Prisma 8 is pre-publish on npm at the time of writing"*. That comment is **stale**: `@internal/sql-runtime`, `@internal/contract-authoring`, `@internal/family-sql` and the rest of the public packages have been on npm for hundreds of versions (latest stable `0.4.2`, plus `dev` and PR-tagged channels). The CipherStash integration's `package.json` takes **zero** `@internal/`* dependencies — they vendored types despite published packages being available, not because they had no choice. The original framing ("force every external extension author to vendor") doesn't reflect reality. The original framework ticket [TML-2343](https://linear.app/prisma-company/issue/TML-2343) was filed against the false premise and has been canceled.

**Symptom (corrected).** The integration ships a 376-line vendored `internal-types/prisma-next.ts` that hand-mirrors a curated subset of the public types from six different `@internal/`* packages (`framework-components/codec`, `sql-relational-core/ast`, `sql-runtime`, `family-sql/control`, `sql-operations`, `contract-authoring`). Vendored shapes can drift from upstream.

**Why the extension chose to vendor (best-guess reading).** The author's stated reason ("pre-publish") doesn't hold. Plausible actual reasons, ranked by how much they look like framework-side gaps:

1. **No curated extension-author surface package.** The vendored file pulls from six different packages. To take real peer deps, an author has to learn which `@internal/`* packages are public API vs internal, what their semver guarantees are, and pin the right combination. A single curated `@internal/extension-types` umbrella that re-exports the symbols extensions need (`BaseCodec`, `SqlCodec`, `CodecRegistry`, `SqlOperationDescriptor`, `SqlRuntimeExtensionDescriptor`, `SqlControlExtensionDescriptor`, `ComponentDatabaseDependencies`, `PlanTypeOperationsInput`, `StorageTypePlanResult`) would make the choice trivial. **This is the only one that's a real framework gap** — and a small / debatable one.
2. **Pre-1.0 churn aversion.** Even though PN is published, it's pre-1.0. The author may have preferred to snapshot a known-good shape rather than chase API moves between releases. **Author choice, not a framework problem.**
3. **Install footprint.** They don't want PN packages installing into their consumers' `node_modules`. **Author choice.**
4. **Independent release cadence.** They ship `@cipherstash/stack@0.15.x` and don't want their releases gated on PN compatibility ranges. **Author choice.**

Applicability of the curated-surface story (reason 1): every third-party extension pack would benefit from a single, well-documented `import { … } from '@internal/extension-types'` entry point. But the absence of one is a DX papercut, not a blocker — the published packages exist and can be depended on directly.

**Today's workaround.** Vendored types file, intentionally narrow, runtime arktype check on `typeParams` (`encryptedStorageParamsSchema`) as a runtime safety net. The most-loose seam is `ArkSchema<TParams>` — typed as an opaque token because the integration doesn't want a hard dep on arktype's full surface, which means the `paramsSchema` slot is essentially `unknown`-typed at the boundary.

**What the framework could provide (smaller scope than originally stated).** Optionally, a curated `@internal/extension-types` umbrella package that re-exports the extension-author surface from one place with extension-author-grade documentation. This would lower the barrier to taking real peer deps for new extension authors. Not filed as a ticket today; consider filing fresh if/when the demand materializes.

**Payoff.** If the curated umbrella lands: extension authors get one stable import line instead of six. If they don't, extensions can still take real `@internal/`* peer deps individually — the published packages exist and the migration is mechanical.

---

### G12 — Framework codec IDs are not exported as constants

**Symptom.** The integration references the framework's default boolean codec by hard-coded string `'core/bool@1'`:

```15:23:reference/cipherstash/stack/packages/stack/src/prisma/core/operation-templates.ts
 * registers a default boolean codec under `core/bool@1`; we reference it
 * ...
 codecId: 'core/bool@1',
```

If Prisma 8 ever versions the codec to `core/bool@2`, the integration silently breaks at lowering time with a registry "codec not found" error.

**Why the extension needs this.** The integration registers operator descriptors like:

```ts
{ method: 'eq', args: [...], returns: { codecId: 'core/bool@1', nullable: false }, lowering: { ... } }
```

`returns.codecId` must point to a codec the registry will resolve at lowering time. Boolean is the natural return type for `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike` — eight of the integration's 14 operators. PN registers a default boolean codec under the ID `'core/bool@1'`, but exposes no symbol the extension can import. The string is the only handle.

If the framework ever (a) renames the codec, (b) versions to `@2`, (c) changes the default registration to be opt-in, or (d) namespaces it differently — the integration's operator descriptors silently dangle. The lowering-time failure (`registry.get('core/bool@1') === undefined`) doesn't surface until the user tries an `eq` query in production.

Applicability: **broad**. Any extension that registers operators returning framework primitive types (`bool`, `string`, `int`, `bytes`, etc.) needs stable handles to those primitives. Practically every extension that exposes comparison or predicate operators.

**What the framework should provide.** Export stable constants for the built-in codec IDs from the published codec package:

```ts
export const CORE_BOOL_CODEC_ID = 'core/bool@1' as const
// ...
```

Extension authors import the constant. Framework owners control versioning and can do a deprecation cycle.

**Payoff.** Replace string literal with imported constant. Delete finding **F08** in `./code-review.md`.

---

### G13 — No first-class story for type-level testing of `OperationTypes`

**Symptom.** The integration's `OperationTypes<TParams>` (`[reference/cipherstash/stack/packages/stack/src/prisma/exports/operation-types.ts](../../../reference/cipherstash/stack/packages/stack/src/prisma/exports/operation-types.ts)`) does the entire conditional-method-surface gating. A regression that accidentally surfaces `.eq` on a non-equality column would not be caught by any runtime test (because the runtime descriptors emit all 14 operators unconditionally — type-level gating is the entire point of `OperationTypes`).

**Why the extension needs this.** The conditional method surface is **type-level only**. `cipherstashEncryption({...}).queryOperations()` returns all 14 operators unconditionally; the runtime would happily lower `email.gte(date)` (where `email` is a string-equality column) into SQL — the database would reject it, but only after a network round-trip. The DX guarantee "you can't write `.gte()` on a non-`orderAndRange` column" exists *only* in TypeScript's type system, via the conditional types in `OperationTypes`.

That means a regression in `OperationTypes` (a "fix" that accidentally collapses a conditional, exposing methods on the wrong columns) is invisible to runtime tests. The only test that catches it is a *type-level* one — assertions like `expectNever<OperationTypes<{equality: false}>['eq']>` that fail at compile time when the conditional breaks.

The integration *can* write these tests itself (and does for `Decrypted<>`). The framework gap is that there's no blessed pattern, helper, or example.

Applicability: **broadly applicable**. Any extension that uses conditional types to gate its method surface based on column metadata needs type-level tests. Vector (different ops on different similarity metrics), FTS (different ops based on language config), CipherStash (search modes), JSONB-typed columns (path operators only on JSONB), tsvector (ranking operators only on tsvector). The pattern appears anywhere TypeScript "discriminated method surface" is part of the DX promise.

This is **not strictly framework-side** — extensions can roll their own helpers (the integration already does for `Decrypted<>` using `extends never ? true : ...`). But shipping a blessed `expectAssignable` / `expectNever` / `expectEquivalent` from a framework support package would standardize the pattern and signal that type-level testing is a first-class concern.

**Today's workaround.** The `Decrypted<>` helper *does* have type-level tests in `[reference/cipherstash/stack/packages/stack/__tests__/prisma-decrypted.test.ts](../../../reference/cipherstash/stack/packages/stack/__tests__/prisma-decrypted.test.ts)` using `extends never ? true : ...` patterns. The same pattern would work for `OperationTypes` but the integration doesn't use it.

**What the framework should provide.** Bless a small type-test helper (`expectAssignable<T, U>` / `expectNever<T>` / `expectEquivalent<A, B>`) shipped from a framework support package, plus guidance / examples for extension authors. Many extensions will register conditional method surfaces via `queryOperationTypes` / `operationTypes` — this is reusable.

**Payoff.** A test gap closes (finding **F04** in `./code-review.md`). Other extensions get the helpers for free.

---

### G14 — Bundle composition: no enforcement that runtime build doesn't pull control-side deps

**Symptom.** The integration ships ~170 KB of vendored EQL install SQL inlined as a string literal. It tries to keep the SQL out of the runtime bundle by splitting subpath exports (`/control` vs `/runtime`) and referencing the SQL only from `core/database-dependencies.ts` (control-side). But there's no framework guarantee — or framework-blessed pattern — for asserting "the runtime build doesn't pull in control-side dependencies". An accidental import (e.g. from a barrel) silently inflates the runtime bundle by 170 KB.

**Why the extension needs this.** The control plane (migration planning, CLI tooling, build-time emission) and the runtime plane (request-time encryption / decryption) have very different deployment shapes:

- **Control plane** runs at dev/build/migrate time. Heavy dependencies are fine — the user runs `prisma-next db migrate` once and waits a moment.
- **Runtime plane** runs in every Lambda cold start, every Edge worker boot, every Vercel function instance. Every kilobyte costs cold-start latency.

The 170 KB EQL install bundle is purely control-plane; runtime should never load it. The integration achieves this by:

1. Putting the bundle behind `core/eql-bundle.ts`, only imported by `core/database-dependencies.ts`.
2. Only re-exporting `core/database-dependencies.ts` from `exports/control.ts`.
3. Declaring separate subpath exports for `/control` vs `/runtime` in `package.json`.

But step (3) is a *user* opt-in. If the user imports from the barrel `@cipherstash/stack/prisma`, they get everything — including the 170 KB. There's no framework-side enforcement that the runtime build excludes the bundle.

Applicability: **moderate**. Any extension that ships heavy migration assets (SQL bootstraps, vector index install scripts, FTS dictionary files, audit-trigger functions) faces this. The need is "structural separation between control and runtime, mechanically enforced". Common enough among non-trivial extensions but not universal.

This is **not strictly framework-side** — extensions can solve it themselves (the integration does, modulo the barrel concern). The framework can *help* by shipping a starter template that sets up the subpath split correctly, plus a CI lint that asserts no control-side imports leak into runtime.

**Today's workaround.** Manual split + `tsup.config.ts` with one entry per subpath. The integration's reviewers want a CI check (`./code-review.md` finding **F02**, system-design risk **A4**, **R5**) but it has to be bespoke.

**What the framework should provide.** A blessed extension-pack template (or a turborepo lint) that sets up subpath exports for `runtime` / `control` / `pack` / `column-types` / `codec-types` / `operation-types` and asserts the build outputs don't cross-contaminate. Most extensions will need this exact split.

**Payoff.** Future packs get the bundle-discipline for free; the integration's `tsup.config.ts` simplifies. Verifies the documented bundle-size promise.

---

### G15 — No standardized codec-author test harness

**Symptom.** The integration writes its own `[reference/cipherstash/stack/packages/stack/__tests__/prisma-test-helpers.ts](../../../reference/cipherstash/stack/packages/stack/__tests__/prisma-test-helpers.ts)` — a synthetic 5-table contract covering every dataType, plus a mock `EncryptionClient` that simulates the SDK's `BulkEncryptOperation` surface. Future codec authors (vector, FTS, time-series) will each write their own variant.

**Why the extension needs this.** Testing a codec against the framework requires:

1. A **synthetic contract** that exercises the codec's column types — the integration needs columns of every `EncryptedDataType` (`string`, `number`, `boolean`, `date`, `json`) with various search-mode combinations.
2. A **mock registry** so the codec sees the framework symbols it expects (built-in codecs by ID, runtime hooks, etc.).
3. A **lowering harness** so the test can assert "given this fluent expression and this codec, the planner emits this SQL AST".

(1) and (3) are not codec-specific — every extension author needs them. (2) is somewhat codec-specific (the mock needs to know what real symbols to provide).

Applicability: **universal among extension authors**. Every extension wants the same test scaffolding. The CipherStash integration's `prisma-test-helpers.ts` is a high-quality variant of what the framework should ship as a support package.

This is **framework-side as a helper package**, optional but high-leverage — every extension author who skips writing their own test scaffolding ships faster.

**What the framework should provide.** A `@internal/codec-test-utils` (or similar) package: helper to construct a synthetic contract from a mini-DSL, a mock `CodecRegistry`, harness to assert "given this contract and this codec graph, this fluent expression lowers to this SQL AST".

**Payoff.** New extension packs ship faster; the integration's `prisma-test-helpers.ts` shrinks.

---

### G16 — `JsonValue` constraint: `encryptedJson<T>` is unconstrained

**Symptom.** The integration's `encryptedJson<TShape>(...)` takes any `TShape`. A user can pass `() => void` and TypeScript won't complain at authoring time; runtime `JSON.stringify` will then misbehave.

**Why the extension needs this.** `encryptedJson<TShape>` is a generic the user instantiates with their own JSON schema (e.g. `encryptedJson<{ ssn: string; preferences: { theme: string } }>(...)`). The codec serializes to/from JSON over the wire, so `TShape` should be constrained to *JSON-serializable values*. Today it's unconstrained, so:

- `encryptedJson<() => void>(...)` compiles. Runtime: function gets stripped during `JSON.stringify`, decode produces undefined-shaped values.
- `encryptedJson<bigint>(...)` compiles. Runtime: `JSON.stringify` throws on bigints.
- `encryptedJson<symbol>(...)` compiles. Runtime: silently dropped.

The extension wants to constrain `TShape extends JsonValue` where `JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }`. The integration *defines* this type internally (in `internal-types/prisma-next.ts`) but doesn't use it as a generic constraint — likely because the canonical `JsonValue` belongs to the framework, and using a vendored shape as a public-API constraint is awkward (the user would see a vendored-looking type in error messages).

Applicability: **broad**. Every extension that takes user-provided JSON shapes (vector embeddings serialized as JSON, document-shaped columns, JSON-schema-typed fields) needs the same constraint. PG drivers, ORMs, and contract systems generally agree on a `JsonValue` shape; PN should own it canonically.

This is **framework-side**, trivial.

**Today's workaround.** None.

**What the framework should provide.** Export a canonical `JsonValue` (or `JsonShape`) type from the framework that extensions can use as an `extends` constraint:

```ts
type JsonShape = ... // structural
function encryptedJson<TShape extends JsonShape>(...): ...
```

The integration already defines its own `JsonValue` in `internal-types/prisma-next.ts` — the framework should own the canonical shape and export it.

**Payoff.** `encryptedJson<TShape extends JsonValue>` becomes a one-character change. Finding **F15** in `./code-review.md` closes.

---

## Cross-cutting observations

### The integration's extension-pack shape is a useful reference

The CipherStash integration's structural shape — control + runtime + pack + column-types + codec-types + operation-types subpath exports, per-extension factory closure, conditional-method `OperationTypes`, microtask batcher, vendored migration assets behind `databaseDependencies.init`, per-column DDL via `planTypeOperations` — is **almost a template** for any non-trivial extension pack. The framework would benefit from publishing this shape as a **starter**:

```text
@internal/extension-template
├── src/
│   ├── core/        (codecs, batcher, migrations)
│   ├── exports/     (subpath entries)
│   └── internal-types/  (or take real `@internal/*` peer deps directly; see G11)
├── tsup.config.ts   (one entry per subpath, bundle-discipline lint)
└── package.json     (subpath exports declared)
```

This gives future extension authors a path that doesn't require reverse-engineering the post-#379 surface from this PR.

### "Honest about its compromises" is a tax on the framework, not the integration

The integration's JSDoc and README are *exemplary* in calling out exactly which shortcomings the framework still has. Each "Phase 4 will fix this" comment is a marker the integration could have skipped — it could have shipped silently and let users discover the gaps. The tax it pays in clarity is a tax the framework should reduce by closing the gaps.

The most user-visible gap (G1, multi-column-per-dataType) is a correctness issue that **the integration can't fix from the outside** — it requires upstream column-context plumbing. Until G1 lands, every CipherStash adopter who has two encrypted columns of the same dataType ships a silent bug. This is the single most important framework gap to close for this integration.

### Where the work belongs (framework-space vs extension-space)


| Gap     | Belongs                          | Why                                                                                                                                                                                                               |
| ------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **G1**  | **Framework**                    | The codec interface itself decides whether column identity is per-call, per-instance, or absent. Extension can't bolt this on.                                                                                    |
| **G2**  | **Framework**                    | The planner has `(table, column)`; not passing it is a one-line gap. Extension can only reverse-engineer.                                                                                                         |
| **G3**  | **Framework**                    | Standard schema-diff problem; extensions can't synthesize prior state.                                                                                                                                            |
| **G4**  | **Framework**                    | The dispatch shape (Promise.all vs bulkEncode vs concurrency-bounded) is owned by the runtime. Extension's microtask hack is a workaround, not a fix.                                                             |
| **G5**  | **Extension (mostly)**           | `emitTimed` is extension code; one-line fix. Forward-looking framework concern only if PN ships codec-author observability primitives.                                                                            |
| **G6**  | **Framework**                    | Lifting literals to parameters is owned by the planner. Extensions can declare a trait but can't intercept the planner's lowering decision.                                                                       |
| **G7**  | **Framework**                    | The fluent ordering surface and its lowering protocol are framework-defined.                                                                                                                                      |
| **G8**  | **Framework**                    | Operator-template lowering is framework-defined; variadic / functional lowerings are a framework feature.                                                                                                         |
| **G9**  | **Framework**                    | The error envelope and default logging are framework-owned.                                                                                                                                                       |
| **G10** | **Framework**                    | Cancellation plumbing on the codec interface is framework-defined.                                                                                                                                                |
| **G11** | **Either (recommend framework)** | Original "publish to npm" framing was wrong — PN is on npm. Real (smaller) gap is a curated extension-author surface package. Extensions can take real peer deps today; an umbrella would just lower the barrier. |
| **G12** | **Framework**                    | Stable IDs for built-in codecs are PN's symbols to export.                                                                                                                                                        |
| **G13** | **Either (recommend framework)** | Extensions can write their own type-test helpers (the integration does for `Decrypted<>`). Framework helpers would standardize.                                                                                   |
| **G14** | **Either (recommend framework)** | Extensions can structure their own subpath split. Framework starter / lint would mechanize it.                                                                                                                    |
| **G15** | **Either (recommend framework)** | Extensions can write their own test scaffolding (integration does). Framework helper package = leverage.                                                                                                          |
| **G16** | **Framework**                    | Canonical `JsonValue` is PN's symbol to own. Trivial export.                                                                                                                                                      |


### Rough prioritization

If the framework team can land **one** thing for this integration's next phase: **G1** (per-instance codec parameterization). Without it, the integration cannot deliver correct behavior for any non-trivial encrypted contract.

If the framework team can land **three** things: **G1, G2, G4**. These close the largest extension-side workarounds (codec dispatch, planner input shape, batching) and let the integration delete `core/encryption-client.ts`'s dataType index, `deriveTableAndColumn`, and `core/batcher.ts` — three of the integration's six trickiest files. All three are clearly framework-side.

Everything else is real but smaller.

The "either-side" gaps (**G5, G11, G13, G14, G15**) are nice-to-have framework helpers — the integration ships fine without them, and other extensions can roll their own. They're framework leverage opportunities, not framework correctness obligations. **G11** in particular is downgraded after correction: PN packages are already on npm, so the original "publish to npm" framing was wrong; a curated extension-author surface umbrella is the only remaining (small) framework leverage opportunity here.

---

## See also

- `[./spec.md](./spec.md)` — inferred review spec, including risks **R1** (cleartext leakage), **R2** (unbounded `Promise.all`), **R3** (multi-column miscoding), **R4** (typeName convention), **R5** (bundle size), **R6** (vendored type drift).
- `[./system-design-review.md](./system-design-review.md)` — architectural risks **A1**–**A5** and "What I'd ask before merge".
- `[./code-review.md](./code-review.md)` — code-level findings, especially **F01** (multi-column miscoding), **F02** (bundle assertion), **F03** (planTypeOperations no-op observability), **F04** (`OperationTypes` type tests), **F05** (typeName parsing), **F06** (`emitTimed` failure-envelope), **F08** (`core/bool@1` constant), **F15** (`encryptedJson` constraint), **D04** (cross-row batching), **D09** (destructive DDL).
- [ADR 204 — Single-Path Async Codec Runtime](../../../docs/architecture%20docs/adrs/ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md) — §Risks on cleartext leakage and unbounded `Promise.all`, both of which this integration encounters in production form.
- [TML-2329](https://linear.app/prisma-company/issue/TML-2329) — trait-gated redaction (covers **G9**).
- [TML-2330](https://linear.app/prisma-company/issue/TML-2330) — column-context plumbing + codec concurrency (covers **G1**, **G4**).

