# ADR 155 — Driver/Codec boundary value representation and responsibilities

Prisma Next executes parameterized query Plans:

- lanes build an AST and a separate `params[]` array (no SQL literal concatenation)
- adapters lower AST → SQL text with placeholders
- codecs encode parameters and decode rows
- drivers bind `sql + params` and execute against the database

In practice, we’ve been mixing responsibilities between adapters, codecs, and drivers. That creates hidden coupling:

- codec implementations start depending on what a particular underlying JS database library returns (`Date`, `string`, `number`, etc.)
- driver swapping becomes “best effort”
- features that need deterministic value serialization (for example, `storage.sets` in ADR 156) have no stable representation to build on

This ADR standardizes the boundaries so components remain composable and swappable.

**Terminology note:** in Prisma Next, a **driver** is our component that speaks to an underlying database library (e.g. `pg`). This ADR uses “driver” in that Prisma Next sense (not “the underlying library”).

Quick glossary (for this ADR):

- **Plan**: `{ sql, params, meta }` artifact produced by lanes and executed by the runtime.
- **lane**: an authoring surface (SQL DSL, raw SQL, ORM) that produces Plans.
- **adapter**: lowers an AST to SQL text for a dialect (placeholders, casts, syntax).
- **codec**: encodes params and decodes rows.
- **driver**: binds `sql + params` and executes via an underlying DB library, normalizing values at the boundary.

## What problem are we solving?

We’re separating three things that are easy to conflate:

1. **Lowering**: converting intent (AST) into SQL text (dialect-specific)
2. **Value encoding/decoding**: converting between JS/domain values and bindable/returnable values
3. **Transport**: binding parameters and executing SQL via a driver/library

If these responsibilities are not explicit, we get accidental coupling:

- Codecs can be contributed by many components (adapters, targets, extension packs), but driver boundary values are determined by whichever underlying JS library a driver uses.
- Drivers are intended to be swappable, but swapping underlying libraries changes those boundary value shapes and silently invalidates codec assumptions.

Finally: we explicitly do **not** solve this by inlining SQL literals. Parameterization is a core architecture constraint for safety and stability.

## Design constraints (the “why” behind the decision)

- **Parameterized Plans**: we execute `sql + params`, not “SQL with values substituted”.
- **Lowering must be value-independent**: adapters must not call `encode(value)` or otherwise depend on runtime values to decide SQL shape. Plans and lowering should be stable across different parameter values.
  - Lowering can use type metadata (for example `codecId`, `nativeType`, and column references), but not the runtime value in `params[]`.
- **Codecs are component-provided**: adapters, targets, and extension packs can contribute codecs; codecs are not owned by drivers.
- **Drivers are swappable**: a Prisma Next driver is a wrapper around an underlying library (e.g. `pg`); swapping that wrapper should not require rewriting codecs.
- **No SQL literal codecs**: codecs do not generate SQL fragments; SQL text is produced by lowering.

These constraints imply the codec↔driver value boundary must be standardized.

## Evidence in the current codebase (what’s leaking today)

Even before we introduce contract-level literal serialization, driver/library-specific behavior has already leaked into codecs and execution behavior:

### A codec references a specific driver library requirement (pgvector)

The `pg/vector@1` codec explicitly calls out a `pg` library requirement:

```ts
// packages/3-extensions/pgvector/src/core/codecs.ts
// PostgreSQL's pg library requires the vector format string
return `[${value.join(',')}]`;
```

This is a problem because “vector values are formatted as pgvector text strings” may be true, but “required by the pg library” is not a contract we want codecs to depend on. It makes swapping the underlying library a codec-audit exercise.

### Codecs accept driver-specific JS types (`Date`)

Timestamp codecs accept `string | Date`:

```ts
// packages/3-targets/6-adapters/postgres/src/core/codecs.ts
decode: (wire: string | Date): string => {
  if (typeof wire === 'string') return wire;
  if (wire instanceof Date) return wire.toISOString();
  return String(wire);
}
```

That union exists because some JS libraries return timestamps as `Date`. But a different driver library might return strings or a different wrapper type. When the driver boundary contract shifts, codecs shift.

### Scalar codecs assume a particular parsing configuration (`int8`)

`pg/int8@1` was typed as `number → number` and was identity:

```ts
const pgInt8Codec = codec<'pg/int8@1', number, number>({ encode: (v) => v, decode: (w) => w });
```

Many Postgres JS libraries return `int8` as **strings** by default to avoid precision loss. If the underlying library returned strings, that codec was wrong — the exact failure mode this ADR set out to eliminate.

**Resolved.** `pg/int8@1` carries `bigint` as its application value, and its canonical JSON is decimal text rather than a JSON number, which cannot hold the int64 range. Neither side depends on how a driver library chooses to parse `int8`.

### The Postgres driver did not normalize row values

When this ADR was written, the driver yielded rows directly from `pg` without normalization:

```ts
// packages/3-targets/7-drivers/postgres/src/postgres-driver.ts
const result = await client.query(sql, params as unknown[] | undefined);
for (const row of result.rows as Record<string, unknown>[]) yield row;
```

With no normalization at the driver boundary, codecs inevitably become coupled to the underlying library’s choices. Three readers did become coupled, and `pg` hid the coupling: the runtime marker check read `canonical_version` as a number, computed `select` projections with no codec returned whatever `pg` parsed, and the interval codec read only the ISO 8601 text it writes itself, never the text Postgres prints.

**Resolved.** The runtime driver now passes `serverTextTypes` to `pg` on every `query` path, so every row value arrives as the server's text output and `pg` parses nothing ([`server-text-types.ts`](../../../packages/3-targets/7-drivers/postgres/src/server-text-types.ts), [driver README](../../../packages/3-targets/7-drivers/postgres/README.md#row-parser-policy)). The three readers were fixed to read text. The control-plane driver still lets `pg` parse scalar values; it reads catalog rows without codecs and is the remaining exception to this ADR.

### Lowering already emits casts for determinism (`::vector`)

The Postgres adapter already emits `::vector` for `pg/vector@1` params:

```ts
// packages/3-targets/6-adapters/postgres/src/core/adapter.ts
if (columnMeta?.codecId === VECTOR_CODEC_ID) return `$${ref.index}::vector`;
```

This shows we already need lowering to carry SQL type intent (casts), separate from value encoding.

## Decision (what we standardize)

This ADR standardizes:

- who owns lowering vs encoding vs transport
- the canonical value representation at the codec↔driver boundary
- where we enforce compatibility so adapters don’t need codec-specific knowledge

### Responsibilities (who does what)

#### Lowering (adapter responsibility)

Adapters render **SQL text** from AST/intent plus contract context:

- choose placeholder style (`$1` vs `?`)
- emit dialect-specific syntax
- emit casts when needed for unambiguous type parsing (e.g. `$1::vector`, `$1::int8`)

Adapters do **not** serialize JS values into SQL literals.

Adapters also do **not** inspect codec implementations or encoded parameter values to decide casts. Cast decisions are based on:

- **SQL context** (is the parameter already typed by a target column? is it an operator/function argument?)
- **type intent** available from the contract/plan (e.g. `ParamDescriptor.nativeType`, column refs)

#### Encoding/decoding (codec responsibility)

Codecs translate:

- JS/domain values ⇄ canonical driver boundary values

Codecs do **not** render SQL text.

#### Transport and normalization (driver responsibility)

Drivers (Prisma Next wrappers around DB libraries) are responsible for:

- binding parameters and executing SQL
- streaming row results
- normalizing the underlying library’s parameter/row representations to a canonical boundary

Drivers do **not** lower AST and do **not** inject casts.

### Execution pipeline (order of operations)

This is the end-to-end order the system follows:

1. The lane builds an AST and stores JS/domain parameter values separately in `params[]`.
2. The adapter lowers the AST to SQL text with placeholders and (when needed) explicit casts.
3. The runtime encodes the JS/domain params using codecs into boundary values (`string | Uint8Array | null`).
4. The driver binds and executes `sql + encodedParams` and normalizes returned row values into boundary values.
5. The runtime decodes boundary row values back into JS/domain values using codecs.

The key point is that (2) happens before (3): lowering decisions are based on **SQL context + type intent** from the contract/Plan, not on runtime values.

### Canonical codec↔driver boundary value representation

The boundary between codecs and drivers is standardized as:

- parameter values: `string | Uint8Array | null`
- row values: `string | Uint8Array | null`

Meaning:

- `string` is the canonical string encoding for the type. For a parameter, the codec’s policy for that `codecId` defines it. For a row value, it is the text the database server prints for the type, unchanged by the driver: `t` for a Postgres `bool`, `NaN` for a `float8`, `{a,b}` for an array, the JSON text for `jsonb`. A codec decodes that text and nothing else, so it may not depend on any parsing the driver’s underlying library would do.
- `Uint8Array` is an opaque **binary blob** when a codec/target chooses a binary representation.
- `null` is SQL `NULL`.

A row value with no codec, such as a computed projection whose codec the composed stack cannot build, reaches the user as that server text. The driver does not fall back to library parsing for it.

This intentionally excludes driver-library-specific JS types (`Date`, `bigint`, `Buffer`, custom wrappers).
In Node, `Buffer` is a `Uint8Array`; drivers may accept `Buffer` internally but must expose `Uint8Array` at the boundary.

### Encoding shape: codecs do not alternate text vs binary for a `codecId`

Although the boundary type is a union, we do **not** want a single codec to alternate between text and binary representations for the same `codecId` based on runtime values.

Instead, each codec should effectively behave like one of these:

- **text codec:** encodes non-null values to `string`
- **binary codec:** encodes non-null values to `Uint8Array`

`null` remains meaningful at the boundary as the representation of SQL `NULL`. In practice, runtime code can (and often should) short-circuit nullability before calling `encode`/`decode`.

### Type intent lives in SQL (and plan metadata), not in parameter values

Parameter values do not carry “what type they are”. The adapter (during lowering) is responsible for making the database parse bound parameters correctly. For Postgres, this commonly means emitting explicit casts in SQL (e.g. `$1::vector`, `$1::uuid`, `$1::int8`) when inference would otherwise be ambiguous.

Plans already have a place to carry type information separately from values (e.g. param descriptors / codec IDs). Lowering and runtime encoding can use that metadata without turning parameters into “typed objects” or SQL literal fragments.

### Compatibility enforcement happens during contract authoring

We expect users (via PSL/TS authoring) to select codecs for columns. To keep adapters and drivers generic, codec↔column compatibility is validated when building/emitting/validating the contract:

- a column chooses a `codecId` and a target-native type name (`nativeType`)
- a codec declares which target-native type names it supports (e.g. `targetTypes`)
- contract authoring/validation rejects incompatible combinations early

This avoids pushing codec-specific logic into adapters at lowering time and prevents late, driver-specific failures at runtime.

### Conformance and enforcement (drivers)

This is a behavioral contract, not just a TS type alias. We enforce it via:

- **Conformance tests** (ADR 026): per driver/target, prove that:
  - returned row values normalize to `string | Uint8Array | null` for representative types
  - bound params accept `string | Uint8Array | null` and execute correctly
- **Optional dev-mode validation:** fail fast if a driver returns a row value outside the canonical set (e.g. a `Date`).

For the Postgres driver, [`driver.server-text.integration.test.ts`](../../../packages/3-targets/7-drivers/postgres/test/driver.server-text.integration.test.ts) is that conformance test. It reads `bool`, `int2`, `int4`, `float8` (including `NaN` and both infinities), `bytea`, `oid`, `interval`, `json` and `jsonb` through the buffered, cursor and named-cursor paths and asserts that every value is the server's text, and that the global `pg` type parsers are unchanged.

## FAQ (questions a reader is likely to ask)

### “Why not just escape values and substitute them into SQL?”

Because substitution turns “data” into “code” again. Modern database protocols and libraries bind parameters as values, not SQL snippets. Binding gives us stronger safety guarantees than escaping, and it keeps Plans stable (important for identity, caching, and observability).

This ADR is specifically about keeping that parameterized architecture while still allowing codecs and drivers to be independently swappable components.

### “What is ‘canonical string encoding’?”

It means: for a given `codecId`, the codec defines a deterministic string representation that is accepted by the database when bound (often with an adapter-emitted cast) and that can be decoded back into a JS/domain value.

Examples in the current system:

- `pg/vector@1` uses pgvector’s text format like `"[0.1,1,42]"`.
- timestamp codecs already lean toward ISO strings for determinism (`Date` is accepted as input today but is not a desirable driver boundary type).

Canonical string encoding is what we need later for deterministic contract literal serialization (for example `storage.sets`), because it is stable across driver libraries.

### “Does this mean all types are sent as strings?”

Not necessarily. Strings are the default because they are portable and deterministic. `Uint8Array` is reserved for cases where we intentionally use a binary representation (for example, raw bytes).

This ADR does not require us to implement type-specific binary encodings for every scalar (that would recreate driver protocol complexity in codecs). The binary path is for true blob-like values or cases where a target explicitly chooses it.

### “How does a driver actually normalize values?”

Each Prisma Next driver is allowed to configure its underlying library and/or post-process values so the driver outputs only `string | Uint8Array | null`.

For example, if an underlying library returns timestamps as `Date`, the wrapper would convert them to ISO strings before the codec layer sees them. The Postgres driver takes the simpler route: it configures `pg` with a type parser that returns the server's text for every type OID, so there is nothing to convert back.

## Worked example: `pg/vector@1`

This example mirrors the current pgvector codec behavior (pgvector text format like `"[1,2,3]"`) and shows where responsibilities sit.

### Scenario

- column: `embedding` with `codecId: 'pg/vector@1'`, `nativeType: 'vector'`
- query: insert a row with `embedding`
- JS value: `[0.1, 1, 42]` (the exact domain type can vary; the boundary stays the same)

### Flow

#### A) Lane produces an AST with parameter references

Instead of concatenating SQL with literals, the lane produces an AST that includes a parameter reference node (conceptually `ParamRef(1)`) and carries the JS value separately in the Plan:

- AST value position: `ParamRef(1)`
- Plan `params`: `[[0.1, 1, 42]]`

#### B) Adapter lowers intent to SQL text

- SQL:

```sql
INSERT INTO "post" ("embedding") VALUES ($1::vector)
```

- `::vector` cast is emitted during lowering so the DB parses a text parameter as a `vector`

#### C) Codec encodes the JS value to a canonical boundary value

- codec encodes to a `string`:
  - `"[0.1,1,42]"`

This is a bound parameter value, not SQL text.

#### D) Driver binds and executes

- driver executes:
  - SQL: `... VALUES ($1::vector)`
  - params: `["[0.1,1,42]"]`

#### E) Driver returns canonical row values

If rows are returned, the driver normalizes them to the canonical boundary representation.

For `vector`, that means the row value is a `string` in pgvector text format:

- `"[0.1,1,42]"`

#### F) Codec decodes canonical row value to JS value

- codec decodes back to the JS/domain representation (today: `number[]`)

### Variant: arbitrary precision numeric elements (`BigDec[]`)

Now assume the JS/domain type is not `number[]` but `BigDec[]` (an arbitrary‑precision decimal type).

This does not change the codec↔driver boundary: the codec still emits a `string` for the parameter and receives a `string` for row values.

What changes is *where the precision policy lives*.

#### A) JS/domain value

- JS value: `[BigDec("0.1"), BigDec("1.0000000000000000001"), BigDec("42")]`

#### B) Lowering (unchanged)

- SQL remains: `... VALUES ($1::vector)`

Lowering is still responsible for `::vector` so the DB parses the text parameter as a vector.

#### C) Encoding policy lives in the codec

pgvector ultimately stores floating point values, so not all `BigDec` values are representable without loss.
The codec must define an explicit policy, for example:

- **Reject** values that can’t round-trip to the supported float precision (preferred for correctness), or
- **Round** with a documented strategy (acceptable if the product wants this behavior)

With a “reject on precision loss” policy, encoding would look like:

- codec encodes to a `string` (pgvector text format):
  - `"[0.1,1.0000000000000000001,42]"`
- but throws if the target representation cannot safely store `1.0000000000000000001`

The key point is that *the codec*, not the driver, owns this decision.

#### D–F) Driver and decode (unchanged)

- Driver still binds a string parameter.
- Driver still normalizes row values to strings.
- Codec still parses the text vector format back into domain values (possibly with its own explicit precision policy).

## Worked example: MySQL `DECIMAL` with `BigDec`

This example shows a different target with different adapter semantics:

- placeholder syntax: `?` instead of `$1`
- type disambiguation via `CAST(... AS ...)` rather than `::type`

### Scenario

- column: `orders.total` stored as `DECIMAL(65, 30)` (exact precision)
- JS/domain value: `BigDec("1234.567890123456789012345678901")`

### Flow

#### A) Lane produces an AST with parameter references

The lane produces an AST with a parameter reference (conceptually `ParamRef(1)`) and stores the JS value in the Plan’s `params[]`:

- AST value position: `ParamRef(1)`
- Plan `params`: `[BigDec("1234.567890123456789012345678901")]`

#### B) Adapter lowers intent to SQL text

For many inserts, MySQL can infer the type from the target column. But when we want deterministic parsing behavior (and to avoid relying on driver/library heuristics), the adapter can emit an explicit cast:

- SQL:

```sql
INSERT INTO `orders` (`total`) VALUES (CAST(? AS DECIMAL(65,30)))
```

The exact cast form is dialect-specific; the point is that the adapter owns it.

#### C) Codec encodes `BigDec` to canonical boundary value

- codec encodes to a `string`:
  - `"1234.567890123456789012345678901"`

This is a bound parameter value, not SQL text.

#### D) Driver binds and executes

- driver executes:
  - SQL: `... VALUES (CAST(? AS DECIMAL(65,30)))`
  - params: `["1234.567890123456789012345678901"]`

The database parses the bound string into a DECIMAL value according to the SQL cast.

#### E) Driver returns canonical row values

Many MySQL libraries return DECIMAL columns as strings (to avoid precision loss). Under this ADR, the driver must normalize to the canonical boundary, which already allows `string`.

- row value: `"1234.567890123456789012345678901"`

#### F) Codec decodes canonical row value to `BigDec`

- codec decodes from `string` to `BigDec`

### What this illustrates

- The codec↔driver boundary remains the same across targets.
- Adapter/lowering semantics differ by dialect (casts and placeholder style), and that difference is contained entirely within the adapter.
- Precision behavior lives in codecs, not in drivers and not in SQL literal concatenation.

## Consequences

### Benefits

- Codec implementations stop depending on driver-library-specific boundary types.
- Swapping drivers becomes realistic: conforming drivers work with the same codec registry.
- Lowering remains the single owner of SQL text details (including casts), preserving parameterization and plan identity stability.
- The canonical boundary representation becomes a stable foundation for deterministic literal serialization in future features (for example `storage.sets`).

### Costs

- Drivers must normalize (or configure underlying libraries to avoid parsing into `Date`, etc.).
- Adapters may emit more explicit casts to keep DB type parsing deterministic when params are textual.

## Related ADRs

- ADR 016 — Adapter SPI for Lowering
- ADR 030 — Result decoding & codecs registry
- ADR 026 — Conformance Kit Certification
- ADR 011 — Unified Plan Model

