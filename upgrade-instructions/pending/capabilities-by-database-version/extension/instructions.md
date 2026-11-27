---
changes:
  - id: extension-contract-lists-required-capabilities
    summary: |
      A PostgreSQL contract now lists every capability it requires. An extension's shipped contract requires what the oldest PostgreSQL version the extension supports provides, and the driver's: `defineContract({ requiredCapabilities: [...postgres15, ...postgresDriver], ... })`, or `capabilities: postgresContractCapabilities([...postgres15, ...postgresDriver])` for a `prismaContract` source. Then run `prisma contract emit` and sign each test database again with `prisma db sign`.
    detection:
      glob: "**/*.{ts,mts,cts,js,mjs,cjs}"
      matches:
        - '@prisma/orm-postgres/(?:config|contract-builder)[''"]'
        - '@internal/postgres/(?:config|contract-builder)[''"]'
        - '\bprisma(?:7)?Contract\s*\('
  - id: extension-descriptor-declares-no-capabilities
    summary: |
      An extension's descriptors no longer declare capability flags. Remove the `capabilities` field from the extension's pack metadata and descriptors. Emit adds a descriptor's flags to every application contract that uses the extension, and no adapter or driver provides them, so the application's client would fail to type-check.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'kind\s*:\s*[''"]extension[''"][\s\S]*\bcapabilities\s*:\s*\{'
  - id: extension-capability-flags-removed
    summary: |
      PostgreSQL contracts no longer list `postgres.orderBy`, `postgres.limit`, `postgres.lateral`, `postgres.jsonAgg`, `postgres.returning`, `sql.enums`, `postgres.pgvector.cosine`, `postgres.postgis.geometry` or `postgres.paradedb/bm25`. Nothing read them. Remove any code that reads or writes them.
    detection:
      glob: "**/*.{ts,mts,cts,js,mjs,cjs}"
      matches:
        - '\bpostgres\.(?:orderBy|limit|lateral|jsonAgg|returning)\b'
        - 'pgvector\.cosine|postgis\.geometry|paradedb/bm25'
  - id: extension-client-goes-by-the-contract
    summary: |
      The SQL runtime no longer adds the target's, adapter's, driver's and extensions' capabilities to the contract's. `createExecutionContext` takes no `driver` option. A contract built by hand, as in a test, lists every capability the code uses, and `transaction()` needs it to require `sql.interactiveTransactions`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bcreateExecutionContext\s*\('
        - '\.transaction\s*\('
  - id: extension-capability-exports-moved
    summary: |
      `postgresAdapterCapabilities` moved from `@prisma/orm-target-postgres/adapter/adapter` to `@prisma/orm-target-postgres/adapter/capabilities`, and is now empty. `renderLoweredSql` takes no capabilities argument. `PostgresDatabaseSchemaNode.pgVersion` is replaced by `serverVersionNumber`.
    detection:
      glob: "**/*.{ts,mts,cts,js,mjs,cjs}"
      matches:
        - '@prisma/orm-target-postgres/adapter/adapter[''"]'
        - '\brenderLoweredSql\s*\('
        - '\bpgVersion\b'
---

# A PostgreSQL contract lists the capabilities it requires

These changes apply to an extension for PostgreSQL. Do them in the order below.

## `extension-contract-lists-required-capabilities`

A capability is a fact that a database version or a connection provides, and that a contract requires. A contract's capabilities used to come from the adapter. Now the contract lists every capability it requires, and nothing is added to it. `@prisma/orm-postgres/contract-builder` and `@prisma/orm-postgres/config` export what each supported PostgreSQL version provides, `postgres15` to `postgres18`, and what the driver's connection provides, `postgresDriver`. Each is a list of capability keys such as `sql.returning`.

An extension's shipped contract (its contract space) runs on every database its users have. So require what the oldest version the extension supports provides, usually `postgres15`. `prisma db migrate`, `prisma db update` and `prisma db init` check every contract space's contract against the database before they change it, and refuse a database that lacks what a contract requires. Today all four versions provide the same capabilities, so no supported database is refused. A contract that requires a newer version's capabilities than it needs would refuse users on older databases once a release adds a version with new features.

### 1. Write the list

A contract written in TypeScript lists them in `defineContract`, from `@prisma/orm-postgres/contract-builder`. Before:

```ts
export const contract = defineContract({ codecLookup, dataTypeLookup }, () => ({
  // ...
}));
```

After:

```ts
import { defineContract, postgres15, postgresDriver } from '@prisma/orm-postgres/contract-builder';

export const contract = defineContract(
  { requiredCapabilities: [...postgres15, ...postgresDriver], codecLookup, dataTypeLookup },
  () => ({
    // ...
  }),
);
```

Without the list, `defineContract` is a type error. A list that is missing or empty throws at run time:

> State the capabilities your contract requires in requiredCapabilities in defineContract. The list is missing or empty.

A contract written in the Prisma schema language, whose config builds the source with `prismaContract` from `@prisma/orm-family-sql/contract-psl/provider`, passes the source its capabilities. The target, adapter and driver in the config no longer add any, so a source given no `capabilities` writes a contract that lists none. Take them from `postgresContractCapabilities` in `@prisma/orm-postgres/config`, which takes the same list. Before:

```ts
contract: {
  ...prismaContract('src/contract.prisma', {
    target: postgres,
    createNamespace: postgresCreateNamespace,
  }),
},
```

After:

```ts
import {
  postgres15,
  postgresContractCapabilities,
  postgresDriver,
} from '@prisma/orm-postgres/config';

contract: {
  ...prismaContract('src/contract.prisma', {
    capabilities: postgresContractCapabilities([...postgres15, ...postgresDriver]),
    target: postgres,
    createNamespace: postgresCreateNamespace,
  }),
},
```

The config is not shipped code, so add `@prisma/orm-postgres` to `devDependencies` if the extension does not list it yet, at the same exact version as its other `@prisma/orm-*` packages. `prisma7Contract` from `@prisma/orm-family-sql/contract-prisma7/provider` takes the same `capabilities` option.

A config built with the PostgreSQL `defineConfig` from `@prisma/orm-postgres/config`, such as a test application's, lists them in its contract entry. Before:

```ts
contract: './prisma/contract.prisma',
```

After:

```ts
contract: {
  path: './prisma/contract.prisma',
  requiredCapabilities: [...postgres15, ...postgresDriver],
},
```

Without it, loading the config fails with:

> State the capabilities your contract requires in requiredCapabilities beside the contract path './prisma/contract.prisma' in the config. The list is missing or empty.

A `.ts` contract path in that entry does not change, and the config refuses `requiredCapabilities` beside it. A Prisma 7 schema read with `prisma7Schema` takes the list in a second argument: `prisma7Schema('prisma/schema.prisma')` becomes `prisma7Schema('prisma/schema.prisma', { requiredCapabilities: [...postgres15, ...postgresDriver] })`.

### 2. Leave out what the extension does not use, if you need to

The list is exactly what the contract requires. To leave a capability out, filter it out or write the keys yourself: `[...postgres15.filter((capability) => capability !== 'sql.insertOnConflictTarget'), ...postgresDriver]`. A list without `postgresDriver` does not require `sql.interactiveTransactions`, so `transaction()` is unavailable to it.

### 3. Emit the contract

Run `prisma contract emit` and commit the regenerated `contract.json` and `contract.d.ts`. They lose the flags in `extension-capability-flags-removed` and gain `sql.interactiveTransactions`.

### 4. Sign each test database again

Run `prisma db sign --db <connection string>` against each database the extension's tests or examples keep signed. Signing now checks that the database provides every capability the contract requires of it, and refuses to sign when it does not. A database signed by an earlier release was signed without that check; signing again makes it.

Signing and the migration commands now refuse a server older than PostgreSQL 15, for example:

> This release of Prisma requires PostgreSQL 15 or later. This database runs PostgreSQL 14.10. Upgrade the database to PostgreSQL 15 or later.

Verification reports the code `CONTRACT.DATABASE_CAPABILITIES_NOT_PROVIDED`, and the migration commands `MIGRATION.DATABASE_CAPABILITIES_NOT_PROVIDED`. Run the extension's tests against PostgreSQL 15 or later.

## `extension-descriptor-declares-no-capabilities`

Each capability is now declared by the component that knows the fact: the target declares what each database version provides, the driver what the connection provides, and the adapter what it can write as a query. An extension declares none.

`prisma contract emit` still adds the `capabilities` of every descriptor in the config to the application's contract. The client then checks that its target, adapter and driver provide each flag the contract requires, and none of them provides an extension's flag. So an extension that keeps a flag makes every application that uses it fail to type-check where it creates the client, and log the warning `CONTRACT.CAPABILITIES_NOT_PROVIDED`.

Remove the `capabilities` field from the extension's pack metadata, and so from its control and runtime descriptors. Before:

```ts
const pgvectorPackMetaBase = {
  kind: 'extension',
  id: 'pgvector',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  capabilities: {
    postgres: {
      'pgvector.cosine': true,
    },
  },
  authoring: {
    type: pgvectorAuthoringTypes,
  },
  // ...
} as const;
```

After:

```ts
const pgvectorPackMetaBase = {
  kind: 'extension',
  id: 'pgvector',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  authoring: {
    type: pgvectorAuthoringTypes,
  },
  // ...
} as const;
```

An operation or data type is not a capability: it goes through the operation registry and the codecs, as before.

## `extension-capability-flags-removed`

These flags are removed from PostgreSQL contracts. Nothing read them:

- `postgres.orderBy`, `postgres.limit`, `postgres.lateral`, `postgres.jsonAgg` and `postgres.returning`. The `sql.lateral`, `sql.jsonAgg` and `sql.returning` flags remain.
- `sql.enums`. MySQL and MariaDB contracts keep it.
- `postgres.pgvector.cosine`, `postgres.postgis.geometry` and `postgres.paradedb/bm25`, which the pgvector, PostGIS and ParadeDB extensions declared.

Remove any code, type or test fixture of the extension that reads or writes them.

## `extension-client-goes-by-the-contract`

The SQL runtime used to add the capabilities of the target, adapter, driver and extensions to the contract's. It no longer does: the contract's list is the list, and the query builder and the ORM client offer exactly what it holds.

`createExecutionContext` from `@prisma/orm-family-sql/runtime` takes no `driver` option. Before:

```ts
const context = createExecutionContext({ contract, stack, driver });
```

After:

```ts
const context = createExecutionContext({ contract, stack });
```

A contract the extension builds by hand, for example in a test, must list every capability the code under test uses. Take the flags from a contract emitted with the same list.

`transaction()` on the PostgreSQL client, a serverless connection or a Supabase role-bound client needs the contract to require `sql.interactiveTransactions`. Without it, the callback is a type error that names the flag, and the call throws `ORM.CAPABILITY_MISSING`:

> `transaction()` is unavailable: your contract declares no dependency on `sql.interactiveTransactions`. To enable it, add `sql.interactiveTransactions` to your contract's required capabilities.

Extension code that runs transactions through an application's client should check the flag in `contract.capabilities.sql.interactiveTransactions` before it calls `transaction()`, as `@prisma/orm-better-auth` does for its `transaction` option.

A package that adds a SQL target can declare its database's flags as `databaseCapabilities` on its runtime target descriptor (`SqlRuntimeTargetDescriptor`), and answer what a database lacks through `databaseCapabilitiesNotProvided` on its control target descriptor (`SqlControlTargetDescriptor`), which returns a `DatabaseCapabilitiesNotProvided` value from `@prisma/orm-framework/components/control`: the database's name and at least one finding. The SQL family renders it with the framework's text function, and the CLI prints that text. Both are optional, and the PostgreSQL target is the model.

## `extension-capability-exports-moved`

Change these, if the extension has them:

| Before | After |
| --- | --- |
| `postgresAdapterCapabilities` from `@prisma/orm-target-postgres/adapter/adapter` | `postgresAdapterCapabilities` from `@prisma/orm-target-postgres/adapter/capabilities` |
| The flags that `postgresAdapterCapabilities` listed | `postgres15` to `postgres18` from `@prisma/orm-postgres/contract-builder` or `@prisma/orm-postgres/config`, or the table they are built from, `postgresCapabilitiesByVersion` (one row per version) from `@prisma/orm-target-postgres/target/server-version` |
| `renderLoweredSql(ast, contract, codecs, dataTypeLookup, capabilities)` from `@prisma/orm-target-postgres/adapter/sql-renderer` | `renderLoweredSql(ast, contract, codecs, dataTypeLookup)`: drop the last argument |
| `POSTGRES_MIN_SERVER_VERSION` from `@prisma/orm-target-postgres/target/server-version` (or `@prisma/orm-postgres/target/server-version`) | `POSTGRES_MIN_SERVER_VERSION` from `@prisma/orm-target-postgres/target/server-version-range` (or `@prisma/orm-postgres/target/server-version-range`) |
| `pgVersion` (text) on `PostgresDatabaseSchemaNode` and `PostgresDatabaseSchemaNodeInput` from `@prisma/orm-target-postgres/target/types` | `serverVersionNumber`: the server's `server_version_num` as a number, such as `150004` for 15.4, or `undefined` when it could not be read |

`postgresAdapterCapabilities` is now an empty set. The driver's set, `postgresDriverCapabilities`, is in `@prisma/orm-target-postgres/driver/capabilities`. `POSTGRES_MIN_SERVER_VERSION` is still `'15'`. It is the oldest entry in the list of supported PostgreSQL versions, which `./server-version-range` exports with `POSTGRES_NEWEST_VERSION` and `PostgresVersion`; that entry point imports nothing. The version table in `./server-version` has one row for each of those versions, and a test checks that its first row is `POSTGRES_MIN_SERVER_VERSION`.
