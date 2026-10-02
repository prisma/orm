# ADR 205 — Postgres cast emission is adapter policy, codec metadata stays descriptive

> **Retrospective note.** This ADR's examples use the `defineCodec({...})` factory. That factory was retired in favor of class-based descriptors (`CodecDescriptorImpl`) and codecs (`CodecImpl`) as described in [ADR 208](ADR%20208%20-%20Higher-order%20codecs%20for%20parameterized%20types.md). The decision this ADR records — that the SQL renderer reads `meta.db.sql.<adapter>.nativeType` as descriptive metadata and the adapter applies cast policy — is unchanged. `meta` is declared on the descriptor class today (`readonly meta = { db: { sql: { postgres: { nativeType: 'vector' } } } } as const;`). See [ADR 208](ADR%20208%20-%20Higher-order%20codecs%20for%20parameterized%20types.md) and the [Codec authoring guide](../../reference/codec-authoring-guide.md).

> **Update — the cast is written from the data type.** A codec no longer carries a native type name. The renderer finds the data type the parameter's codec represents ([ADR 254](ADR%20254%20-%20Data%20types%20and%20casts.md)), and the inferrable set, now `POSTGRES_INFERRABLE_DATA_TYPES`, holds data type ids (`pg/int2`, `pg/int4`, `pg/int8`, `pg/float4`, `pg/float8`, `pg/numeric`, `pg/bool`, `pg/text`, `pg/char`, `pg/varchar`, `pg/timestamp`, `pg/timestamptz`, `pg/time`, `pg/timetz`, `pg/interval`, `pg/bit`, `pg/varbit`). A parameter outside the set, or a list parameter, is cast to the data type's base name, the name it is written with when it has no parameters, never with the column's parameters, because an explicit cast to `varchar(n)` truncates and to `numeric(p,s)` rounds. So a cast reads `$1::int4` rather than `$1::integer`, `$1::vector` for pgvector, and `$1::"Status"` for an enum, whose data type writes its name from `typeName`. The adapter-policy decision below is unchanged; the `meta.db.sql.postgres.nativeType` field and the spellings in the set below are historical.

## TL;DR

The Postgres SQL renderer sometimes has to suffix a parameter with `::<type>` (e.g. `$1::vector`) so Postgres can resolve the parameter's type. Today it picks which casts to emit by hardcoding three codec IDs in the renderer — including a codec ID owned by an extension package, which inverts the dependency between core adapter and extension. We're moving the decision out of the renderer and onto the **adapter as policy**: the renderer reads each codec's existing `nativeType` field and casts only when the type isn't in an adapter-local "infers cleanly" allow-list. Codec authors set no new flags; extensions just work.

## A concrete query

You have a `pgvector` column and want to find rows close to a query embedding:

```sql
SELECT * FROM "embeddings" WHERE "vec" <-> $1 < 0.5
```

Run this with `[0.1, 0.2, 0.3]` as `$1` and Postgres errors:

```text
ERROR: operator does not exist: vector <-> text
```

The driver sent `$1` to Postgres as a text blob with type OID `0` ("type unknown — please infer"). Postgres tried to infer the parameter's type from the surrounding SQL, saw `<->`'s left operand is `vector`, and looked for an implicit `text → vector` cast. There is none. Inference fails.

Anyone who has used pgvector with `pg` knows the fix:

```sql
SELECT * FROM "embeddings" WHERE "vec" <-> $1::vector < 0.5
```

Postgres now treats `$1` as `vector` directly. The same fix applies to several JSON cases (`$1 -> 'key'` is ambiguous between the `json` and `jsonb` overloads) and to any extension type whose wire format Postgres can't unambiguously interpret from text.

Our SQL renderer is the thing assembling that string. **Where does the decision to emit `::vector` belong?**

Today, in `packages/3-targets/6-adapters/postgres/src/core/sql-renderer.ts`:

```ts
function getCodecParamCast(codecId: string | undefined): string | undefined {
  if (codecId === VECTOR_CODEC_ID) return 'vector';
  if (codecId === PG_JSON_CODEC_ID) return 'json';
  if (codecId === PG_JSONB_CODEC_ID) return 'jsonb';
  return undefined;
}
```

Two layering problems with this:

1. The adapter — a generic SQL renderer — names specific codec IDs.
2. `VECTOR_CODEC_ID` is owned by `@internal/extension-pgvector`. The core adapter knows about an extension package by ID, inverting the dependency.

## Decision

Split the concern along the seam between **what a codec is** and **what the adapter does with it**.

1. **Codec metadata stays descriptive.** Each codec already declares `meta.db.sql.<dialect>.nativeType` — the database's own name for the type (`vector`, `jsonb`, `int4`, …). It's used today for DDL emission and schema introspection. We add no new field.

2. **Cast emission is adapter policy.** Each adapter holds an **inferrable-types vocabulary**: the set of `nativeType`s where Postgres' unknown-OID inference is reliable in arbitrary expression contexts. The renderer:
    - Looks up the codec via the assembled stack's `codecLookup`.
    - Reads `nativeType`.
    - Emits `$N` if the type is in the adapter's vocabulary; `$N::<nativeType>` otherwise.

3. **Codec lookup reaches the renderer through the stack.** TML-2301 already routes the assembled `ControlStack` (which carries `codecLookup`) into both `SqlRuntimeAdapterDescriptor.create(stack)` and `SqlControlAdapterDescriptor.create(stack)`. We thread that lookup into the shared renderer via constructor injection on each adapter.

## How it works

### Postgres inferrable set (v1)

```ts
const POSTGRES_INFERRABLE_NATIVE_TYPES = new Set([
  // Numeric
  'integer', 'smallint', 'bigint', 'real', 'double precision', 'numeric',
  // Boolean
  'boolean',
  // Strings
  'text', 'character', 'character varying',
  // Temporal
  'timestamp', 'timestamp without time zone', 'timestamp with time zone',
  'time', 'timetz', 'interval',
  // Bit strings
  'bit', 'bit varying',
]);
```

Spellings are the values codecs actually carry in `meta.db.sql.postgres.nativeType` (Postgres `format_type`-style: `integer`, `boolean`, `timestamp with time zone`, …) — the renderer compares against this set directly, so a mismatch between set spellings and codec metadata silently breaks the policy.

Anything outside the set — including `json`, `jsonb`, all extension types, all user-defined types — gets a cast.

`json` and `jsonb` are intentionally **out** of the set despite being Postgres builtins. Their operator overloads make context inference unreliable in expression positions: `$1 -> 'key'` could resolve to either the `json` or the `jsonb` overload, and Postgres bails. The vocabulary is "types where inference is reliable in arbitrary positions," not "types Postgres ships with."

### Worked example

The pgvector extension declares its codec the same way it does today, with no new fields:

```ts
const pgVectorCodec = defineCodec({
  typeId: 'pg/vector@1',
  meta: { db: { sql: { postgres: { nativeType: 'vector' } } } },
  // … encode/decode …
});
```

The renderer condenses to one chokepoint:

```ts
function renderTypedParam(index, codecId, codecLookup) {
  const nativeType = codecLookup.get(codecId)
    ?.meta?.db?.sql?.postgres?.nativeType;
  if (nativeType && !POSTGRES_INFERRABLE_NATIVE_TYPES.has(nativeType)) {
    return `$${index}::${nativeType}`;
  }
  return `$${index}`;
}
```

A user who registers a PostGIS codec gets correct emission with zero adapter change:

```ts
const geographyCodec = defineCodec({
  typeId: 'app/geography@1',
  meta: { db: { sql: { postgres: { nativeType: 'geography' } } } },
  // …
});
// Renderer emits: $1::geography
```

### Adapters built without a stack

A bare `createPostgresAdapter()` (used in some tests and one-off scripts) defaults to a built-in lookup over the Postgres-builtin codec definitions. JSON/JSONB casts continue to emit in those callsites without composing a full stack. Extension codecs (e.g. `vector`) only flow when the codec is registered into the stack via the extension pack.

### Lowering outcomes

The renderer's `renderTypedParam` chokepoint distinguishes three cases:

1. **`ParamRef` with no `codecId`** (literal-shaped param) → plain `$N`. No codec lookup attempted.
2. **Lookup hit, no `meta.db.sql.postgres.nativeType`** → plain `$N`. The `pg/enum@1` case (see below).
3. **Lookup miss** (the `codecId` is set but the assembled lookup has no entry) → **the renderer throws at lower-time** with a message naming the offending `codecId` and pointing at extension-pack registration.

Throwing on miss is a deliberate strengthening of the "bare factories can't see extensions" position. The alternative — silently emitting `$N` when an extension `ParamRef` reaches a stack-less adapter — would defer the failure to Postgres' parser, where it surfaces as an opaque `operator does not exist: vector <-> text` later in the call. Failing at lower-time names the misconfiguration directly: *"This usually indicates a missing extension pack in the runtime stack — register the pack that contributes this codec."* Stack composition becomes a hard precondition for any query touching extension codecs, which matches the rest of the system's "explicit composition over implicit defaults" stance.

### Codecs with no static `nativeType`

`pg/enum@1` has no static `meta.db.sql.postgres.nativeType` — the type name is per-column, derived from `typeParams.values`. Codecs without a `nativeType` produce no cast. That's correct for v1: column context disambiguates enums in normal use. If per-column enum casts ever become necessary, a follow-up can route per-column metadata through `LowererContext` without changing the codec interface.

## Consequences

**Wins**

- **Codec authors do nothing extra.** They already declare `nativeType` for the catalog round-trip; cast emission is automatic.
- **Extensions just work.** Any codec with a `nativeType` outside the inferrable set casts correctly the moment it's registered into the stack — no adapter knowledge required.
- **Layering inversion fixed.** `@internal/adapter-postgres` no longer references any extension package or extension codec ID.
- **Adapter-local policy.** Each dialect adapter owns its own inferrable set and its own cast syntax (Postgres `::T`; a future MySQL adapter would emit `CAST(? AS T)`). The codec metadata is dialect-keyed already; the pattern generalises.
- **"Always cast everything" is one line away.** If we ever decide unconditional casts are worth the SQL noise (parser/planner stability, prepared-statement reuse), we shrink the inferrable set to ∅. No codec changes.

**Tradeoffs**

- **`nativeType` carries a second consumer.** Previously used for DDL and introspection; now also informs cast policy. The *value* — the database's name for the type — is identical for both, so this isn't an overload of meaning, but a future rename of `nativeType` must consider both consumers.
- **Adapter maintains the vocabulary.** ~20 entries, stable, easy to test. Cheaper than a per-codec flag distributed across every extension package.

## Alternatives considered

**A. Per-codec `paramCast: string` field on the codec.** Rejected. Conflates two concerns (the type name; the policy of when to cast), and couples the field name to the param-rendering site even though the underlying issue isn't param-specific. Also forces extension authors to know Postgres' inference rules in order to fill it in correctly.

**B. Per-codec `requiresExplicitType: boolean` flag alongside `nativeType`.** Rejected. Better than (A) because it doesn't repeat the type name, but still pushes a Postgres-specific policy decision onto every codec author. A new extension that registers a `nativeType` Postgres can't infer would silently produce broken SQL until someone remembered to flip the flag.

**C. Always cast every parameter unconditionally.** Viable future pivot. Removes the vocabulary entirely and makes SQL emission deterministic regardless of inference rules. Deferred for now because (i) it adds visual noise to every query, (ii) the existing inferrable cases work fine today, and (iii) we can land that change in one line by emptying the vocabulary, with no codec-side consequences.

**D. Driver-level type OIDs (send specific OIDs in the protocol's `Bind` message instead of `0`).** Rejected as a primary mechanism. Extension-type OIDs are install-time-assigned and not stable across databases; the driver would need to round-trip `pg_type` lookups before every prepared statement. SQL-level casts are simpler, dialect-portable, and survive prepared-statement reuse. Drivers may still send specific OIDs as an optimisation for builtins; orthogonal to this decision.

## Out of scope

- Richer cast shapes: array casts (`text[]`), parameterised casts (`varchar(50)`), per-context casts. None of the v1 codecs need them.
- Extending the same pattern to MySQL/SQLite/Mongo adapters. Postgres has the only known offender today; the data model already supports per-dialect `nativeType`, so adoption is a follow-up.
- Renaming `nativeType` to a more precise identifier. Separate concern.
- Per-column dynamic casts (e.g. enum-specific casts). Design accommodates a future `LowererContext`-borne variant if needed.
