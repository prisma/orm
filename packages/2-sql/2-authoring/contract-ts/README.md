# @internal/sql-contract-ts

**Status:** Current SQL TypeScript contract authoring surface

This package owns the SQL TypeScript authoring API for Prisma Next.

## Package Classification

- **Domain**: sql
- **Layer**: authoring
- **Plane**: migration

## Overview

This package is part of the SQL family namespace (`packages/2-sql/2-authoring/contract-ts`) and provides:

- the SQL contract DSL centered on `defineContract(...)`
- the base structural helpers exported from `./contract-builder`: `field.column(...)`, `field.generated(...)`, `field.namedType(...)`, plus `model(...)` and `rel.*`
- an optional callback overload that exposes pack-composed helpers — namespaced helpers like `field.id.uuidv7String()`, `field.text()`, `field.temporal.createdAt()`, `field.temporal.updatedAt()`, plus pack-contributed entity-type helpers at top level alongside the built-in `model` / `rel` (e.g. `enum({ name, values })`)
- lowering from authored model definitions into the canonical SQL `Contract`

## Responsibilities

- **SQL contract authoring**: Build SQL contracts programmatically with type safety
- **Pack-composed helper vocabulary**: Merge family, target, and extension authoring contributions into the callback helper namespaces
- **Lowering pipeline**: Turn authored model definitions into the canonical SQL contract artifacts consumed by the rest of the stack
- **Config helper**: Provide `typescriptContract(...)` for `prisma.config.ts`
- **Schema validation**: Contract JSON validation flows through the per-target descriptor SPI (`descriptor.contractSerializer.deserializeContract(json)`)

## Package Status

This is the current SQL TypeScript authoring implementation. Shared descriptor types live in `@internal/contract-authoring`. Contract validation flows through the per-target descriptor's `contractSerializer` SPI (e.g. `postgresTarget.contractSerializer.deserializeContract`), or via the canonical façade (`postgres<Contract>(...)`).

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

Direct imports expose the base structural helpers. Use this surface when you want to author with explicit column descriptors, explicit generators, or named storage types.

Built-in ID helpers from `@internal/ids` already return the generated-field spec accepted by `field.generated(...)`, so `field.generated(uuidv4())` is a valid structural DSL call.

```typescript
import { textColumn, timestamptzColumn } from '@internal/adapter-postgres/column-types';
import sqlFamily from '@internal/family-sql/pack';
import { uuidv4 } from '@internal/ids';
import { defineContract, field, model, rel } from '@internal/sql-contract-ts/contract-builder';
import postgresPack from '@internal/target-postgres/pack';

const User = model('User', {
  fields: {
    id: field.generated(uuidv4()).id(),
    email: field.column(textColumn).unique(),
    createdAt: field.column(timestamptzColumn).defaultSql('now()'),
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
    id: field.generated(uuidv4()).id(),
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

### Callback Helper Vocabulary

Pack-provided helper presets are available through the callback overload. This is the surface that exposes `field.id.*`, `field.text()`, `field.temporal.createdAt()`, `field.temporal.updatedAt()`, `type.sql.String(...)`, and extension helpers such as `type.pgvector.Vector(...)`.

```typescript
import pgvector from '@internal/extension-pgvector/pack';
import sqlFamily from '@internal/family-sql/pack';
import { defineContract, enumType, member } from '@internal/sql-contract-ts/contract-builder';
import postgresPack from '@internal/target-postgres/pack';

const pgText = { codecId: 'pg/text@1', nativeType: 'text' } as const;
const Role = enumType('role', pgText, member('USER', 'user'), member('ADMIN', 'admin'));

export const contract = defineContract(
  {
    family: sqlFamily,
    target: postgresPack,
    extensions: { pgvector },
  },
  ({ type, field, model, rel }) => {
    const types = {
      ShortName: type.sql.String(35),
      Embedding1536: type.pgvector.Vector(1536),
    } as const;

    const User = model('User', {
      fields: {
        id: field.id.uuidv7String().sql({ id: { name: 'user_pkey' } }),
        shortName: field.namedType(types.ShortName),
        role: field.namedType(Role),
        embedding: field.namedType(types.Embedding1536).optional(),
        createdAt: field.temporal.createdAt(),
        updatedAt: field.temporal.updatedAt(),
      },
    });

    const Post = model('Post', {
      fields: {
        id: field.id.uuidv7String(),
        authorId: field.uuidString(),
        title: field.text(),
      },
    });

    return {
      enums: { role: Role },
      types,
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

PostgreSQL and SQLite contribute `type.BigIntNumber()`, while PostgreSQL also contributes `type.UnboundedInt()`. Build each composed type once, return those same instances in the contract's `types` map, and pass them to `field.namedType(...)`. This keeps the named storage type registration and every field reference aligned.

```typescript
import sqlFamily from '@internal/family-sql/pack';
import { defineContract } from '@internal/sql-contract-ts/contract-builder';
import { pgInt8NumberColumn, pgUnboundedIntColumn } from '@internal/target-postgres/codecs';
import postgresPack from '@internal/target-postgres/pack';

export const contract = defineContract(
  { family: sqlFamily, target: postgresPack },
  ({ field, model, type }) => {
    const types = {
      BigIntNumber: type.BigIntNumber(),
      UnboundedInt: type.UnboundedInt(),
    } as const;

    return {
      types,
      models: {
        Meter: model('Meter', {
          fields: {
            peak: field.namedType(types.BigIntNumber),
            lifetime: field.namedType(types.UnboundedInt),
            directPeak: field.column(pgInt8NumberColumn()),
            directLifetime: field.column(pgUnboundedIntColumn()),
          },
        }),
      },
    };
  },
);
```

The direct form does not register a named type: use `field.column(pgInt8NumberColumn())` or `field.column(pgUnboundedIntColumn())` on PostgreSQL, and `field.column(sqliteBigintNumberColumn())` imported from `@internal/target-sqlite/codecs` on SQLite. The named and direct forms select the same codecs and application types; choose named types when several fields should share a contract-level name, and direct helpers for an explicit per-column declaration.

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
constraints.index([cols.email], { unique: true, where: '(archived_at IS NULL)', name: 'users_email_active' })
constraints.index({ expression: 'eql_v3.eq_term(email)', name: 'users_email_eq' })
```

- **Fields form** — `constraints.index(cols | [cols...], options?)`. Options: `unique?`, `where?` (partial-index predicate, WHERE body without the keyword), `name?` xor `map?`, and — when the target pack registers index types — `type?` paired with its `options?` (e.g. `type: 'hash', options: {}`). The pack-typed arm requires the `options` key at compile time; PSL accepts `type:` without `options:` (absent validates as `{}`) — both lower to the same IR.
- **Expression form** — `constraints.index({ expression, ...options })`. The expression is the whole CREATE INDEX element list as one opaque string; `name` or `map` is required (no default name can be derived from an expression). Same remaining options as the fields form.

`name:` declares a **wire-named** index: the physical name is `<name>_<8-hex content hash>`, and renames plan as `ALTER INDEX … RENAME`. `map:` adopts an **exact** physical name verbatim (no hash) — intended for objects captured by `contract infer`. Combining `map:` with a SQL body (`expression`/`where`) emits the `PN_EXACT_NAME_BODY_COMPARISON` warning at build time: drift detection byte-compares the authored text against Postgres's reprinted form, which is only reliable for infer-captured text. Prefer `name:` for hand-authored bodies.

### Helper Notes

- Structural helpers: `field.column(...)`, `field.generated(...)`, `field.namedType(...)`, plus `model(...)` and `rel.*`
- Callback helper presets: `field.id.uuidv4String()`, `field.id.uuidv7String()`, `field.id.nanoid({ size })`, `field.uuidString()`, `field.text()`, `field.temporal.createdAt()`, `field.temporal.updatedAt()`, and `type.*` (Postgres also adds `field.uuidNative()`, `field.id.uuidv4Native()`, `field.id.uuidv7Native()` — these emit `pg/uuid@1`)
- Integer representation types: register composed `type.BigIntNumber()` / `type.UnboundedInt()` instances in the returned `types` map and reference those same instances with `field.namedType(...)`, or use the direct per-codec column helpers with `field.column(...)`. `BigIntNumber` emits `pg/int8number@1` on PostgreSQL or `sqlite/bigintnumber@1` on SQLite and throws outside ±(2^53 − 1); PostgreSQL-only `UnboundedInt` emits `pg/unboundedint@1` and reads and writes exact `bigint` values. Bare `field.bigint()` keeps the lossless `pg/int8@1`. See [Integer Representation Types](#integer-representation-types) for the TypeScript forms and [Integer representation types](../../../../docs/reference/integer-representation-types.md) for the canonical selection, runtime, JSON, and aggregate behavior reference.
- Timestamp helpers mirror PSL semantics: `field.temporal.createdAt()` lowers to a target storage `now()` default, while `field.temporal.updatedAt()` lowers to the target-owned `timestampNow` execution default for create and non-empty update mutations.
- Keep field-local and FK-local storage overrides next to the authoring site with `field.sql(...)` and `rel.belongsTo(...).sql({ fk })`
- Prefer typed local refs such as `field.namedType(types.Role)`, `User.refs.id`, and `User.ref('id')` when those tokens are available
- See [API.md](./API.md) for generated-field spec semantics, validation rules, and typed-reference warning behavior

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

Per-FK overrides still live next to the FK authoring site, either via `constraints.foreignKey(...)` inside model `.sql(...)` or via `rel.belongsTo(...).sql({ fk: ... })`. See [ADR 161](../../../../docs/architecture%20docs/adrs/ADR%20161%20-%20Explicit%20foreign%20key%20constraint%20and%20index%20configuration.md).

### Validating Contracts

Contract JSON validation flows through the per-target descriptor's
`contractSerializer` SPI; this package focuses on authoring and lowering.
End-user app code typically goes through the canonical façade
(`postgres<Contract>(...)`), which threads the descriptor SPI internally.

```typescript
import postgres from '@internal/postgres/runtime';
import contractJson from './contract.json' with { type: 'json' };
import type { Contract, TypeMaps } from './contract.d';

const db = postgres<Contract, TypeMaps>({
  contractJson,
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

## Dependencies

- **`@internal/config`** - `ContractConfig` types used by `typescriptContract(...)`
- **`@internal/contract-authoring`** - Shared descriptor types
- **`@internal/framework-components`** - Pack refs, authoring contributions, and codec lookup types
- **`@internal/sql-contract`** - SQL contract types and validation target

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
