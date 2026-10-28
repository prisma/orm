# ADR 275 — Client generators are field attributes, and a type alias is expanded into each column

**Status:** Implemented
**Date:** 2026-10-16
**Builds on:** [ADR 158 — Execution mutation defaults](ADR%20158%20-%20Execution%20mutation%20defaults.md), [ADR 241 — Scalar types use the authoring type-constructor channel](ADR%20241%20-%20Scalar%20types%20use%20the%20authoring%20type-constructor%20channel.md), [ADR 269 — PSL mixins](ADR%20269%20-%20PSL%20mixins.md)
**Supersedes:** the field-preset half of [ADR 170 — Pack-provided type constructors and field presets](ADR%20170%20-%20Pack-provided%20type%20constructors%20and%20field%20presets.md); [ADR 246 — Option arguments and select templates for authoring helpers](ADR%20246%20-%20Option%20arguments%20and%20select%20templates%20for%20authoring%20helpers.md), except its two omission rules
**Amends:** [ADR 104](ADR%20104%20-%20PSL%20extension%20namespacing%20%26%20syntax.md), [ADR 158](ADR%20158%20-%20Execution%20mutation%20defaults.md), [ADR 169 — Declared applicability for mutation default generators](ADR%20169%20-%20Declared%20applicability%20for%20mutation%20default%20generators.md), [ADR 208 — Higher-order codecs for parameterized types](ADR%20208%20-%20Higher-order%20codecs%20for%20parameterized%20types.md), [ADR 212 — AST-bound codec resolution](ADR%20212%20-%20AST-bound%20codec%20resolution.md), [ADR 231](ADR%20231%20-%20Declarative%20attribute%20specifications.md), [ADR 241](ADR%20241%20-%20Scalar%20types%20use%20the%20authoring%20type-constructor%20channel.md), [ADR 249](ADR%20249%20-%20Central%20attribute-spec%20registry.md), [ADR 254](ADR%20254%20-%20Data%20types%20and%20casts.md)
**Amended 2026-10-21:** the TypeScript `types` key is renamed `databaseTypes` and registers database types only; a contributed alias is used as `field.column(type.temporal.UpdatedAt())`; a contributed alias carries no database default; Mongo's contributed aliases are on `Date`; the Mongo TypeScript builder gets no contributed aliases yet. Each change is marked "Amended 2026-10-21" below.
**Amended 2026-10-22:** every SQL target gains the type constructor `sql.Char(n)`, because SQLite had no other way to write the `sql/char@1` column of the identifier presets; a preset call is refused with its exact rewrite, in PSL and, at run time, in TypeScript; the `number` and `object` argument kinds and an argument reference's `path` and `default` go with `option` and `select`; `@prisma/orm-postgres/contract-builder` and `@prisma/orm-sqlite/contract-builder` export `type`. Each change is marked "Amended 2026-10-22" below.
**Amended 2026-10-23 by [ADR 310 — Each generated identifier has a type alias for its column](ADR%20310%20-%20Each%20generated%20identifier%20has%20a%20type%20alias%20for%20its%20column.md):** each generated identifier format gets a type alias for its column, such as `Ulid` for `Char(26)`. The change is marked "Amended 2026-10-23" below.

---

## At a glance

```prisma
types {
  UpdatedAt = TimestampString(3) @onCreate(now()) @onUpdate(now())
}

model Post {
  id        String    @id @onCreate(uuid())
  updatedAt UpdatedAt @default(now())
}
```

- `@onCreate(uuid())` tells the client to generate a UUID when a `Post` is created without an `id`.
- `UpdatedAt` is a type alias. It stands for the column type `TimestampString(3)` with two generators: the client writes the current time on create and on every update.
- `@default(now())` is a database default. The database writes its own `now()` when a row is inserted without a value, for example by a write that does not go through the client.
- The contract stores no alias. It stores the column `updatedAt` as `pg/timestamp-string@1` with `{ "precision": 3 }`, a database default `now()`, and generators on create and on update, exactly as if each attribute had been written on the field.

The same schema written with today's field presets is:

```prisma
model Post {
  id        String @id @default(uuid())
  updatedAt temporal.timestampString(3, onCreate: now, onUpdate: now) @default(now())
}
```

## Decision

1. `@onCreate(fn())` and `@onUpdate(fn())` set the generators the client runs on create and on update. `fn` resolves to the generator the stack registers for the column's codec. When the stack registers none, the attribute is refused.
2. A generator's params come from the column's type parameters. `now()` on a `Time(3)` column gets the generator with `{ precision: 3 }`.
3. `@default` means a database default only. The client generators `@default` takes today (`uuid()`, `cuid(2)`, `ulid()`, `nanoid()`) move to `@onCreate`.
4. A type alias is authoring shorthand. PSL and the TypeScript builder expand it into each column that uses it, and the contract never stores the alias.
5. An alias may carry `@default`, `@onCreate` and `@onUpdate`. It may not carry `@id` or `@unique`, which are facts about a model, not about a column type.
   A field typed by an alias may add those attributes, but may not repeat one the alias sets.
6. Field presets are removed from both families (SQL and Mongo) and both authoring surfaces (PSL and the TypeScript builder). Targets and extensions contribute type aliases instead, in their namespace, such as `temporal.UpdatedAt`. Contributed aliases take no parameters.
7. Mixins (ADR 269) stay. An alias is one reusable column type. A mixin is a set of named fields.

## Why

A field preset bundles a codec, its type parameters and its generators into one call. That bundle caused three problems.

First, the preset author pairs a codec with a generator by hand. A generator returns an in-memory value that the codec then encodes, and two codecs of one data type expect different values. `pg/timestamp-string@1` expects a string and `pg/timestamp-temporal@1` expects a `Temporal.PlainDateTime`, though both store `timestamp`. A string-timestamp preset was once paired with a generator that returns a `Date`. Resolving the generator from the column's codec removes that class of mistake: no author makes the pairing.

Second, a preset is a second way to write what attributes already say. `@default(uuid())` and `id.uuidv4String()` both produce a client generator on create. Presets also brought their own vocabulary: an `option` argument kind for the bare token `now`, and a `select` template that maps that token to a generator id (ADR 246). `contract print` had to check that a preset call reads back as the stored column before writing it.

Third, `@default(now())` and `@default(uuid())` look alike but do different things. The first is a database default. The second is a client generator. The reader cannot tell which from the attribute. After this decision, the attribute names who writes the value: `@default` is the database, `@onCreate` and `@onUpdate` are the client.

Aliases were stored in the contract because PSL once had no syntax for type parameters, so a parameterized type needed a name (ADR 104). Type constructors with inline arguments (ADR 241) removed that reason. ADR 208 already copies an alias's params into each column for the runtime. Nothing in production reads the alias name: the runtime keys codec instances by codec id and params, the migration planner and `db verify` work on a schema IR that has already replaced each alias with its type, and no codec reads the instance name. The contract keeps only what exists in the database.

## How it works

### A generator resolves by function name and codec

The stack gets a generator function registry (new). Each entry is a function name, such as `now` or `uuid`, with its argument signature and a map from codec id to generator. The family, the target and extensions contribute entries; the control stack assembles them, and two components that map the same function name and codec is an assembly error.

For Postgres, `now` maps each date and time codec to its generator. That map exists today as `postgresNowGeneratorIds` and `postgresNowGeneratorFor` in `@internal/target-postgres`; it becomes the Postgres contribution for `now`:

| Codec | Generator | Params from the column |
| --- | --- | --- |
| `pg/timestamptz-temporal@1` | `instantNow` | none |
| `pg/timestamp-temporal@1` | `plainDateTimeNow` | none |
| `pg/timestamptz-string@1` | `timestamptzStringNow` | none |
| `pg/timestamp-string@1` | `timestampStringNow` | none |
| `pg/timestamptz-date@1` | `timestampNow` | none |
| `pg/date-temporal@1`, `pg/date-string@1` | `plainDateNow`, `dateStringNow` | none |
| `pg/time-temporal@1`, `pg/time-string@1`, `pg/timetz@1` | `plainTimeNow`, `timeStringNow`, `timetzNow` | `precision` |

SQLite maps `sqlite/datetime@1` to `timestampNow`. Mongo maps `mongo/date@1` to `timestampNow`.

`uuid`, `cuid`, `ulid`, `nanoid` and `ksuid` (new; a `ksuid` generator exists but no function names it) map every text-like codec of the target to their generators. The lists must be complete. Today the applicability lists name only `pg/text@1`, `sql/char@1` and `pg/uuid@1`, so `uuid()` on a SQLite `String` (`sqlite/text@1`) or a Postgres `VarChar` (`sql/varchar@1`) is refused; that is a defect this registry fixes.

An entry also says which of the column's type parameters become generator params. The time generators take `precision`, so they write a value the column stores without rounding. `nanoid` takes its `size` from the call, or 21. It never reads the column's `length`, which would turn `VarChar(255)` into 255-character identifiers. Every identifier generator states how many characters it writes, and a column whose length, in its type's normal form, is shorter is refused, because the identifier does not fit: `uuid() writes 36 characters, which does not fit a column of 5 characters.` A bare `Char` counts as one character. SQLite columns are never refused for length, because SQLite stores the longer value. The arguments of `uuid`, `cuid` and `nanoid` are values of the target's integer type, read by the cast rule of [ADR 254](ADR%20254%20-%20Data%20types%20and%20casts.md) and then checked by the function (`PSL_INVALID_GENERATOR_ARGUMENT`); each target declares those three signatures with its integer type. (Amended by TML-3389.)


Compatibility is checked by codec, not by data type. Two codecs of one data type expect different in-memory values, so a data-type check would accept a generator whose output the codec cannot encode.

### The attribute picks the registry

`now` is both a database function and a client generator. The attribute decides which one a call means:

- `@default(fn())` looks `fn` up in the default function registry. After this decision, every entry there lowers to a database default: `now()` and `autoincrement()`. `@default(uuid())` finds no entry and is refused with a message that names `@onCreate(uuid())`.
- `@onCreate(fn())` and `@onUpdate(fn())` look `fn` up in the generator function registry and resolve it by the column's codec.

Each attribute has an attribute spec in the central registry (ADR 249), so the language server completes and documents the functions each position accepts.

### A database default and a generator on one column

```prisma
model Post {
  id        Int      @id
  createdAt DateTime @default(now()) @onCreate(now())
}
```

This is allowed and produces no diagnostic, as ADR 158 §4 already says. A create through the client writes the client's time. A write that does not go through the client gets the database's `now()`. Each attribute sets one fact, and the user wrote both.

`@onUpdate` alone is allowed. On a required field the client then needs a value on create.

### Aliases are expanded

The PSL interpreter resolves an alias's right-hand side, a type constructor call with any of `@default`, `@onCreate` and `@onUpdate`, and applies it to each field typed by the alias. A field may also write any of those attributes the alias does not set. A field that writes an attribute its alias already sets is an error, as a duplicate member is for a mixin (ADR 269): the schema states each fact once. `@id` or `@unique` on an alias is an error.

The contract stores each column with its codec, data type and type parameters inline, with no `typeRef`. `storage.types` keeps only types a contract space registers as database types: pgvector's `vector` and PostGIS's `geometry`. Native enums are not in `storage.types`; they are `native_enum` entries in a namespace (ADR 157).

What this changes elsewhere:

- **Runtime codecs.** The runtime already keys codec instances by codec id and canonical params, so columns with equal params share one instance before and after. Only the instance's `name` changes, from the alias name to the column sentinel `<col:Table.column>`. No codec reads `name` or `usedAt` today. A codec that needs state shared by a chosen set of columns, such as an encryption key, must put what identifies that set in its type parameters. `ExecutionContext.types`, a map of codecs by alias name that only tests read, is removed.
- **Migrations and `db verify`.** `contractToSchemaIR` already writes a `typeRef` column as a column of the referenced type, so DDL and verification results do not change. The codec hooks `planTypeOperations` and `verifyType` keep running for registered types only. The field event planner compares two columns by codec, data type and params instead of by `typeRef`, so a contract that drops its aliases fires no `altered` events.
- **Contract spaces.** pgvector's and PostGIS's contracts keep their registered types, and their storage hashes do not change. Supabase's contract (which declares nine aliases for its `auth` and `storage` tables) is re-generated in the expanded form. A foreign key across spaces keeps verifying: in `packages/3-extensions/supabase/test/cross-contract-fk.integration.test.ts`, an app column written inline as `pg/uuid@1` references `auth.users.id`, which the Supabase space stores through the alias `Id`, and `db verify` reports zero issues. Foreign keys across spaces carry column names only, and verification compares the database against resolved column types.

### What targets and extensions contribute

A pack's `type` namespace gains a type alias descriptor (new). Its output names a type constructor with fixed arguments and a generator function for each phase. The PSL interpreter and the TypeScript builder expand it exactly like a user alias. (Amended 2026-10-21: a contributed alias carries a type and generators only, and no database default. No contributed alias needs one, and a default would be a SQL concept on a framework descriptor that Mongo could not use. A database default can be added to the descriptor later, when a pack needs one, with its own check at assembly. Assembly checks the alias's fixed type parameters against its codec's parameter schema, and resolves its generator calls for the field length those parameters give, so a broken pack is refused with `CONTRACT.PACK_CONTRIBUTION_INVALID` before any schema is read.)

The Postgres target contributes `temporal.CreatedAt` and `temporal.UpdatedAt` on `TimestamptzTemporal`, with `String` and `JsDate` variants on the string and `Date` codecs (all new names). SQLite contributes `temporal.CreatedAt` and `temporal.UpdatedAt` on `DateTime`; Mongo the same on its `DateTime`. (Amended 2026-10-21: Mongo's aliases are on `Date`, because Mongo's `DateTime` constructor is deprecated. Both name the codec `mongo/date@1`, so the stored column is the same. The Postgres variants are named `temporal.CreatedAtString`, `temporal.UpdatedAtString`, `temporal.CreatedAtJsDate` and `temporal.UpdatedAtJsDate`.) Contributed aliases take no parameters, so a column with a precision is written with the attributes:

```prisma
model Event {
  id        String              @id @onCreate(uuid(7))
  createdAt temporal.CreatedAt
  updatedAt temporal.UpdatedAt
  seenAt    Time(3)             @onCreate(now()) @onUpdate(now())
}
```

(Amended 2026-10-23.) An alias may not carry `@id`, so an identifier preset becomes an alias for its column, with `@id` and the generator written on the field. [ADR 310 — Each generated identifier has a type alias for its column](ADR%20310%20-%20Each%20generated%20identifier%20has%20a%20type%20alias%20for%20its%20column.md) adds an alias for each identifier column: `id.ulid()` becomes `Ulid @id @onCreate(ulid())`, `id.uuidv4String()` becomes `UuidString @id @onCreate(uuid())`, and `id.uuidv7Native()` becomes `Uuid @id @onCreate(uuid(7))`. The plain scalar presets (`text`, `int`, `boolean`, …) are already PSL type constructors (`String`, `Int`, `Boolean`, …).

(Amended 2026-10-22.) The SQL family contributed its identifier presets to SQLite too, and SQLite had no type constructor for their `sql/char@1` column, since `Char(n)` is a Postgres constructor. So every SQL target gets `sql.Char(n)`, beside `sql.String(n)`, and a family preset's column can be written on every SQL target, such as `sql.Char(36)`. (Amended 2026-10-23: the rewrite names the column's alias from ADR 310 instead, such as `sql.UuidString @id @onCreate(uuid())`; `sql.Char(n)` remains for other lengths.) On Postgres, `Char(36)` stores the same column and stays the form that `contract print` writes and the docs use. A preset call is refused with `PSL_UNRESOLVED_REFERENCE`, through the family's `describeUnresolvedType`, and the message is the exact rewrite: `id.uuidv4String() was a field preset, and Prisma 8 removed field presets. Write UuidString @id @onCreate(uuid()).` on Postgres, and `Write sql.UuidString @id @onCreate(uuid()).` on SQLite and MySQL (amended 2026-10-23). A component whose `authoring` still has a `field` key is refused with `CONTRACT.PACK_CONTRIBUTION_INVALID`, so an extension built against the old types does not lose its presets silently.

### The TypeScript builder

The builder mirrors PSL. The field builder gets `.onCreate(...)` and `.onUpdate(...)` (new), immutable like `.default()`. They take a generator function call from a `gen` namespace (new): `gen.now()`, `gen.uuid(7)`, `gen.nanoid()`, and so on. `gen` is built from the composed packs, as the `type` helpers are, so a stack's `gen` holds exactly the functions its packs declare, an extension's included. Lowering resolves the call by the column's codec through the same registry PSL uses. `.default()` keeps taking a literal or the database functions `now()` and `autoincrement()`.

A TypeScript alias is a constant, because field builders are immutable:

```ts
const UpdatedAt = field.column(type.TimestampString(3)).onCreate(gen.now()).onUpdate(gen.now());

const Post = model('Post', {
  fields: {
    id: field.column(textColumn).id().onCreate(gen.uuid()),
    updatedAt: UpdatedAt.default(now()),
  },
});
```

`type.*` gets a helper for every PSL type constructor of the stack (most are new, such as `type.TimestampString(3)`), and `field.column` accepts the result. Contributed aliases appear as `type.temporal.UpdatedAt()` (new). `field.generated(...)`, the codec-instance use of `field.namedType(...)`, the `types` key for codec instances and every preset helper are removed. (Amended 2026-10-22.) The `field` that `@prisma/orm-postgres/contract-builder` exports for query fragments had the presets, so the entry also exports `type`, and a fragment writes `field.column(type.TimestamptzTemporal())`, as a contract does. `@prisma/orm-sqlite/contract-builder` exports `type` for the same reason, so the rewrite its `field` names for a removed preset, such as `field.column(type.sql.UuidString())`, can be written outside the callback.

(Amended 2026-10-22.) A read of a removed preset from `field`, such as `field.id.uuidv7String`, throws `CONTRACT.FIELD_HELPER_UNKNOWN` with the rewrite, worded as PSL's refusal. The types still refuse the call at compile time; the run-time refusal is for a contract emitted before it is type-checked, and for JavaScript. Without it, `prisma contract emit` of a contract that still calls a preset failed with `Cannot read properties of undefined`, which names neither the preset nor the fix. The refusal adds no name to the public types. Only the removed preset names are answered; every other read of `field` behaves as on a plain object. A SQL preset's rewrite is named only where the stack's `type` namespace has the type it writes and that type stores the preset's codec, as in PSL, so `field.json` on SQLite names the forms that replace presets instead of `type.Jsonb()`.

(Amended 2026-10-21.) The `types` key cannot simply go. pgvector and PostGIS register their database types, `vector` and `geometry`, through it, because PSL has no syntax for an extension to register a database type. The key is renamed `databaseTypes`, and it means only "register a database type in this contract space". No column can reference an entry, because `field.namedType(...)` keeps only its enum-handle form. A definition that still has a `types` key is refused with `CONTRACT.TYPES_KEY_REMOVED`, whose message says to write an alias as a constant and a registered type under `databaseTypes`. Keeping the old name would silently turn every existing user alias into a registered database type. pgvector's and PostGIS's contracts and hashes do not change.

A contributed alias is used through `field.column`, like every other `type.*` helper: `field.column(type.temporal.UpdatedAt())`. Every `type.*` helper returns a column type, and a field needs the builder for `.optional()`, `.id()`, `.default()` and the rest. `.default()` on a builder that already has a default is refused with `CONTRACT.DEFAULT_INVALID` (reason `default-set-twice`), as a repeated attribute is in PSL. The table's second row is amended accordingly.

| Today | After |
| --- | --- |
| `field.temporal.timestamp(3, 'now', 'now')` | `field.column(type.TimestampTemporal(3)).onCreate(gen.now()).onUpdate(gen.now())` |
| `field.temporal.updatedAt()` | `field.column(type.temporal.UpdatedAt())` (amended 2026-10-21) |
| `field.id.uuidv4String()` | `field.column(type.UuidString()).id().onCreate(gen.uuid())` on Postgres, `field.column(type.sql.UuidString()).id().onCreate(gen.uuid())` on every SQL target (amended 2026-10-23) |

### Mongo

Mongo has no `@default` attribute and no `types {}` block today, its default function registry is empty, and its only generators come from the `temporal.*` presets. After this decision Mongo PSL accepts `@onCreate` and `@onUpdate` with `now()` for `mongo/date@1`, accepts `types {}` aliases (expanded, so Mongo storage gains nothing), and gets the contributed `temporal.CreatedAt` and `temporal.UpdatedAt`. The Mongo TypeScript builder gets `.onCreate` and `.onUpdate`. (Amended 2026-10-21: the Mongo TypeScript builder has no `type.*` helpers and no `field.column`, so it gets no contributed aliases for now. Its form of `field.temporal.updatedAt()` is `field.date().onCreate(gen.now()).onUpdate(gen.now())`. A type-constructor surface for the Mongo builder is its own design.) The Prisma 6 reader resolves `@updatedAt` and `@default(now())` through the generator registry instead of a fixed generator id.

### The Prisma 7 reader

The Prisma 7 reader builds the contract directly and writes no aliases. It reads `@updatedAt` as `now` resolved for both phases, and reads Prisma 7's client functions in `@default` (`uuid()`, `cuid()`, `nanoid()`, `ulid()`) as `@onCreate`, both through the generator function registry. `@default(now())` becomes both the database default `now()` and the `now` generator on create, resolved from the column's codec, because Prisma 7's client filled the value itself on create and the database default covered writes from outside Prisma. A `now()` default on a column no `now` generator fills is refused, as Prisma 7 refuses it. The Postgres binding has no `updatedAtGenerator` of its own. Apart from the `now` generator that `@default(now())` adds, the contracts it builds from schemas Prisma 7 accepts are the ones it built before this decision. It refuses a client function whose arguments are out of range, fractional or named, and a column too short for what the generator writes.

### `contract print`

`contract print` writes no `types {}` block for aliases and names no alias on a column. It writes each generated column as its type followed by `@onCreate(fn(...))` and `@onUpdate(fn(...))`, using the reverse map from generator to function name and arguments that the registry provides. A generator that no function names is refused, as today. The preset print forms and their refusals are removed.

`contract print` does not write a contributed alias's name when a column matches its expansion. The contract does not record that the user wrote the alias, and the same column can be written with the attributes by hand. The expanded form is the one deterministic output.

## Consequences

- **Breaking for schemas.** Every preset call and every `@default(<client function>())` must be rewritten. `@updatedAt` keeps being refused in Prisma 8 PSL, with a hint that names `@onCreate(now()) @onUpdate(now())` and `temporal.UpdatedAt`.
- **Hashes.** Rewriting a preset or `@default(uuid())` as attributes changes no hash when the column and generators are the same. A contract with a `types {}` block or TypeScript `types` gets a new storage hash, because its columns lose `typeRef` and gain inline params. Supabase's space contract gets a new hash. pgvector's and PostGIS's do not.
- **Upgrade.** The upgrade instructions ship a script that rewrites stored contracts and migration snapshots into the expanded form and refreshes their hashes, as the removal of `@noCheck` did. Users then re-emit and run `db sign` against every database. The change has no operations; since ADR 309, `migration plan` writes such a migration with no operations, and `db migrate` applies it by moving the marker to the new hash. The instructions also give the PSL and TypeScript rewrites for presets.
- **Breaking for extension authors.** A default function can no longer lower to a client generator: `ControlMutationDefaultEntry.lower` returns a database default only. An extension that generated a value through a default function, such as `slugid()`, contributes a generator function with a binding for each codec it fills instead. `printArguments` and `applicableCodecIds` are removed; a binding declares the codecs it fills and how `contract print` writes each generator.
- **Diagnostics.** The `PSL_PRESET_*` diagnostics and the refusal of preset-only generators in `@default` are removed. `@default(uuid())` gets a refusal that names `@onCreate(uuid())`. (Amended 2026-10-22.) A preset call is `PSL_UNRESOLVED_REFERENCE` with its rewrite. Mongo's `PSL_PRESET_ON_VARIANT_FIELD` and `PSL_PRESET_CONFLICT`, which also fire for `@onCreate` and `@onUpdate`, are renamed `PSL_GENERATOR_ON_VARIANT_FIELD` and `PSL_GENERATOR_CONFLICT`.
- **Less code.** The `fieldPreset` descriptor kind, `instantiateAuthoringFieldPreset`, the `authoring.field` namespace, the `option`, `number` and `object` argument kinds, the `select` template node, the `path` and `default` of an argument reference, the PSL text parsers only those kinds used, the temporal preset builders, `field.generated(...)` with the `@internal/ids` spec helpers, and the preset print search are removed (amended 2026-10-22). Only the `value` argument kind is left. The language server loses its field-preset completion and hover branches.

## ADRs this changes

- **ADR 170** — its field-preset half is superseded: the preset examples, the preset parts of "Why we need this" and "What we are doing", "What can a preset do?" and "How this fits TS and PSL together". Type constructors, names, namespaces and short names stand.
- **ADR 246** — superseded. The `option` argument kind and the `select` template exist only for temporal presets and are removed. Its two omission rules (no empty `executionDefaults`, no empty `typeParams`) stand as canonicalization rules.
- **ADR 169 (Declared applicability for mutation default generators)** — §1 is amended: applicability is still keyed by codec id, but it is declared on the generator function entry, not on the generator. The §3 note and the `@default(uuid(7))` example are superseded by `@onCreate`.
- **ADR 158** — §1's "onUpdate is future work" is done; §3's compatibility check is the codec map above; §4's precedence now covers `@default` with `@onCreate` in PSL.
- **ADR 104** — "Named storage type for reuse" and "Enforceable coupling" are amended: a named type is expanded at authoring, and checks run on each expanded column.
- **ADR 241** — the grounding example's `storage.types` entry and `typeRef` are superseded by inline params.
- **ADR 208** — the parts that make a `storage.types` entry the unit of a shared codec instance (the `CodecInstanceContext` paragraph and "How it composes" §2 to §4) are amended as described under "Runtime codecs".
- **ADR 212 (AST-bound codec resolution)** — `codecRefForColumn` no longer resolves `typeRef` for user aliases.
- **ADR 231 and ADR 249** — `@default` lists only database functions; `@onCreate` and `@onUpdate` are new specs, and the construction context gains the generator function registry.
- **ADR 254** — "or field preset" in the assembly checks and the `storage.types` sentence in "Columns and type constructors" are amended.
- **ADR 269** — stands. Its example `updatedAt DateTime @default(now())` never changes after create; it should read `@onCreate(now()) @onUpdate(now())`.
- **Examples to update:** ADR 181 (TypeScript presets), ADR 226, ADR 244, ADR 257 and ADR 259 (`@default(uuid())` and preset examples).

## Alternatives considered

**Keep field presets.** Not chosen. A preset is a second way to write what attributes say, with its own argument vocabulary, and its author pairs codec and generator by hand, which is how a string codec got a `Date` generator. Aliases give the same reuse with one mechanism.

**Check compatibility by data type, and cast the generated value.** Not chosen. A generator returns an in-memory value that the codec encodes. Two codecs of one data type expect different values, a string and a `Temporal.PlainDateTime` for `timestamp`, so a data-type check accepts pairs the codec cannot encode, and a cast would hide the mismatch until a write.

**Keep aliases in the contract.** Not chosen. The contract would keep a name that exists only in the source, and the storage hash would change when a user renames an alias though the database does not change. Nothing in production reads the name, and the reason aliases were stored, no inline type parameters in PSL, no longer holds.

**Retire aliases and use mixins for reuse.** Not chosen. A mixin adds named fields to a model. An alias is a column type the user can give to a field of any name, in any model, and to a list or optional field. Both are useful, and neither covers the other.

**Keep `@updatedAt` as sugar in Prisma 8 PSL.** Not chosen. `@updatedAt` is one fixed pair of generators on a few codecs. `@onCreate(now()) @onUpdate(now())` says the same and extends to any phase and function, and `temporal.UpdatedAt` gives a short form. The Prisma 7 reader still reads `@updatedAt` from Prisma 7 schemas.

**Make `@default(fn())` choose database or client by the function.** Not chosen. That is today's behavior, and the reader of a schema cannot tell from `@default(uuid())` whether the database or the client writes the value.
