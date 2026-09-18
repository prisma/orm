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
- Interpret SQL timestamp semantics: `DateTime @default(now())` as a storage default, and `temporal.createdAt()` / `temporal.updatedAt()` as client-side execution mutation defaults
- Lower shared constructor expressions in both `types {}` blocks and inline field positions (for example `ShortName = sql.String(length: 35)` and `embedding pgvector.Vector(length: 1536)?`)
- Lower supported default functions through composed registry inputs
- Resolve Postgres native storage types from bare names and constructor calls in type position (`Char`, `VarChar`, `Numeric`, `Uuid`, `Inet`, `SmallInt`, `Real`, `Timestamp`, `Timestamptz`, `Date`, `Time`, `Timetz`, `Json`, `Jsonb`, `BigIntNumber`, `UnboundedInt`)
- Map PSL relation action tokens to SQL contract referential actions and emit diagnostics for unsupported values
- Emit deterministic relation metadata in `models.<Model>.relations`
- Enforce extension composition for namespaced constructor expressions and emit strict diagnostics for unsupported namespaced attributes
- Validate generator applicability by declared `codecId` support on composed generator descriptors
- Consume target-bound scalar descriptors, shared authoring contributions, and mutation-default registries assembled by composition layers
- Compose provider flow for SQL PSL-first config (`read -> parse -> interpret`) without local registry assembly
- Preserve parser diagnostics and add interpreter diagnostics with stable codes
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

- **Scalar and storage-oriented lists are rejected**:
  - Scalar lists like `String[]`
  - Enum lists and named-type lists
- **Relation navigation lists are supported** when they can be matched to an FK-side relation:
  - Example: `User.posts Post[]` + `Post.user User @relation(fields: [userId], references: [id])`
  - Matching may use `@relation("Name")` or `@relation(name: "Name")` when multiple candidates exist
  - Navigation list fields accept only `@relation` (name-only form); other field attributes are strict errors
- **Implicit Prisma ORM many-to-many remains unsupported** (list navigation on both sides without explicit join model)
  - Represent many-to-many with an explicit join model (two foreign keys)

Supported `@default(...)` surface in v1 when composed contributors provide handlers:

- Storage defaults: `autoincrement()`, `now()`, literals, `dbgenerated("...")`
- Raw SQL defaults as a tagged literal: a tag followed by a string literal, as in `` @default(sql`(now() + interval '7 days')`) `` or, for a body with backticks, `@default(sql"(now() + '00:03:00'::interval)")`. The string may use any quote style, and whitespace, newlines, or comments may sit between the tag and the string. A backtick string may span lines and resolves only `` \` `` and `\\`; `"` and `'` strings resolve the usual escapes. A backtick string is only valid after a tag; anywhere else it is `PSL_BACKTICK_STRING_REQUIRES_TAG`. A body that is exactly `now()` or `autoincrement()` (`` sql`now()` ``) is refused: write the named form, `@default(now())`. Any other body, including `NOW()` and `gen_random_uuid()`, is used as written. The body is canonicalized (line endings, a blank first and last line, common indentation) and used verbatim as the default expression. `sql` is registered by every SQL target; `pg.sql` (Postgres) and `sqlite.sql` (SQLite) are target-prefixed spellings of the same tag. An unregistered tag is `PSL_UNKNOWN_DEFAULT_LITERAL_TAG`, reported when the default is lowered.
- Execution defaults: `uuid()`, `uuid(4)`, `uuid(7)`, `cuid(2)`, `ulid()`, `nanoid()`, `nanoid(<2-255>)`
- Explicitly unsupported in v1: `cuid()` (diagnostic suggests `cuid(2)`)
- `dbgenerated("...")` preserves the parsed PSL string-literal contents as-is (escaped sequences are not normalized in v1).

Supported timestamp authoring surface:

- `createdAt DateTime @default(now())` lowers to the target storage default and does not create an execution mutation default.
- `createdAt temporal.createdAt()` generates a client-side timestamp on create, without a database default.
- `updatedAt temporal.updatedAt()` uses the same execution generator on create and on non-empty update mutations. Matching representations share one generated value per operation; updates leave `createdAt` unchanged. These semantics are application-side, not database triggers.
- The Prisma-flavored `@updatedAt` attribute is not supported; references produce `PSL_UNSUPPORTED_FIELD_ATTRIBUTE` with a migration hint pointing at `temporal.updatedAt()`. The hint is suppressed when the field already declares any `temporal.*` preset.
- `@createdAt` is not supported as a PSL alias.

Field-preset calls in type position:

- A field may use a registered field-preset call as its type (`createdAt temporal.createdAt()`). A preset is a complete field declaration — it carries its own codec, native type, and any default semantics.
- Preset-call fields reject the modifiers the preset already decides: `?` optional (`PSL_PRESET_NOT_OPTIONAL`), `@default(...)` (`PSL_PRESET_AND_DEFAULT_CONFLICT`), `@id` unless the preset contributes id semantics (`PSL_PRESET_AND_ID_CONFLICT`), and list use (`PSL_PRESET_NOT_LIST`).

Integer representation authoring surface:

- `BigInt` keeps the lossless `bigint` codec (`pg/int8@1` / `sqlite/bigint@1`): values read and write as JS `bigint`, and 64-bit integers travel through database-produced JSON as decimal text.
- Bare `BigIntNumber` (PostgreSQL and SQLite) opts an `int8`/INTEGER column into JS `number` reads and writes. Both directions throw structured errors outside ±(2^53 − 1) or on non-integral values: `RUNTIME.ENCODE_FAILED` on write, `RUNTIME.DECODE_FAILED` on read.
- Bare `UnboundedInt` (PostgreSQL only) reads and writes an unconstrained `numeric` as a JS `bigint`, exact at any magnitude; decode rejects non-integral values. SQLite declares no equivalent because it has no lossless unbounded integer storage.
- These are ordinary target-scoped types rather than field presets, so ordinary scalar modifiers apply subject to the target's capabilities.
- Selection guidance, canonical JSON forms, the safe-range soundness argument, and aggregate behavior: [Integer representation types](../../../../docs/reference/integer-representation-types.md).

`@@index` parameter surface:

```prisma
@@index([email], where: "(archived_at IS NULL)", name: "users_email_active")
@@index(expression: "eql_v3.eq_term(email)", name: "users_email_eq")
@@index(expression: "lower(email)", unique: true, name: "users_email_lower_key")
@@index([email], type: "hash", name: "users_email_hash")
```

- Exactly one of a fields list or `expression:` (the whole CREATE INDEX element list as one opaque string); violating this raises `PSL_INDEX_FIELDS_XOR_EXPRESSION`.
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
