# Slice B — Data types and casts for column defaults

**Project:** [Remove `dbgenerated`](../../spec.md). **Design:** [ADR 254 — Data types and casts](../../../../docs/architecture%20docs/adrs/ADR%20254%20-%20Data%20types%20and%20casts.md). **Linear:** not yet created. **Branch:** `remove-dbgenerated-literal-types`, PR #30350. **Shape:** one PR. **Depends on:** slice A, merged. **Followed by:** slice C, and by an independent project that implements the rest of ADR 254 (see "Not in this slice").

The branch already implements an earlier shape of this design under the name "literal types" (a closed framework union, per-codec accepted lists, conversion inside `decodeJson`, a tag registry under mutation defaults). This spec describes the rework of that branch to ADR 254's names and shapes, limited to what removing `dbgenerated` needs, so that the future project extends what ships rather than replacing it.

## Outcome

Every value written in PSL has a data type, every column has one through its codec, and a written default is admitted when its type is the column's or the column's type casts from it. Codecs of one type share its contract form. Extension authors declare a data type for every codec they ship. Nothing named in the code, the diagnostics, the docs or the upgrade instructions contradicts ADR 254.

After this slice, all of the following are true on Postgres:

```prisma
model Account {
  id       Int        @id
  name     String     @default("anonymous")
  small    SmallInt   @default(100)
  count    Int        @default(100000)
  balance  BigInt     @default(100000000000000099)
  price    Decimal    @default(1.50)
  ratio    Float      @default(NaN)
  active   Boolean    @default(true)
  meta     Jsonb      @default(json`{ "plan": "free", "seats": 1 }`)
  scores   Int[]      @default([1, 2])
  docs     Jsonb[]    @default([json`{}`, json`[]`])
  embed    pgvector.Vector(3) @default([0.1, 0.2, 0.3])
  status   Status     @default(ACTIVE)
  expires  DateTime   @default(sql`(now() + '3 days'::interval)`)
}
```

Every one of those emits, migrates onto a dev database, verifies clean, reads back through the client with its decoded type, and `contract infer` prints them back in the same forms. These are errors, each pointing at the written value:

```prisma
count  Int     @default(100000000000000099)  // pg/int4 has no cast from pg/int8; it casts from pg/int2
count  Int     @default(1.5)                 // pg/int4 has no cast from pg/numeric; ...
meta   Jsonb   @default("{}")                // pg/jsonb has no cast from pg/text; it casts from pg/json
price  Decimal @default("1.50")              // pg/numeric has no cast from pg/text; ...
meta   Jsonb   @default(json`{ plan }`)      // PSL_INVALID_JSON_LITERAL
embed  pgvector.Vector(3) @default([1, 2])   // PSL_INVALID_DEFAULT_LITERAL, with the vector codec's length message
scores Int[]   @default([1, "x"])            // no cast, named at element 2
```

## Decisions that scope this slice

Agreed with Will and Serhii on 2026-09-21.

1. **A data type is the database type made first-class, per target.** No family-level types. On Postgres the types coincide with the database's: `pg/int2`, `pg/int4`, `pg/int8`, `pg/numeric`, `pg/json`, `pg/jsonb`, and so on. On SQLite, whose storage classes are shared by several logical types, the target declares its own: `sqlite/integer` and `sqlite/bigint` are distinct types although both are `INTEGER`; `sqlite/text`, `sqlite/datetime` and `sqlite/json` are distinct although all are `TEXT`. The rule is: the target declares the types it distinguishes, and each codec names exactly one of them.
2. **Codecs of one type share its canonical contract form.** `pg/int8number@1` joins `pg/int8@1` on digit text; `sqlite/bigintnumber@1` joins `sqlite/bigint@1` on digit text. Existing contracts with such columns change form once; we are in the RC and that is an emit and a sign.
3. **Strict.** A codec that names no registered data type is an assembly error. In-repo extensions (pgvector, postgis, arktype-json) are migrated in this slice; external authors get an upgrade instruction.
4. **A cast that returns the value unchanged is a valid declaration.** `pg/jsonb` casts from `pg/json` unchanged; it states that jsonb takes json values.
5. **Not in this slice** (an independent project implements them): DDL name, aliases, parameters and their rendering moving from codec descriptors onto data types; `nativeType` derived and dropped from the contract; type constructors naming a type and a codec; function parameters typed by a data type through the attribute spec; temporal and bytes tags; the Mongo target's types beyond a name per codec.

## Amendments made during the rework

- **Generic relational codecs are descriptor templates.** `sql/text@1`, `sql/int@1`, `sql/float@1`, `sql/char@1` and `sql/varchar@1` are shared by both targets, so they carry everything a descriptor has except the data type (`CodecDescriptorTemplate`), and `postgresCodec()` / `sqliteCodec()` require `dataType` when they adapt one. (R1.)
- **Data type ids are lower case** (`mongo/objectid`). `pg/char@1` and `pg/varchar@1` name `pg/char` and `pg/varchar`; SQLite's adapted `sql/char@1`, `sql/varchar@1` name `sqlite/text`, `sql/int@1` names `sqlite/integer`, `sql/float@1` names `sqlite/real`. SQLite binds no `Boolean`, so the boolean halt condition does not apply. (R1.)
- **`dataTypes` sits at `types.codecTypes.dataTypes`** beside `codecDescriptors`; the assembled authoring contribution's `dataTypes` is required. The four invariants run behind one seam, `enforceDataTypeInvariants`, enabled once any component registers a type; R2 removes the gate. (R1.)

- **The plain-number authoring entry declares the types its classifier can return** (`types`), and assembly counts those as writable for invariant 4, since `pg/int2` and friends have no entry of their own and are reached only through the classifier. The number form carries `classify` instead of `parse`. (R2.)
- **Data types are registered on `ComponentMetadata.dataTypes`**, a sibling of `types`, `authoring` and `controlMutationDefaults`, not under `types.codecTypes`: an extension's `types` block is copied into its contract space, and a cast is a function no contract can hold. (R2.)
- **SQLite has no boolean data type and no boolean entry.** A plain `true`/`false` on SQLite is refused with a diagnostic saying the target has no data type for a boolean value; nothing on `main` accepted it either, since SQLite binds no `Boolean`. (R2, for R3.)
- **`@prisma/orm-postgres` exposes a `./data-types` subpath** so the target's declarations are reachable through the facade. (R2.)

## Design

### B1. Data types in the framework

File: `packages/1-framework/1-core/framework-components/src/shared/data-type.ts`, exported through `src/exports/codec.ts`. Replaces `literal-types.ts` and `literal-types-write.ts` (deleted; the classifier implementation and the numeral writer move to the SQL family, B4).

```ts
export type DataTypeId = string & { readonly __brand: 'DataTypeId' };   // 'owner/name', no version
export type Cast = (value: JsonValue) => JsonValue;                     // canonical form of the source → canonical form of this type; may throw a structured error
export interface DataType {
  readonly id: DataTypeId;
  readonly casts: Readonly<Record<DataTypeId, Cast>>;
  readonly listCast?: { readonly of: readonly DataTypeId[]; readonly cast: (elements: readonly JsonValue[]) => JsonValue };
}
export function dataType(id: string, spec: { casts?: ...; listCast?: ... }): DataType;
export function dataTypeId(id: string): DataTypeId;                      // validates 'owner/name'
```

`listCast` is how a type whose single value holds several elements (vector) takes a PSL list: each element's type must be in `of`, and `cast` receives the elements' canonical forms. There is no list data type.

`CodecDescriptor` gains `readonly dataType: DataTypeId`, required, abstract on `CodecDescriptorImpl`; `literalTypes` is removed. Mongo's `mongoCodec({...})` factory takes `dataType` too.

Registration: a pack's codec contribution gains a sibling `dataTypes: readonly DataType[]`. The control stack assembles them into a `DataTypeLookup` (`get(id)`, `has(id)`) beside `CodecLookup`, refusing two declarations of one id, and enforces at assembly, with a structured error naming the contributor and the dangling id:

1. every codec's `dataType` is registered;
2. every `authoring.dataTypes` key and every cast source (scalar and `listCast.of`) is registered;
3. no two authoring entries claim one tag or one plain kind;
4. every cast source has an authoring entry (a type nobody can write cannot be cast from).

References inside a pack are by constant (`pgInt8.id`), never by string literal.

### B2. PSL support for data types

The tag registry leaves `ControlMutationDefaults`. The authoring contribution (`AuthoringContributions`, where entity types and attribute specs already live) gains `dataTypes`, keyed by type id:

```ts
interface DataTypeAuthoringEntry {
  readonly written: { kind: 'tag'; tag: string } | { kind: 'plain'; syntax: 'string' | 'boolean' | 'number' };
  readonly parse: (text: string) => JsonValue;          // throws a structured error for text it cannot read
  readonly print: (value: JsonValue) => string;
  readonly documentation: string;
}
```

For the plain `number` syntax one entry per target carries the **classifier**: `classify(text): { type: DataTypeId; value: JsonValue } | undefined`. The `sql` tag is registered in the same map as the one lowering entry (`{ written: { kind: 'tag', tag: 'sql' }, lower }`), keyed by a reserved key rather than a type id; `pg.sql` and `sqlite.sql` likewise. Assembly merges every contributor's map (invariant 3 above). The language server reads tag completion and documentation from these entries; the interpreter, the printer and the Prisma 7 reader read `parse`, `print` and the classifier.

### B3. Postgres

Files: `packages/3-targets/3-targets/postgres/src/core/data-types.ts` (new), `codecs.ts`, `temporal-codecs.ts`, `temporal-string-codecs.ts`, `date-codecs.ts`, `codec-helpers.ts`; `packages/3-targets/6-adapters/postgres/src/core/control-mutation-defaults.ts` (the tag registration moves out) and the adapter's authoring contribution.

Types, one per database type the target's codecs bind to, with each codec's `dataType`:

| Data type | Codecs | Canonical form | Casts from |
|---|---|---|---|
| `pg/text` | `pg/text@1`, `sql/text@1` | text | |
| `pg/char`, `pg/varchar` | `sql/char@1`, `sql/varchar@1` | text | `pg/text` |
| `pg/uuid`, `pg/inet`, `pg/bit`, `pg/varbit`, `pg/timetz`, `pg/interval`, `pg/bytea` | the codec of each | text | `pg/text` |
| `pg/date`, `pg/time`, `pg/timestamp`, `pg/timestamptz` | the `-string@1`, `-temporal@1` and `timestamptz-date@1` codecs of each | text | `pg/text` |
| `pg/enum` | `pg/enum@1` | text | none (members are references) |
| `pg/int2` | `pg/int2@1` | JSON number | |
| `pg/int4` | `pg/int4@1`, `pg/int@1`, `sql/int@1` | JSON number | `pg/int2` |
| `pg/int8` | `pg/int8@1`, `pg/int8number@1` | digit text | `pg/int2`, `pg/int4` (number → digit text) |
| `pg/numeric` | `pg/numeric@1`, `pg/unboundedint@1` | decimal text, or `NaN`/`Infinity`/`-Infinity` | `pg/int2`, `pg/int4` (number → text), `pg/int8` (text) |
| `pg/float4`, `pg/float8` | `pg/float4@1`, `pg/float8@1`, `pg/float@1`, `sql/float@1` | JSON number, or the three words as text | `pg/int2`, `pg/int4`, `pg/int8`, `pg/numeric` (text and words → number or word) |
| `pg/bool` | `pg/bool@1` | boolean | |
| `pg/json` | `pg/json@1` | the document | |
| `pg/jsonb` | `pg/jsonb@1` | the document | `pg/json` (unchanged) |
| `pg/text-array` | `pg/text-array@1` | array of text | none (contract-free only) |

`pg/unboundedint@1` binds `numeric`; its digit text is a valid decimal text, so it is a codec of `pg/numeric`. `pg/float@1` and `sql/float@1` refuse the three words in `decodeJson` (representation limit); the cast from `pg/numeric` still produces them and the codec refuses with its own message. A codec whose database type is not in this table is a halt condition.

Authoring entries: `pg/text` plain string; `pg/bool` plain boolean; the number classifier: a whole number within 16 bits is `pg/int2`, within 32 `pg/int4`, within 64 `pg/int8`, anything else (larger, a fraction, or the three words) `pg/numeric`; `pg/json` tag `json`; the `sql` and `pg.sql` lowering entries.

### B4. SQLite and the SQL family

SQLite (`packages/3-targets/3-targets/sqlite/src/core/`, adapter authoring contribution): types `sqlite/text` (`text@1`), `sqlite/datetime` (`datetime@1`, casts from `sqlite/text`), `sqlite/json` (`json@1`, tag `json`), `sqlite/blob` (`blob@1`, casts from `sqlite/text`), `sqlite/integer` (`integer@1`, JSON number), `sqlite/bigint` (`bigint@1`, `bigintnumber@1`, digit text; casts from `sqlite/integer`), `sqlite/real` (`real@1`, JSON number; casts from `sqlite/integer` and `sqlite/bigint`). Classifier: a whole number within the safe integer range is `sqlite/integer`, within 64 bits `sqlite/bigint`, a fraction `sqlite/real`, anything else refused with a message saying no SQLite type holds it. Plain string → `sqlite/text`. There is no boolean type on SQLite unless the target already binds `Boolean`; if it does, the implementer reports how before adding one (halt condition).

The SQL family (`packages/2-sql/9-family`, `relational-core`) registers no types. It exports the shared implementations the targets use: the integer-width classifier (parameterised by the target's type ids and widths), the numeral canonicaliser (leading zeros, sign of zero, trailing zeros kept) and writer (no exponent), the JSON parse and print, and the `sql` lowering entry. The generic `sql/*` codecs name the data type of whichever target adapts them (`sql/int@1` is a codec of `pg/int4` on Postgres).

Extensions: `pgvector/vector` (`pg/vector@1`; `listCast` of `pg/int2`, `pg/int4`, `pg/int8`, `pg/numeric`, elements to numbers); `postgis/geometry` (`pg/geometry@1`; casts from `pg/text`); `arktype/json` (`arktype/json@1`; casts from `pg/json` unchanged, the codec instance validates). Mongo: one type per codec, no casts, no authoring entries.

### B5. Codecs are strict again

Every coercion added to `decodeJson` on this branch (int8 and bigint codecs reading numbers, number-valued codecs reading text, numeric reading numbers, float codecs reading text, vector reading text elements) is removed; those conversions are the casts in B3 and B4. `pg/float4@1`/`pg/float8@1` keep the non-finite words as their JSON and wire form, because that is the type's canonical form. `pg/int8number@1` and `sqlite/bigintnumber@1` change `encodeJson` to digit text and `decodeJson` to read it, refusing past 2^53 with a message naming the limit. `isNumeralText`/`isNonFiniteText`/`numeralText` move to the family export.

### B6. The interpreter

`packages/2-sql/2-authoring/contract-psl/src/literal-default.ts`, `psl-column-resolution.ts`, `sql-attribute-specs.ts`. The `@default` arms are unchanged from the branch (plain scalars, list, function calls, one tagged-literal arm per entry). Reading a default:

1. A reference resolves (enum member path unchanged); a call dispatches; a lowering tag lowers.
2. A literal is parsed through the authoring entry for its syntax (tag by name; plain string, boolean, or the classifier) into `{ type, value }`. A parse failure is `PSL_INVALID_DEFAULT_LITERAL`, or `PSL_INVALID_JSON_LITERAL` for the `json` entry; an unregistered tag is `PSL_UNKNOWN_DEFAULT_LITERAL_TAG`.
3. The column's type is `codecLookup.descriptorFor(codecId).dataType`. If the value's type differs, the column type's `casts[valueType]` is applied (per element against the element codec's type for a list column; `listCast` for a list literal on a scalar column). No cast is `PSL_DEFAULT_TYPE_INCOMPATIBLE`: `Field "Account.count": pg/int4 has no cast from pg/int8; it casts from pg/int2`, with ` at element N` inside a list. A cast that throws is `PSL_INVALID_DEFAULT_LITERAL` with its message.
4. The canonical form is validated by the codec instance for the column's `typeParams` (`materializeCodec`, `decodeJson`); a throw is `PSL_INVALID_DEFAULT_LITERAL` with the codec's message.
5. The canonical form is stored as the default's literal value. `build-contract.ts` no longer re-encodes a PSL default (it still encodes a TypeScript `.default(value)` through `encodeJson`); `AuthoredColumnDefaultLiteralValue` loses its `bigint` arm if nothing else needs it.

`PSL_DEFAULT_LITERAL_TYPE_INCOMPATIBLE` is renamed `PSL_DEFAULT_TYPE_INCOMPATIBLE`. The Prisma 7 reader (`contract-prisma7/src/defaults.ts`) calls the same core with its own syntax mapped onto the plain kinds and the `json` entry; its diagnostic code and the Bytes/DateTime expression path are unchanged.

### B7. The printer

`packages/2-sql/9-family/src/core/psl-contract-infer/default-mapping.ts`, `packages/3-targets/3-targets/postgres/src/core/psl-infer/`. For a stored literal: classify the canonical form with the target's rules (digit text or a number through the classifier, the three words → the numeric type, a document → the JSON type, text → the text type, a boolean, an array element by element); confirm the column's type is that type or casts from it; print with the source entry's `print`; run the text back through parse and cast and confirm it equals the stored value; otherwise the raw-expression fallback. `infer-default-codec.ts` resolves a printed type name to a codec descriptor as on the branch, and reads the type from it.

### B8. Docs and upgrade instructions

- ADR 254: add the SQLite note from decision 1 (a target declares the types it distinguishes where the database's storage classes are shared).
- `docs/reference/codec-authoring-guide.md`: `dataType` is required on every descriptor; how to declare a data type with casts; the authoring entry; strict assembly.
- `docs/reference/error-reference.md`: the renamed code and messages.
- `packages/2-sql/2-authoring/contract-psl/README.md`: the paragraph on defaults in the ADR's words.
- `upgrade-instructions/pending/literal-types-column-defaults/`: app instructions gain the contract-form change for `int8number`/`bigintnumber` columns (re-run `contract emit`, then `db sign`); extension instructions are rewritten: declare a data type per codec, name it on the descriptor, casts replace accepted lists, `decodeJson` takes only the canonical form, the authoring entry replaces the tag registry entry, strict assembly.
- Every "literal type" this branch introduced in code, comments, docs and tests becomes "data type"; `git grep -n "literalTypes\|LiteralTypeName\|isCompatible\|integerLiteralTypesUpTo\|defaultLiteralTagRegistry\|isDefaultLiteralTagLoweringEntry\|PSL_DEFAULT_LITERAL_TYPE_INCOMPATIBLE" -- packages docs upgrade-instructions` returns nothing, and `git grep -in "literal type" -- $(git diff --name-only origin/main...HEAD)` returns nothing (pre-existing text elsewhere is out of scope).

## Tests (written first; each named test must fail before its implementation lands)

- Framework: `dataType()` validates ids; `DataTypeLookup`; each of the four assembly invariants fails with the named contributor and id; a codec descriptor without `dataType` fails to compile (test-d).
- Per pack: an inventory test asserting every registered codec's `dataType` and every registered type's cast sources against a table (Postgres, SQLite, relational-core adapted codecs, pgvector, postgis, arktype-json, Mongo).
- Casts: each cast in B3/B4 with its conversion (`pg/int2 → pg/int8`: `42 → "42"`; `pg/numeric → pg/float8`: `"1.5" → 1.5`, `"NaN" → "NaN"`; `pg/json → pg/jsonb` unchanged; vector list cast).
- Classifier per target: every boundary (16, 32, 64 bits, safe integer on SQLite, negative bounds, `-0`, leading zeros, trailing zeros, the three words, refused on SQLite).
- Codecs: `decodeJson` refuses every non-canonical shape it accepted on the branch; `int8number`/`bigintnumber` round-trip digit text and refuse past 2^53.
- Interpreter: every Outcome column and every error form above, whole default object asserted; the enum reference path; Prisma 7 reader parity.
- Printer: round trip for every Outcome column; the decode-check fallback for `'infinity'::timestamp`.
- Journeys: the branch's e2e, pgvector, infer round-trip and parity tests, updated to the new names; `pnpm fixtures:check` shows exactly the `int8number`/`bigintnumber` columns changing form and nothing else, after which the fixtures are re-emitted and committed.

## Definition of done

- `pnpm typecheck`, `pnpm test:packages`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm lint`, `pnpm lint:deps`, `pnpm lint:docs`, `pnpm lint:throws`, `pnpm lint:framework-vocabulary`, `pnpm fixtures:check`, `pnpm check:upgrade-coverage --mode pr` green.
- The grep in B8 returns nothing; `git grep -n "defaultLiteralTagRegistry" -- packages` returns nothing.
- Every in-repo codec names a registered data type; assembly is strict.
- PR #30350 updated: description rewritten around ADR 254, title without a Linear prefix.

## Halt conditions

- A codec binds a database type that the B3/B4 tables do not place, or two codecs of one type cannot share a canonical form without a conversion the ADR does not describe.
- SQLite binds `Boolean` to a codec that also serves another type.
- The authoring contribution cannot carry `dataTypes` without a layering violation.
- A contract other than the `int8number`/`bigintnumber` columns changes form under `fixtures:check`.

## Not in this slice

See decision 5. The future project owns: DDL name and aliases, parameters and rendering on data types; `nativeType` removal; type constructors naming a type and a codec; function parameters as typed receivers; temporal and bytes tags; Mongo types beyond a name per codec.
