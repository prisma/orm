# @internal/sql-contract-psl

PSL-first SQL contract interpretation for Prisma 8.

## Overview

`@internal/sql-contract-psl` provides two entrypoints:

- **Pure interpreter** (`@internal/sql-contract-psl`): parsed PSL document -> SQL `Contract`
- **Provider helper** (`@internal/sql-contract-psl/provider`): read file -> parse -> interpret -> `ContractConfig`

This keeps core/CLI source-agnostic while giving PSL-first SQL users a one-line config helper.

## Responsibilities

- Interpret a PSL `SymbolTable` into SQL `Contract`
- Interpret generic PSL attributes into SQL contract semantics (`@id`, `@unique`, `@default`, `@relation`, `@map`, `@@map`, `@@control`)
- Interpret SQL timestamp semantics: `DateTime @default(now())` as a storage default, and `temporal.CreatedAt` / `temporal.UpdatedAt` as client-side execution mutation defaults
- Lower shared constructor expressions in both `types {}` blocks and inline field positions (for example `ShortName = sql.String(length: 35)` and `embedding pgvector.Vector(length: 1536)?`)
- Lower supported default functions through composed registry inputs
- Resolve Postgres native storage types from bare names and constructor calls in type position (`Char`, `VarChar`, `Numeric`, `Uuid`, `Inet`, `SmallInt`, `Real`, `TimestampTemporal`, `TimestamptzTemporal`, `Date`, `DateTemporal`, `Time`, `TimeTemporal`, `Timetz`, `IntervalParts`, `Bit`, `VarBit`, `Json`, `Jsonb`, `BigIntNumber`, `UnboundedInt`)
- Map PSL relation action tokens to SQL contract referential actions and emit diagnostics for unsupported values
- Emit deterministic relation metadata in `models.<Model>.relations`
- Enforce extension composition for namespaced constructor expressions and emit strict diagnostics for unsupported namespaced attributes
- Resolve `@onCreate(...)` and `@onUpdate(...)` calls through the stack's generator function registry, by the column's codec
- Consume target-bound scalar descriptors, shared authoring contributions, and mutation-default registries assembled by composition layers
- Compose provider flow for SQL PSL-first config (`read -> parse -> interpret`) without local registry assembly
- Preserve parser diagnostics and add interpreter diagnostics with stable codes
- Describe unresolved type names for the binder: `describeUnresolvedSqlType` (exported from `./diagnostics`), which the SQL family contributes as its `pslDiagnostics.describeUnresolvedType`, gives the rewrite of a call to a removed field preset (see Removed field presets), names a field typed `Unsupported("x")` as no Prisma 8 type and says to write the column's type with a type constructor, or as ``Raw(sql`x`)`` when no type constructor names it, or, if `x` comes from a database extension that has a Prisma 8 pack, to add the pack to `extensions` in `prisma.config.ts`; a bare name that a contributed namespace holds adds the qualified name to the binder's message, as in `Cannot find type "Ulid". Did you mean sql.Ulid?`; any other unknown name keeps the binder's `Cannot find type` message
- Return `notOk` with structured diagnostics for unsupported constructs
- Keep interpretation deterministic for equivalent AST inputs

Determinism note:
- Relation metadata emission is intentionally **sorted by storage table name, then model name, then relation field name** (not PSL declaration order) so `contract.json` snapshots and hashes are stable across environments.

## Non-responsibilities

- Canonical artifact emission (`contract.json`, `contract.d.ts`) and hashing
- CLI or ControlClient orchestration

The **pure interpreter entrypoint** specifically excludes:
- File I/O (`schema.prisma` reading)
- PSL parsing (`parse` + `buildSymbolTable`)
- Artifact emission (`contract.json`, `contract.d.ts`) and hashing
- CLI or ControlClient orchestration

Current scope is SQL target-specific: callers pass scalar descriptors and target context assembled for the active SQL target.

Unsupported PSL constructs in v1 (strict errors):

- **Scalar lists need the target's `scalarList` capability.** `String[]`, `Int[]` and enum lists such as `Role[]` lower to native array columns when the adapter reports `scalarList` (Postgres). On a target that does not (SQLite) they are `PSL_SCALAR_LIST_UNSUPPORTED_TARGET`.
- **Value-object fields need the stack's value-object storage type.** A field typed by a composite type is stored in one column of the storage type the adapter declares (`Jsonb` on Postgres, `Json` on SQLite), a list of value objects included. On a stack that declares none, each such field is `PSL_UNSUPPORTED_FIELD_TYPE`.
- **Composite types take no attributes.** An attribute on a member, such as `street String @default("x")`, is `PSL_UNSUPPORTED_FIELD_ATTRIBUTE`, and a block attribute on the type, such as `@@map`, is `PSL_UNSUPPORTED_COMPOSITE_TYPE_ATTRIBUTE`. A default for a value object is written on the model field, as a whole value.
- **Relation navigation lists are supported** when they can be matched to an FK-side relation:
  - Example: `User.posts Post[]` + `Post.user User @relation(fields: [userId], references: [id])`
  - Matching may use `@relation("Name")` or `@relation(name: "Name")` when multiple candidates exist
  - Navigation list fields accept only `@relation` (name-only form); other field attributes are strict errors
- **Implicit Prisma ORM many-to-many remains unsupported** (list navigation on both sides without explicit join model)
  - Represent many-to-many with an explicit join model (two foreign keys)

Supported `@default(...)` surface in v1 when composed contributors provide handlers:

- Storage defaults: `autoincrement()`, `now()`, literals, and raw SQL as a `sql` tagged literal
- Every written default has a data type of its own, decided by what is written rather than by the column: a quoted string, `true`/`false`, a number whose type comes from its own size and precision, and a JSON document written `` @default(json`{ "plan": "free" }`) ``. The column's type takes the value when it is that type or declares a cast from it, so `Int @default(100000000000000099)` is refused before anything is decoded: `PSL_VALUE_TYPE_INCOMPATIBLE`, which leads with what to write and names the types only because the value is a number the column cannot hold: `Expected a number that pg/int4 can hold; got pg/int8`. A value the type's own reader or a cast refuses, such as the text of a `json` literal that is not a JSON document, is `PSL_INVALID_LITERAL`. A value the column's codec refuses — a `pgvector.Vector(3)` given two elements — is `PSL_INVALID_DEFAULT_LITERAL`, and a single value on a list column is `PSL_DEFAULT_LIST_EXPECTED`. A column whose data type has no written form of its own and no cast into it takes only a `` sql`...` `` default. See [ADR 254](../../../../docs/architecture%20docs/adrs/ADR%20254%20-%20Data%20types%20and%20casts.md).
- Raw SQL defaults as a tagged literal: a tag followed by a string literal, as in `` @default(sql`(now() + interval '7 days')`) `` or, for a body with backticks, `@default(sql"(now() + '00:03:00'::interval)")`. The string may use any quote style, and whitespace, newlines, or comments may sit between the tag and the string. A backtick string may span lines and resolves only `` \` `` and `\\`, so `${` is ordinary text and needs no escape; `"` and `'` strings resolve the usual escapes. A backtick string is only valid after a tag; anywhere else it is `PSL_BACKTICK_STRING_REQUIRES_TAG`. The body written between the quotes is canonicalized (line endings, blank lines at the start and end, common indentation) into the text, which is used verbatim as the default expression. A text that is exactly `now()` or `autoincrement()` (`` sql`now()` ``) is refused: write the named form, `@default(now())`. Any other text, including `NOW()` and `gen_random_uuid()`, is used as written. `sql` is the tag of the data type `sql/expression`, which the SQL family defines and registers. There are no target-prefixed tags: `pg.sql` and `sqlite.sql` are unknown. An unregistered tag is `PSL_UNKNOWN_LITERAL_TAG`, reported at the literal.
- A list of value objects is stored in one column, whose value is the list. Its default is a list literal of the column type's values or one value of that type, and both give the same default: `homes Address[] @default([])` and `` @default(json`[]`) ``, or `` @default([json`{"street": "x"}`]) `` and `` @default(json`[{"street": "x"}]`) ``. A list literal on a single value object is `PSL_VALUE_TYPE_INCOMPATIBLE`.
- A literal default on a value-object field must match its composite type: a JSON object for a single value object and a JSON array of them for a list (or JSON `null` when the field is optional), with no key that is not a member, a value for every member that is not optional, and nested value objects checked the same way. The default holds each member in the stored form its codec writes, so each scalar member's codec must read the member's value: a `Decimal` or `BigInt` member takes a decimal string such as `"1.5"`, and a `Json` member takes any JSON value. A shape mismatch is `PSL_VALUE_TYPE_INCOMPATIBLE` and a value the member's codec refuses is `PSL_INVALID_DEFAULT_LITERAL`, each naming the path, as in `Field "User.home.street"`. A member typed by an enum takes only the enum's values, in the form its codec stores them; another value is `PSL_INVALID_DEFAULT_LITERAL`, `Expected one of:` the values.
- A list column takes storage defaults: a list literal, `now()`, or `` sql`...` `` (`` tags String[] @default(sql`'{}'::text[]`) ``). Whether the expression returns a value of the column's type is the author's responsibility; the database reports a mismatch. `autoincrement()` on a list column is `PSL_LIST_AUTOINCREMENT_UNSUPPORTED`, and an execution default such as `uuid()` is `PSL_LIST_EXECUTION_DEFAULT_UNSUPPORTED`. See [ADR 129](../../../../docs/architecture%20docs/adrs/ADR%20129%20-%20Template-Tagged%20Literals%20for%20Extensions.md).
- Generator function arguments: `uuid()`, `uuid(4)`, `uuid(7)`, `cuid(2)`, `nanoid()`, `nanoid(<2-255>)`. The target declares these three signatures (`sqlIntegerArgumentGeneratorFunctions` in `@internal/family-sql/pack`), since each argument is a value of its integer type (`pg/int4`, `sqlite/integer`), read like a default, then checked by the function: `uuid: version must be 4 or 7, got <n>`, `cuid: version must be 2, got <n>`, `nanoid: size must be between 2 and 255, got <n>`, each `PSL_INVALID_GENERATOR_ARGUMENT` at the argument. An argument the integer type does not take, such as `nanoid(8.5)`, is `PSL_VALUE_TYPE_INCOMPATIBLE`. A missing or extra argument names the callee `Generator function "<name>"`, as in `Generator function "cuid" is missing required argument "version"`.
- A registered default function's or generator function's `signature` is a `FuncCallSig`, or a function of the stack's data types that returns one; `defaultFunctionCall` (exported from `./attribute-specs`) and `generatorFunctionCall` (from `@internal/psl-parser`) build the call either way.
- `@default(dbgenerated("..."))` is not a default function. A call by that name is `PSL_UNKNOWN_DEFAULT_FUNCTION` with a message that names the `sql` tagged literal that replaces it and the supported functions.

Polymorphism:

- `@@discriminator(field)` takes a field stored in one of the stack's text data types (`textDataTypes` in the authoring contributions): on Postgres `String`, `Char(n)` and `VarChar(n)`; on SQLite `String`, `sql.String(n)` (character varying) and `sql.Char(n)` (character). The field must also be required and hold one value. The framework's discriminator rule decides this, applied through `applyDiscriminatorRule`, as in MongoDB PSL; a refused field is `PSL_INVALID_ATTRIBUTE_ARGUMENT` at the `@@discriminator`, as in `must be text, such as String` or `must be required, but it is optional`.
- `@@base(Model, "value")` takes a quoted string, read into the discriminator column's codec with `readWrittenValueIntoCodec`: cast into its data type and checked by its codec, so a Postgres `VarChar(5)` discriminator refuses `"circle"` with `PSL_VALUE_REFUSED`; SQLite does not limit a `sql.String(n)` value's length. When an enum types the discriminator, a value that is not one of its members is `PSL_INVALID_ATTRIBUTE_ARGUMENT` at the value. The variant is keyed by the value as the column stores it, and two variants with the same stored value are `PSL_DUPLICATE_DISCRIMINATOR_VALUE`.

Supported timestamp authoring surface:

- `createdAt DateTime @default(now())` lowers to the target storage default and does not create an execution mutation default.
- `createdAt temporal.CreatedAt` generates a client-side timestamp on create, without a database default.
- `updatedAt temporal.UpdatedAt` uses the same execution generator on create and on non-empty update mutations. Matching representations share one generated value per operation; updates leave `createdAt` unchanged. These semantics are application-side, not database triggers.
- The Prisma-flavored `@updatedAt` attribute is not supported; references produce `PSL_UNSUPPORTED_FIELD_ATTRIBUTE` with the hint `Use @onCreate(now()) @onUpdate(now()), or type the field temporal.UpdatedAt.` The hint is left out when the field already writes `@onUpdate`.
- `@createdAt` is not supported as a PSL alias.

Removed field presets:

- A call to a field preset Prisma 8 removed, such as `createdAt temporal.createdAt()` or `id id.uuidv4String()`, is refused with `PSL_UNRESOLVED_REFERENCE`, and the message gives the exact rewrite: `id.uuidv4String() was a field preset, and Prisma 8 removed field presets. Write UuidString @id @onCreate(uuid()).` The table of removed presets is `src/removed-field-presets.ts`; a row applies only on a target whose rewrite type stores the preset's codec. An identifier preset has two rows, so the rewrite writes the target's top-level alias, such as `UuidString` on Postgres, and the `sql.` alias, such as `sql.UuidString`, on a target without one. The lookup and the message are `describeRemovedFieldPreset` in `@internal/psl-parser/interpret`, which the MongoDB family's table uses too.

Generated values:

- `@default(...)` sets a database default only: a literal, a tagged literal, `now()` or `autoincrement()`. A function the client generates in `@default`, such as `@default(uuid())`, is refused with `PSL_GENERATOR_IN_DEFAULT`, whose message names the `@onCreate` form.
- `@onCreate(fn())` and `@onUpdate(fn())` set the generator the client runs on create and on every update. `fn` is one of the generator functions the stack binds to the field's codec: `now()` on every date and time type, and `uuid()`, `uuid(7)`, `cuid(2)`, `ulid()`, `nanoid()`, `nanoid(n)` and `ksuid()` on every text type (`uuid` also on `Uuid`). The spec of each attribute offers only the functions bound to the field's codec, and the call resolves through `generatorFunctions` with the column's codec and type params: `now()` on a `Time(3)` column takes `precision: 3`. `nanoid()` writes 21 characters, or the size the call gives, on every column. A generator is refused on a column shorter than what it writes (`uuid` 36, `ksuid` 27, `ulid` 26, `cuid` 24), with the column's length read in its type's normal form, so a bare `Char` holds 1; SQLite does not limit the length. A function that does not apply is `PSL_GENERATOR_NOT_APPLICABLE`, an unknown one `PSL_UNKNOWN_GENERATOR_FUNCTION`, either attribute on a list field `PSL_LIST_EXECUTION_DEFAULT_UNSUPPORTED`, and the same attribute twice on one field `PSL_DUPLICATE_ATTRIBUTE`.
- `@default(now()) @onCreate(now())` on one column keeps both: the client writes its time on create and the database default fills other inserts. `@onUpdate(...)` alone is allowed.
- A generator works on an optional field, such as `token String? @onCreate(uuid())`. On create and update, a value left out is generated and an explicit `null` is stored.

Type aliases:

```prisma
types {
  Slug      = VarChar(64)
  UpdatedAt = TimestampString(3) @onCreate(now()) @onUpdate(now())
}

model Post {
  id        String             @id @onCreate(uuid())
  slug      Slug
  createdAt temporal.CreatedAt
  updatedAt UpdatedAt          @default(now())
}
```

- A `types {}` alias is authoring shorthand. The interpreter expands it into each field typed by it: the column stores the alias's codec and type params inline, and the contract stores neither the alias nor a `typeRef`.
- An alias's base is a type constructor, called or bare, or an enum. It may not name another alias or a contributed alias (`PSL_UNSUPPORTED_NAMED_TYPE_BASE`).
- An alias may carry `@default`, `@onCreate` and `@onUpdate`. They are lowered once, at the declaration, so a diagnostic is reported once, on the alias. Every field typed by the alias takes them. `@id` and `@unique` on an alias are `PSL_UNSUPPORTED_NAMED_TYPE_ATTRIBUTE`, because they belong to a model's field, not to its type; write them on the field. A refused attribute is dropped and the alias is kept.
- A field may add any attribute its alias does not set, including `@id` and `@unique`. A field that writes an attribute its alias already sets is `PSL_DUPLICATE_ATTRIBUTE`, naming the alias. A list field typed by an alias that generates a value is `PSL_LIST_EXECUTION_DEFAULT_UNSUPPORTED`; an optional field may use one.
- The targets contribute aliases with no arguments, written bare: `temporal.CreatedAt` (`now()` on create) and `temporal.UpdatedAt` (`now()` on create and on update). On Postgres they are `TimestamptzTemporal`, with `temporal.CreatedAtString` / `temporal.UpdatedAtString` on `TimestamptzString` and `temporal.CreatedAtJsDate` / `temporal.UpdatedAtJsDate` on `TimestamptzJsDate`; on SQLite they are `DateTime`. Each stores what the matching `temporal.createdAt()` or `temporal.updatedAt()` preset stores. `temporal.CreatedAt(3)` is `PSL_INVALID_ATTRIBUTE_ARGUMENT`; write a precision with the attributes, as in `TimestamptzTemporal(3) @onCreate(now())`.

Integer representation authoring surface:

- `BigInt` keeps the lossless `bigint` codec (`pg/int8@1` / `sqlite/bigint@1`): values read and write as JS `bigint`, and 64-bit integers travel through database-produced JSON as decimal text.
- Bare `BigIntNumber` (PostgreSQL and SQLite) opts an `int8`/INTEGER column into JS `number` reads and writes. Both directions throw structured errors outside ±(2^53 − 1) or on non-integral values: `RUNTIME.ENCODE_FAILED` on write, `RUNTIME.DECODE_FAILED` on read.
- Bare `UnboundedInt` (PostgreSQL only) reads and writes an unconstrained `numeric` as a JS `bigint`, exact at any magnitude; decode rejects non-integral values. SQLite declares no equivalent because it has no lossless unbounded integer storage.
- These are ordinary target-scoped types, so ordinary scalar modifiers apply subject to the target's capabilities.
- Selection guidance, canonical JSON forms, the safe-range soundness argument, and aggregate behavior: [Integer representation types](../../../../docs/reference/integer-representation-types.md).

`@@index` parameter surface:

```prisma
@@index([email], where: sql`(archived_at IS NULL)`, name: "users_email_active")
@@index(expression: sql`eql_v3.eq_term(email)`, name: "users_email_eq")
@@index(expression: sql`lower(email)`, unique: true, name: "users_email_lower_key")
@@index([email], type: "hash", name: "users_email_hash")
@@check(expression: sql`length(email) > 3`, name: "users_email_length")
```

- Every argument that holds raw SQL takes a `sql` literal and nothing else: `@@index(where:)`, `@@index(expression:)`, `@@check(expression:)`, and on Postgres `@@fullTextIndex(where:)` and a policy's `using` and `withCheck`. Each receives the data type `sql/expression`, which casts from nothing, so a plain string is `PSL_VALUE_TYPE_INCOMPATIBLE` with the rewrite, ``Expected sql`...`; write sql`(archived_at IS NULL)` ``. A number, a boolean or another tag is refused the same way, and an identifier is `PSL_INVALID_ATTRIBUTE_SYNTAX`. The literal's canonical text is stored. See [ADR 268](../../../../docs/architecture%20docs/adrs/ADR%20268%20-%20Raw%20SQL%20is%20a%20value%20of%20the%20data%20type%20sql-expression.md).
- Exactly one of a fields list or `expression:` (the whole CREATE INDEX element list as one opaque SQL text); violating this raises `PSL_INDEX_FIELDS_XOR_EXPRESSION`.
- `expression:` requires `name:` or `map:` (`PSL_INDEX_EXPRESSION_REQUIRES_NAME` — no default name can be derived from an expression); at most one of `name:`/`map:` (`PSL_INDEX_NAME_XOR_MAP`).
- `name:` declares a wire-named index — the physical name is `<name>_<8-hex content hash>` and renames plan as `ALTER INDEX … RENAME`. `map:` adopts an exact physical name verbatim, intended for objects captured by `contract infer`.
- `where:` is a partial-index predicate (WHERE body, without the keyword); `unique:` a boolean; `type:` plus `options:` select a target-registered index access method (e.g. `type: "hash"`). Unlike the TS builder (whose pack-typed arm requires the `options` key at compile time), PSL accepts `type:` without `options:` — absent options validate as `{}` and lower to the same IR.
- `map:` combined with a SQL body (`expression:`/`where:`) emits the `PN_EXACT_NAME_BODY_COMPARISON` warning: drift detection byte-compares the authored text against Postgres's reprinted form, which is only reliable for infer-captured text — prefer `name:` for hand-authored bodies.

Model-level control policy:

- `@@control(<policy>)` lowers to the storage table's `control` field. The argument is one positional lowercase literal: `managed`, `tolerated`, `external`, or `observed`. Omit `@@control` to leave per-table control unset (the framework default applies at runtime).

Contract-level default (specifier options bag):

- `defaultControlPolicy` on `prismaContract(...)` sets `Contract.defaultControlPolicy` at load time when the interpreted contract does not already define one (source wins when both are present).

## Public API

- `@internal/sql-contract-psl`
  - `interpretPslDocumentToSqlContract({ symbolTable, sourceFile, sourceId, target, scalarColumnDescriptors, composedExtensionContracts, seedDiagnostics?, authoringContributions?, controlMutationDefaults?, composedExtensions? })` — build `symbolTable`/`sourceFile` via `parse(schema)` + `buildSymbolTable(...)` from `@internal/psl-parser`.
- `@internal/sql-contract-psl/provider`
  - `prismaContract(schemaPath, { output?, target, createNamespace, composedExtensionPackRefs?, defaultControlPolicy?, enumInferenceCodecs? })` — scalar column descriptors are derived from the composed stack's authoring type namespace at load time.
  - Provider input is fully preassembled by composition layers (for example `@internal/family-sql/control` helpers).
- `@internal/sql-contract-psl/map-names`
  - `pslModelMapName(modelName, tableName)` and `pslFieldMapName(fieldName, columnName)` — the `@@map` or `@map` name a model or field must carry to read back with that table or column name, or `undefined` when the name this source derives already matches. Code that writes PSL uses them to decide when to write the attribute.

- `@internal/sql-contract-psl/test`
  - `sqlContextInput(context)` — maps a `ContractSourceContext` to the context fields of `interpretPslDocumentToSqlContract`'s input. Tests combine it with `bindPslSchema` from `@internal/psl-parser/test`. Not part of the published shells.

## Architecture

```mermaid
flowchart LR
  config[prisma.config.ts] --> providerHelper[@internal/sql-contract-psl/provider]
  providerHelper --> fsRead[read schema.prisma]
  fsRead --> parse[parse]
  parse --> parsed[DocumentAst + SourceFile + parser diagnostics]
  parsed --> symbols[buildSymbolTable]
  providerHelper --> descriptors[pslBlockDescriptors]
  descriptors --> symbols
  symbols --> symbolTable[SymbolTable + symbol-table diagnostics]
  symbolTable --> interpreter[@internal/sql-contract-psl]
  interpreter --> irResult[Result_Contract_Diagnostics]
  irResult --> emit[Framework emit pipeline]
```

## Related Docs

- `docs/Architecture Overview.md`
- `docs/architecture docs/subsystems/1. Data Contract.md`
- `docs/architecture docs/subsystems/2. Contract Emitter & Types.md`
- `docs/architecture docs/adrs/ADR 006 - Dual Authoring Modes.md`
- `docs/architecture docs/adrs/ADR 163 - Provider-invoked source interpretation packages.md`
