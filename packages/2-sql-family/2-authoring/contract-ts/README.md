# @internal/sql-contract-ts

**Status:** Current SQL TypeScript contract authoring surface

This package owns the SQL TypeScript authoring API for Prisma 8.

## Package Classification

- **Domain**: sql
- **Layer**: authoring
- **Plane**: migration

## Overview

This package is part of the SQL family namespace (`packages/2-sql-family/2-authoring/contract-ts`) and provides:

- the SQL contract DSL centered on `defineContract(...)`
- the base structural helpers exported from `./contract-builder`: `field.column(...)`, `field.namedType(...)`, plus `model(...)` and `rel.*`
- an optional callback overload that exposes pack-composed helpers — the type constructors and type aliases on `type` (`type.Char(36)`, `type.Ulid()`, `type.temporal.CreatedAt()`), the generator function calls on `gen` (`gen.uuid(7)`), plus pack-contributed entity-type helpers at top level alongside the built-in `model` / `rel` (e.g. `enum({ name, values })`)
- lowering from authored model definitions into the canonical SQL `Contract`

## Responsibilities

- **SQL contract authoring**: Build SQL contracts programmatically with type safety
- **Pack-composed helper vocabulary**: Merge family, target, and extension authoring contributions into the callback helper namespaces
- **Lowering pipeline**: Turn authored model definitions into the canonical SQL contract artifacts consumed by the rest of the stack
- **Config helper**: Provide `typescriptContract(...)` for `prisma.config.ts`
- **Schema validation**: Contract JSON validation flows through the per-target descriptor SPI (`descriptor.contractSerializer.deserializeContract(json)`)

## Package Status

This is the current SQL TypeScript authoring implementation. Shared descriptor types live in `@internal/contract-authoring`. Contract validation flows through the per-target descriptor's `contractSerializer` SPI (e.g. `postgresTarget.contractSerializer.deserializeContract`), or via the canonical façade (`contractFromJson<Contract>(...)` from `@internal/postgres/static`).

## Architecture

- **Base DSL**: `./contract-builder` exports the stable structural DSL (`defineContract`, `field`, `model`, `rel`)
- **Composed helper namespaces**: `defineContract(config, (helpers) => ...)` synthesizes `helpers.field.*` and `helpers.type.*` from the selected family, target, and extension packs
- **SQL resolution and contract generation**: internal resolution normalizes names, relations, indexes, and FK materialization before producing the canonical SQL contract artifacts
- **Shared descriptor layer**: `@internal/contract-authoring` provides the target-neutral descriptor types used by the DSL and by authoring-adjacent packs

Contributor-facing lowering notes and detailed warning semantics live in [DEVELOPING.md](./DEVELOPING.md).

```mermaid
flowchart LR
  builderInput[TypeScript contract input] --> sqlContractTs[@internal/sql-contract-ts]
  sqlContractTs --> authoringCore[@internal/contract-authoring]
  sqlContractTs --> sqlTypes[@internal/sql-contract/types]
  sqlContractTs --> contract[SQL Contract]
```

## Exports

- `./contract-builder` - SQL contract DSL (`defineContract`, `field`, `model`, `rel`)
- `./config-types` - `typescriptContract(...)` config helper

## Usage

### Direct Structural DSL

Direct imports expose the base structural helpers. Use this surface when you want to author with explicit column descriptors.

Storage defaults are values passed to `.default(...)`: a literal, `now()`, `autoincrement()`, or raw SQL written with the `sql` template tag, such as `` .default(sql`gen_random_uuid()`) `` or `` .default(sql`(now() + interval '7 days')`) ``.

Values the client generates are set with `.onCreate(call)` and `.onUpdate(call)`, with a call from `gen`, such as `gen.now()`, `gen.uuid(7)` or `gen.nanoid(16)`. `gen` is built from the composed packs like the `type` helpers: it holds one call for each generator function the family, target and extension packs declare, typed by the function's signature, so each stack's `gen` holds exactly that stack's functions. The `defineContract` callback receives it, and each facade also exports a `gen` with its family and target functions. The call resolves by the field's codec and type params through the same generator functions when the contract is built, as `@onCreate(fn())` and `@onUpdate(fn())` resolve in PSL:

```ts
defineContract({ extensions: { slugid } }, ({ field, gen, model }) => ({
  models: {
    Post: model('Post', {
      fields: {
        id: field.column(textColumn).id().onCreate(gen.uuid(7)),
        slug: field.column(textColumn).onCreate(gen.slugid()),
        updatedAt: field.column(timestamptzColumn).default(now()).onCreate(gen.now()).onUpdate(gen.now()),
      },
    }),
  },
}));
```

`.onCreate(...)` makes the field optional in the create input; `.onUpdate(...)` alone does not. A generator on a list field, as in `.many().onCreate(gen.uuid())`, fails the build with `CONTRACT.DEFAULT_INVALID` (`reason: 'generator-on-list'`). A function that does not fill the codec fails the build with `CONTRACT.DEFAULT_INVALID` (`reason: 'generator-not-applicable'`), and setting a phase twice, or a phase a type alias or alias constant already sets, throws `CONTRACT.DEFAULT_INVALID` (`reason: 'generator-phase-set-twice'`).

A literal passed to `.default(value)` is a value of the input type of the field's codec, and TypeScript checks it: inside the `defineContract` factory, `field.column(type.String()).default(1)` is a type error. A list field takes an array of that type, and an enum field takes one of its member values. `now()`, `autoincrement()` and the `sql` tag are accepted on every field except an enum field, whose `.default()` takes only member values. Two cases are not typed from a codec and accept any value, which the codec checks when the contract is built: a codec id that no pack declares, and the directly imported `field` helper, which knows no packs. `.default({ kind: 'literal', value })` is not type-checked against the codec; the codec still checks the value when the contract is built. The codec's `toDataTypeValue` turns the value into a value of the column's data type, which constructs the form `contract.json` stores, and a value the codec refuses at build time fails with `CONTRACT.DEFAULT_INVALID`, naming the model and field. The Postgres and SQLite `defineContract` facades look up the target's built-in codecs and the codecs of `extensions` for this; pass `codecLookup` to use your own. When the lookup has no codec for a column's codec id, a literal default on that column fails with `CONTRACT.DEFAULT_INVALID`: list the pack that owns the codec in `extensions`. The lookups are required: a column's database type name is written from the data type its codec represents, so the facades also pass a `dataTypeLookup` built from the target and the listed extensions, and a column whose codec no listed pack provides fails with `CONTRACT.CODEC_DESCRIPTOR_MISSING`. A list field's default is an array, so call `.many()` before `.default()`. On Postgres, `field.column(type.DateTime())` takes a `Temporal.Instant`, `field.column(type.TimestamptzJsDate())` takes a `Date`, and `field.column(type.TimestamptzString())` takes an ISO 8601 string. On Node 24 a contract file that creates a `Temporal` value must load a `Temporal` implementation itself, for example `import 'temporal-polyfill/full/global'`; the CLI and the Vite plugin set no global `Temporal`. Encoding a `Temporal` default needs no other implementation than the one that made the value. The type check on a `Temporal` field needs the `Temporal` type declarations in the project, for example from `temporal-polyfill/global`; without them the parameter is unchecked.

```typescript
import { textColumn, timestamptzColumn } from '@internal/adapter-postgres/column-types';
import sqlFamily from '@internal/family-sql/pack';
import { defineContract, field, model, now, rel } from '@internal/sql-contract-ts/contract-builder';
import postgresPack from '@internal/target-postgres/pack';

const User = model('User', {
  fields: {
    id: field.column(textColumn).id(),
    email: field.column(textColumn).unique(),
    createdAt: field.column(timestamptzColumn).default(now()),
  },
})
  .relations({
    posts: rel.hasMany('Post', { by: 'userId' }),
  })
  .sql({
    table: 'app_user',
  });

const Post = model('Post', {
  fields: {
    id: field.column(textColumn).id(),
    userId: field.column(textColumn),
    title: field.column(textColumn),
  },
})
  .relations({
    user: rel.belongsTo(User, { from: 'userId', to: 'id' }),
  })
  .sql({
    table: 'blog_post',
  });

export const contract = defineContract({
  family: sqlFamily,
  target: postgresPack,
  naming: { tables: 'snake_case', columns: 'snake_case' },
  models: {
    User,
    Post,
  },
});
```

### Raw SQL: the `sql` tag

Every place that takes raw SQL takes a `sql` value, a `SqlExpression`: `.default()`, `constraints.index`'s `where` and `expression`, and `check`'s `expression`, plus the Postgres facade's `fullTextIndex` `where` and the `using` and `withCheck` of its `policy*` helpers. A string there does not compile. `sql` and the `SqlExpression` type are exported from this module's `contract-builder` entry and defined in `@internal/sql-contract/sql-expression`.

The tag reads the raw text of its template and canonicalizes it like PSL's `` sql`...` `` literal, so PSL and TypeScript store the same text: indentation shared by every line, blank lines at the start and end, whitespace-only lines and carriage returns are removed. It resolves three escapes, `` \` ``, `\\` and `\$`; every other backslash is kept, so `` sql`E'\n'` `` holds `E'\n'`. To put the two characters `${` in the text, write `\${`; PSL needs no escape there. Other `sql` values may be interpolated. Each line of an interpolated value after its first takes the indentation of the template line the `${…}` sits on, and the joined text is canonicalized once, so a multi-line value inside an indented template stores the same text as the PSL literal of the same SQL:

```typescript
const owner = sql`"userId"::uuid = auth.uid()`;
const ownerAlive = sql`${owner} AND "deletedAt" IS NULL`;
```

Anything else inside `${…}` is a type error, and `CONTRACT.SQL_EXPRESSION_INTERPOLATION` for JavaScript that is not type-checked. A text holding a NUL character or larger than 65536 bytes is `CONTRACT.SQL_EXPRESSION_INVALID`. The tag checks nothing else. `.default()` refuses `` sql`now()` `` and `` sql`autoincrement()` `` with `CONTRACT.DEFAULT_INVALID` (write `.default(now())` or `.default(autoincrement())`), and a text that holds `;`, a comment token, `$$` or `SELECT`, as PSL's `@default` does. `.defaultSql('...')` still works but is deprecated and is removed in 8.0.0.

### Callback Helper Vocabulary

Pack-provided helpers are available through the callback overload. This is the surface that exposes the `type.*` helpers, the `gen.*` calls, and extension helpers such as `type.pgvector.Vector(...)`. There are no field presets: `field.text()`, `field.id.*`, `field.temporal.*` and `field.generated(...)` were removed, and a field is written `field.column(type.String())`, with `.id()` and `.onCreate(gen.uuid())` where the preset set them. A read of a removed preset from the callback's `field`, such as `field.text` from a contract that was not type-checked, throws `CONTRACT.FIELD_HELPER_UNKNOWN`, with the preset's rewrite where the target has the type it writes.

`type.*` has a helper for every PSL type constructor of the stack, such as `type.VarChar(64)`, `type.TimestampString(3)` and `type.String()`, plus the type aliases the packs contribute, such as `type.temporal.CreatedAt()` and `type.temporal.UpdatedAt()`. Pass the result to `field.column(...)`. A type alias is a constant: field builders are immutable, so one constant serves every field and model that uses it, and each column stores the alias's codec and params inline. A constant may carry a default and generators, and a field may add what the constant does not set:

```typescript
const UpdatedAt = field.column(type.TimestampString(3)).onCreate(gen.now()).onUpdate(gen.now());

updatedAt: UpdatedAt.default(now()),
```

Setting a phase the constant already sets, as in `UpdatedAt.onUpdate(gen.now())`, throws `CONTRACT.DEFAULT_INVALID` with reason `generator-phase-set-twice`, and `.default()` on a builder that already has a default throws it with reason `default-set-twice`. A definition has no `types` key: it is refused with `CONTRACT.TYPES_KEY_REMOVED`. A contract space that registers a database type of its own, as pgvector registers `vector`, writes it under `databaseTypes`; no column refers to such an entry.

```typescript
import pgvector from '@internal/extension-pgvector/pack';
import sqlFamily from '@internal/family-sql/pack';
import { defineContract, enumType, member } from '@internal/sql-contract-ts/contract-builder';
import postgresPack from '@internal/target-postgres/pack';

const pgText = { codecId: 'pg/text@1' } as const;
const Role = enumType('role', pgText, member('USER', 'user'), member('ADMIN', 'admin'));

export const contract = defineContract(
  {
    family: sqlFamily,
    target: postgresPack,
    extensions: { pgvector },
  },
  ({ type, field, model, rel, gen }) => {
    const ShortName = field.column(type.VarChar(35));
    const Embedding1536 = field.column(type.pgvector.Vector(1536));

    const User = model('User', {
      fields: {
        id: field.column(type.Uuid()).id().onCreate(gen.uuid(7)).sql({ id: { name: 'user_pkey' } }),
        shortName: ShortName,
        role: field.namedType(Role),
        embedding: Embedding1536.optional(),
        createdAt: field.column(type.temporal.CreatedAt()),
        updatedAt: field.column(type.temporal.UpdatedAt()),
      },
    });

    const Post = model('Post', {
      fields: {
        id: field.column(type.Uuid()).id().onCreate(gen.uuid(7)),
        authorId: field.column(type.Uuid()),
        title: field.column(type.String()),
      },
    });

    return {
      enums: { role: Role },
      models: {
        User: User.relations({
          posts: rel.hasMany(Post, { by: 'authorId' }),
        }).sql({
          table: 'user',
        }),
        Post: Post.relations({
          author: rel.belongsTo(User, { from: 'authorId', to: 'id' }),
        }).sql({
          table: 'post',
        }),
      },
    };
  },
);
```

### Integer Representation Types

PostgreSQL and SQLite contribute `type.BigIntNumber()`, while PostgreSQL also contributes `type.UnboundedInt()`. Pass the result to `field.column(...)`, or keep it in a constant when several fields share it.

```typescript
import sqlFamily from '@internal/family-sql/pack';
import { defineContract } from '@internal/sql-contract-ts/contract-builder';
import { pgInt8NumberColumn, pgUnboundedIntColumn } from '@internal/target-postgres/codecs';
import postgresPack from '@internal/target-postgres/pack';

export const contract = defineContract(
  { family: sqlFamily, target: postgresPack },
  ({ field, model, type }) => {
    const BigIntNumber = field.column(type.BigIntNumber());

    return {
      models: {
        Meter: model('Meter', {
          fields: {
            peak: BigIntNumber,
            lifetime: field.column(type.UnboundedInt()),
            directPeak: field.column(pgInt8NumberColumn()),
            directLifetime: field.column(pgUnboundedIntColumn()),
          },
        }),
      },
    };
  },
);
```

The direct form imports the column helper: `field.column(pgInt8NumberColumn())` or `field.column(pgUnboundedIntColumn())` on PostgreSQL, and `field.column(sqliteBigintNumberColumn())` imported from `@internal/target-sqlite/codecs` on SQLite. Both forms select the same codecs and application types and store the same column.

### Constraint Placement

Single-field constraints are usually most readable inline on the field, while compound constraints live in `.attributes(...)` or model-level `.sql(...)`.

```typescript
const Membership = model('Membership', {
  fields: {
    orgId: field.column(textColumn).column('org_id'),
    userId: field.column(textColumn).column('user_id'),
    role: field.column(textColumn),
  },
})
  .attributes(({ fields, constraints }) => ({
    id: constraints.id([fields.orgId, fields.userId], { name: 'membership_pkey' }),
    uniques: [
      constraints.unique([fields.orgId, fields.role], {
        name: 'membership_org_role_key',
      }),
    ],
  }))
  .sql({ table: 'membership' });
```

### Indexes

`constraints.index` (inside model `.sql(...)` under `indexes: [...]`) has two forms:

```typescript
constraints.index([cols.email], { unique: true, where: sql`(archived_at IS NULL)`, name: 'users_email_active' })
constraints.index({ expression: sql`eql_v3.eq_term(email)`, name: 'users_email_eq' })
```

- **Fields form** — `constraints.index(cols | [cols...], options?)`. Options: `unique?`, `where?` (partial-index predicate, a `sql` value holding the WHERE body without the keyword), `name?` xor `map?`, and — when the target pack registers index types — `type?` paired with its `options?` (e.g. `type: 'hash', options: {}`). The pack-typed arm requires the `options` key at compile time; PSL accepts `type:` without `options:` (absent validates as `{}`) — both lower to the same IR.
- **Expression form** — `constraints.index({ expression, ...options })`. The expression is the whole CREATE INDEX element list as one `sql` value; `name` or `map` is required (no default name can be derived from an expression). Same remaining options as the fields form.

  The expression may instead be `{ fields, render }`, which defers rendering until lowering knows the storage column names: `fields` are `ColumnRef`s resolved exactly as the fields form resolves them — a `.column()` override first, then the contract's column naming convention — and `render` receives the resolved names in order and returns the element list as a string, because code generates it. Use this whenever the expression names a column, because neither the override nor the naming convention is knowable while the model is being authored; a `sql` value written by hand silently stops matching the column it names when either changes. Lowering canonicalizes the rendered string as a `sql` literal's text is canonicalized, and that text reaches the IR, so nothing downstream sees a new shape.

  `options` may likewise be a function of the storage columns the index covers, for options that name columns: lowering resolves the index's `fields` (or the `fields` of a deferred expression) the same way and calls the function with them, in order, and the options it returns are what reaches the IR. The Postgres facade's `fullTextIndex([[cols.title, cols.subtitle], cols.body], { name })` is built this way: it stores the weight groups as storage column names in the options of an index of the Postgres type `fullText`.

`name:` declares a **wire-named** index: the physical name is `<name>_<8-hex content hash>`, and renames plan as `ALTER INDEX … RENAME`. `map:` adopts an **exact** physical name verbatim (no hash) — intended for objects captured by `contract infer`. Combining `map:` with a SQL body (`expression`/`where`, or an index type whose body the target renders from its options, such as Postgres's `fullText`) emits the `PN_EXACT_NAME_BODY_COMPARISON` warning at build time: drift detection byte-compares the authored text against Postgres's reprinted form, which is only reliable for infer-captured text. Prefer `name:` for hand-authored bodies.

### Helper Notes

- Structural helpers: `field.column(...)`, `field.namedType(...)` (an enum handle only), plus `model(...)` and `rel.*`
- Callback helpers: `type.*` and `gen.*`, as in `field.column(type.UuidString()).id().onCreate(gen.uuid())` or, on Postgres, `field.column(type.Uuid()).id().onCreate(gen.uuid(7))`, which emits `pg/uuid@1`
- Integer representation types: `field.column(type.BigIntNumber())` / `field.column(type.UnboundedInt())`, or the direct per-codec column helpers with `field.column(...)`. `BigIntNumber` emits `pg/int8number@1` on PostgreSQL or `sqlite/bigintnumber@1` on SQLite and throws outside ±(2^53 − 1); PostgreSQL-only `UnboundedInt` emits `pg/unboundedint@1` and reads and writes exact `bigint` values. `type.BigInt()` keeps the lossless `pg/int8@1`. See [Integer Representation Types](#integer-representation-types) for the TypeScript forms and [Integer representation types](../../../../docs/reference/integer-representation-types.md) for the canonical selection, runtime, JSON, and aggregate behavior reference.
- Timestamp aliases mirror PSL: `field.column(type.temporal.CreatedAt())` generates a client-side timestamp on create, while `field.column(type.temporal.UpdatedAt())` uses the same execution generator on create and non-empty update mutations. Neither creates a database default; matching representations share one generated value per operation.
- Keep field-local and FK-local storage overrides next to the authoring site with `field.sql(...)` and `rel.belongsTo(...).sql({ fk })`
- Prefer typed local refs such as `field.namedType(Role)`, `User.refs.id`, and `User.ref('id')` when those tokens are available
- See [API.md](./API.md) for validation rules and typed-reference warning behavior

### Foreign Key Defaults

Use the root-level `foreignKeyDefaults` option when a contract wants non-default FK materialization:

```typescript
const contract = defineContract({
  family: sqlFamily,
  target: postgresPack,
  foreignKeyDefaults: { constraint: true, index: false },
  models: {
    // ...
  },
});
```

Per-FK overrides still live next to the FK authoring site, either via `constraints.foreignKey(...)` inside model `.sql(...)` or via `rel.belongsTo(...).sql({ fk: ... })`. A relation gets its own backing index unless its foreign key says `index: false`. `index: '<name>'` uses an index, unique constraint or primary key the table declares instead: the name is the `name` or `map` it was given, or an index's stored name, and its first columns must be the foreign key's columns in order.

```typescript
constraints.foreignKey(cols.authorId, User.refs.id, { index: 'post_author_live' })
```

The emitted foreign key states what backs it in `index`: `{ name }` for an index, `{ primaryKey: true }` for the primary key, `{ unique: [columns] }` for a unique constraint by its columns, or nothing for `index: false`. The build drops an index identical to another (the planner's equality, so `type: 'btree'` equals no type), keeping the one with a `name` or `map`, and drops an unnamed plain index on the columns of a key; it warns with `PN_INDEX_DUPLICATE` or `PN_INDEX_REDUNDANT` about named indexes it keeps. See [ADR 161](../../../../docs/architecture%20docs/adrs/ADR%20161%20-%20Explicit%20foreign%20key%20constraint%20and%20index%20configuration.md).

A contract definition's table nodes (`tables`) declare columns and tables no model maps. When a table node adds a required column with no default to a table a model maps, the build warns with `PN_COLUMN_REQUIRED_UNMAPPED`: the ORM writes only the columns fields map, so every insert it makes into that table fails.

### Validating Contracts

Contract JSON validation flows through the per-target descriptor's `contractSerializer` SPI; this package focuses on authoring and lowering. End-user app code typically goes through the canonical façade: `contractFromJson<Contract>(...)` validates the emitted JSON once, through the descriptor SPI, and the client takes the result. A contract this package builds with `defineContract` is already a typed value and goes to the client directly.

```typescript
import postgres from '@internal/postgres/runtime';
import { contractFromJson } from '@internal/postgres/static';
import contractJson from './contract.json' with { type: 'json' };
import type { Contract } from './contract.d';

const db = postgres({
  contract: contractFromJson<Contract>(contractJson),
  url: process.env['DATABASE_URL']!,
});
```

For advanced consumers that need direct access to the SPI:

```typescript
import postgresTarget from '@internal/target-postgres/control';
import type { Contract } from './contract.d';

const contract = postgresTarget.contractSerializer.deserializeContract(
  contractJson,
) as Contract;
```

### Config Helper

Use `typescriptContract` from this package when wiring TS-authored contracts in `prisma.config.ts`.

```typescript
import { defineConfig } from '@internal/cli/config-types';
import { typescriptContract } from '@internal/sql-contract-ts/config-types';
import { contract } from './src/prisma/contract';

export default defineConfig({
  contract: typescriptContract(contract, 'src/prisma/contract.json'),
});
```

Optional third argument (options bag) for `typescriptContract` / `typescriptContractFromPath`, and `defaultControlPolicy` on `emptyContract`. Stamping a specifier default strips derived checks from tables the policy leaves non-managed, and the strip rebuilds namespaces through the target's factory, so the bag requires `createNamespace` alongside `defaultControlPolicy` — the same factory the PSL specifier takes:

```typescript
import { postgresCreateNamespace } from '@internal/target-postgres/types';

typescriptContract(contract, 'src/prisma/contract.json', {
  defaultControlPolicy: 'external',
  createNamespace: postgresCreateNamespace,
});
```

The specifier value applies only when the loaded contract omits `defaultControlPolicy` (a value authored on the contract module wins).

## Editor JSON schema

`schemas/data-contract-sql-v1.json` is an editor-facing JSON schema for emitted SQL `contract.json` files (reference it via a `$schema` key or an IDE schema mapping). It is generated from the authoritative arktype schemas in `@internal/sql-contract` — never edit it by hand. Regenerate with `pnpm schemas:generate` in this package; a drift test (`test/data-contract-json-schema.test.ts`) fails when the checked-in file and the generator output diverge. Constraints JSON schema cannot express (narrow predicates, pack-contributed namespace entry kinds) are rendered permissively; arktype validation stays authoritative.

## Testing

Unit tests for the authoring DSL live in this package. Broader integration tests that span authoring, emission, CLI, and runtime packages live in `integration-tests`.

## Migration Notes

- Direct imports give you the structural DSL
- The callback overload gives you pack-composed helper vocabularies
- Import authoring helpers directly from `@internal/sql-contract-ts`
- Reach contract validation through the per-target descriptor's `contractSerializer.deserializeContract(...)` (or via the canonical façade)

## See Also

- `@internal/contract-authoring` - Shared target-neutral authoring descriptor types
- `@internal/sql-contract-psl` - PSL parser-output to SQL contract interpreter
- `@internal/sql-contract-psl/provider` - SQL PSL-first `prismaContract()` helper
