---
changes:
  - id: postgres-contract-states-database-version
    summary: |
      A PostgreSQL contract now states the version of the database it runs on, where the contract is written: `defineContract({ databaseVersion: 18, ... })`, the config's contract entry `{ path: './prisma/contract.prisma', databaseVersion: 18 }`, or `prisma7Schema(path, { databaseVersion: 18 })`. The version selects the capabilities the contract requires. Add it, run `prisma contract emit`, then run `prisma db sign` against each database.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '@prisma/orm-postgres/(?:config|contract-builder)[''"]'
  - id: postgres-config-without-define-config-passes-capabilities
    summary: |
      A config that builds a PostgreSQL contract source itself, with `prismaContract` or `prisma7Contract` instead of the PostgreSQL `defineConfig`, passes the source `capabilities: postgresContractCapabilities({ databaseVersion: 18 })` from `@prisma/orm-postgres/config`. Without it the contract lists no capabilities.
    detection:
      glob: "**/*.{ts,mts,cts,js,mjs,cjs}"
      matches:
        - '\bprisma(?:7)?Contract\s*\('
  - id: postgres-emitted-contract-is-emitted-again
    summary: |
      A PostgreSQL `contract.json` and `contract.d.ts` emitted by an earlier release list capability flags the client no longer accepts, and lack `sql.interactiveTransactions`. Until they are emitted again, creating the client is a type error and logs the warning `CONTRACT.CAPABILITIES_NOT_PROVIDED`.
    detection:
      glob: "**/contract.json"
      matches:
        - '(?<![\s\S])(?=[\s\S]*"target"\s*:\s*"postgres")(?![\s\S]*"interactiveTransactions")'
  - id: postgres-transaction-needs-interactive-transactions
    summary: |
      `db.transaction(...)` on a PostgreSQL client, a serverless connection or a Supabase role-bound client needs the contract to list `sql.interactiveTransactions`. The default capabilities list includes it; a stated list that leaves it out makes the callback passed to `transaction()` a type error, and makes `transaction()` throw `ORM.CAPABILITY_MISSING` at run time.
  - id: postgres-hand-built-contract-lists-capabilities
    summary: |
      The client no longer adds its target's, adapter's and driver's capabilities to the contract's. A contract built by hand, not emitted, must list every capability it uses.
  - id: postgres-signing-refuses-servers-older-than-15
    summary: |
      `prisma db verify`, `prisma db sign`, `prisma db migrate`, `prisma db update` and `prisma db init` now refuse a PostgreSQL database that does not provide what the contract requires of it, and every server older than PostgreSQL 15.
  - id: postgres-capability-flags-removed
    summary: |
      PostgreSQL contracts no longer list `postgres.orderBy`, `postgres.limit`, `postgres.lateral`, `postgres.jsonAgg`, `postgres.returning`, `sql.enums`, `postgres.pgvector.cosine`, `postgres.postgis.geometry` or `postgres.paradedb/bm25`. Nothing read them. Remove any reference to them.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '\bpostgres\.(?:orderBy|limit|lateral|jsonAgg|returning)\b'
        - 'pgvector\.cosine|postgis\.geometry|paradedb/bm25'
  - id: postgres-capability-exports-moved
    summary: |
      `postgresAdapterCapabilities` moved from `@prisma/orm-target-postgres/adapter/adapter` to `@prisma/orm-target-postgres/adapter/capabilities`, and is now empty. The database's capabilities are in `postgresCapabilitiesByVersion` from `@prisma/orm-target-postgres/target/server-version`. `PostgresDatabaseSchemaNode.pgVersion` is replaced by `serverVersionNumber`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '@prisma/orm-target-postgres/adapter/adapter[''"]'
        - '\bpgVersion\b'
---

# A PostgreSQL contract states its database version

These changes apply to a project on `@prisma/orm-postgres`. Do them in the order below.

## `postgres-contract-states-database-version`

A contract lists the capabilities it requires, such as `sql.lateral` or `sql.interactiveTransactions`. They used to come from the adapter. Now you state the PostgreSQL version of your database where the contract is written, and the contract requires the capabilities that version provides, plus those of the connection.

### 1. Choose the version

State the version of the oldest database the contract must run on. If production runs PostgreSQL 16 and development runs 17, state 16. The supported versions are 15, 16, 17 and 18. Write the version as a number. A database newer than 18 counts as 18.

Today all four versions provide the same capabilities, so the version you choose does not change the emitted contract. It will matter when a later release adds a version with new features.

### 2. State it where the contract is written

There are four forms. Change each one the project has.

A contract written in TypeScript states it in `defineContract`, from `@prisma/orm-postgres/contract-builder`. Before:

```ts
export const contract = defineContract({ extensions: { pgvector } }, ({ field, model }) => ({
  // ...
}));
```

After:

```ts
export const contract = defineContract({ databaseVersion: 18, extensions: { pgvector } }, ({ field, model }) => ({
  // ...
}));
```

A `defineContract({}, ...)` becomes `defineContract({ databaseVersion: 18 }, ...)`. Without a version, `defineContract` is a type error, and at run time it throws:

> State the PostgreSQL version your database runs in defineContract, for example defineContract({ databaseVersion: 18, ... }). The supported versions are 15, 16, 17, 18.

A contract written in the Prisma schema language states it in the config's contract entry, in the `defineConfig` from `@prisma/orm-postgres/config`. The contract path becomes an object. Before:

```ts
export default definePrismaConfig({
  orm: defineConfig({
    contract: './prisma/contract.prisma',
  }),
});
```

After:

```ts
export default definePrismaConfig({
  orm: defineConfig({
    contract: { path: './prisma/contract.prisma', databaseVersion: 18 },
  }),
});
```

A `.prisma` path without a version is a type error, and loading the config fails with:

> State the PostgreSQL version your database runs beside the contract path, for example contract: { path: './prisma/contract.prisma', databaseVersion: 18 }. The supported versions are 15, 16, 17, 18.

A config whose contract is a TypeScript file (`contract: './prisma/contract.ts'`) does not change. The TypeScript contract states its version in `defineContract`, so the config refuses a `databaseVersion` or `capabilities` beside a `.ts` path.

A Prisma 7 schema read with `prisma7Schema` takes it as a second argument. Before:

```ts
contract: prisma7Schema('prisma/schema.prisma'),
```

After:

```ts
contract: prisma7Schema('prisma/schema.prisma', { databaseVersion: 18 }),
```

Without it, loading the config fails with:

> State the PostgreSQL version your database runs beside the Prisma 7 schema path, for example prisma7Schema('prisma/schema.prisma', { databaseVersion: 18 }). The supported versions are 15, 16, 17, 18.

The fourth form, a config built without this `defineConfig`, is in `postgres-config-without-define-config-passes-capabilities` below.

### 3. Leave out `capabilities`, unless you need it

Each of these forms also takes an optional `capabilities` list, beside `databaseVersion`. It holds the capabilities the connection provides, one set per component, merged over the version's in order. A later set's flag replaces an earlier one's, and `false` turns a flag off.

When you leave it out, it is `defaultConnectionCapabilities`: the sets of the adapter and the driver the PostgreSQL client runs with. Today that adds `sql.interactiveTransactions`, from the driver. Most projects leave it out.

A list you state replaces the default; it is not added to it. To keep the default and change one flag, spread the default into the list. `defaultConnectionCapabilities` is exported by `@prisma/orm-postgres/config` and `@prisma/orm-postgres/contract-builder`:

```ts
import { defaultConnectionCapabilities, defineConfig } from '@prisma/orm-postgres/config';

contract: {
  path: './prisma/contract.prisma',
  databaseVersion: 18,
  capabilities: [...defaultConnectionCapabilities, { sql: { insertOnConflictTarget: false } }],
},
```

A list without the driver's set has no `sql.interactiveTransactions`, so the callback passed to `transaction()` is a type error. See `postgres-transaction-needs-interactive-transactions`.

### 4. Emit the contract

Run:

```sh
prisma contract emit
```

`contract.json` and `contract.d.ts` change. They lose the flags in `postgres-capability-flags-removed` and gain `sql.interactiveTransactions`. Commit them.

### 5. Sign each database again

Run, once for each database the application uses (development, staging, production):

```sh
prisma db sign --db <connection string>
```

Signing now checks that the database provides every capability the contract requires of it, and refuses to sign when it does not. A database signed by an earlier release was signed without that check, so its signature does not yet promise that the database satisfies the contract. Signing again makes that check. `prisma db migrate`, `prisma db update` and `prisma db init` make the same check before they change the database.

## `postgres-config-without-define-config-passes-capabilities`

A config that builds its contract source itself, with `prismaContract` from `@prisma/orm-family-sql/contract-psl/provider` or `prisma7Contract` from `@prisma/orm-family-sql/contract-prisma7/provider`, does not go through the PostgreSQL `defineConfig`. The target, adapter and driver in that config no longer add capabilities to the contract. So pass the source its capabilities, from `postgresContractCapabilities` in `@prisma/orm-postgres/config`. It takes the same `databaseVersion` and optional `capabilities` list as the other forms.

Before:

```ts
contract: prismaContract('./prisma/contract.prisma', {
  target: postgres,
  createNamespace: postgresCreateNamespace,
}),
```

After:

```ts
import { postgresContractCapabilities } from '@prisma/orm-postgres/config';

contract: prismaContract('./prisma/contract.prisma', {
  capabilities: postgresContractCapabilities({ databaseVersion: 18 }),
  target: postgres,
  createNamespace: postgresCreateNamespace,
}),
```

A source given no `capabilities` writes a contract that lists none. Then emit and sign, as in steps 4 and 5 above.

## `postgres-emitted-contract-is-emitted-again`

A `contract.json` and `contract.d.ts` emitted by an earlier release list flags that no PostgreSQL target, adapter or driver declares any more, such as `postgres.orderBy`. The client no longer accepts a contract that requires something its stack does not provide.

Until you emit the contract again:

- `postgres(...)`, `postgresServerless(...)` and `supabase(...)` are type errors. The error names a missing property that starts with the flag, followed by `is required by the contract but not provided by its database version, adapter, driver or extensions`.
- Creating the client logs one warning with the code `CONTRACT.CAPABILITIES_NOT_PROVIDED`, through the client's `log`. For a contract without extensions it reads:

  > Your contract requires capabilities that no supported version of your database provides, and neither do your adapter, driver or extensions (postgres.jsonAgg, postgres.lateral, postgres.limit, postgres.orderBy, postgres.returning, sql.enums). Either remove the capabilities from your contract, or install a component that provides them.

- The contract lacks `sql.interactiveTransactions`, so `db.transaction(...)` is a type error and throws.

Run `prisma contract emit` (step 4 above) to fix all three.

## `postgres-transaction-needs-interactive-transactions`

`transaction()` on the PostgreSQL client, on a serverless connection, and on a Supabase role-bound client now needs the contract to list `sql.interactiveTransactions`. The PostgreSQL driver declares it, and the default capabilities list includes the driver's set, so an emitted contract with no stated list has it.

For a contract without it, the callback passed to `transaction()` is a type error that names `sql.interactiveTransactions`, and calling it throws `ORM.CAPABILITY_MISSING`:

> transaction() requires capability sql.interactiveTransactions. A contract lists the capabilities its database and connection provide; the database package's documentation says how to state them.

If you state a `capabilities` list and use `transaction()`, start the list from `defaultConnectionCapabilities`. With `@prisma/orm-better-auth`, `prismaAdapter(db, { transaction: true })` needs the same flag in the client's contract.

## `postgres-hand-built-contract-lists-capabilities`

The client used to add the capabilities of its target, adapter and driver to the contract's. It no longer does: it offers exactly what the contract lists. An emitted contract already lists what it needs. A contract built by hand, for example a JSON object written in a test, must list every capability the code uses. Take the flags from a contract emitted for the same version, or from `postgresCapabilitiesByVersion[18]` in `@prisma/orm-target-postgres/target/server-version` plus `{ sql: { interactiveTransactions: true } }`.

## `postgres-signing-refuses-servers-older-than-15`

`prisma db verify`, `prisma db sign`, `prisma db migrate`, `prisma db update` and `prisma db init` read the server's version and check that it provides every capability the contract requires of the database. On failure, nothing is signed and nothing is changed. Verification reports the code `CONTRACT.DATABASE_CAPABILITIES_NOT_PROVIDED`, and the migration commands report `MIGRATION.DATABASE_CAPABILITIES_NOT_PROVIDED`.

A server older than PostgreSQL 15 is always refused. For example, for PostgreSQL 14.10:

> This release of Prisma requires PostgreSQL 15 or later. This database runs PostgreSQL 14.10. Upgrade the database to PostgreSQL 15 or later.

Upgrade such a database to PostgreSQL 15 or later. When the server's version cannot be read, the refusal says:

> Prisma could not read this database's PostgreSQL version, so it cannot check that the database provides what your contract requires. Check that the connection reaches a PostgreSQL server, and that SHOW server_version_num returns its version there.

Point the connection at a PostgreSQL server that reports its version, then run the command again.

## `postgres-capability-flags-removed`

These flags are removed from PostgreSQL contracts. Nothing read them:

- `postgres.orderBy`, `postgres.limit`, `postgres.lateral`, `postgres.jsonAgg` and `postgres.returning`. The `sql.lateral`, `sql.jsonAgg` and `sql.returning` flags remain.
- `sql.enums`. MySQL and MariaDB contracts keep it.
- `postgres.pgvector.cosine` from `@prisma/orm-extension-pgvector`, `postgres.postgis.geometry` from `@prisma/orm-extension-postgis` and `postgres.paradedb/bm25` from `@prisma/orm-extension-paradedb`.

Emitting the contract removes them from `contract.json` and `contract.d.ts`. Remove them from any `capabilities` list you state, from any contract you build by hand, and from any code or type that names them.

## `postgres-capability-exports-moved`

Change these imports, if the project has them:

| Before | After |
| --- | --- |
| `postgresAdapterCapabilities` from `@prisma/orm-target-postgres/adapter/adapter` | `postgresAdapterCapabilities` from `@prisma/orm-target-postgres/adapter/capabilities`, or from `@prisma/orm-postgres/adapter/capabilities` |
| The flags that `postgresAdapterCapabilities` listed | `postgresCapabilitiesByVersion` (one row per version) or `postgresCapabilitiesForVersion(version)` from `@prisma/orm-target-postgres/target/server-version` |
| `pgVersion` (text) on `PostgresDatabaseSchemaNode` from `@prisma/orm-target-postgres/target/types` | `serverVersionNumber`: the server's `server_version_num` as a number, such as `150004` for 15.4, or `undefined` when it could not be read |

`postgresAdapterCapabilities` is now an empty set: every PostgreSQL flag today is a fact about the database, and the target declares those by version. The driver's set, `postgresDriverCapabilities`, is in `@prisma/orm-postgres/driver/capabilities` and `@prisma/orm-target-postgres/driver/capabilities`.
