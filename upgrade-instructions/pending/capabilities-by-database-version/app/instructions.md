---
changes:
  - id: postgres-contract-lists-required-capabilities
    summary: |
      A PostgreSQL contract now lists every capability it requires, where the contract is written: `defineContract({ requiredCapabilities: [...postgres18, ...postgresDriver], ... })`, the config's contract entry `{ path: './prisma/contract.prisma', requiredCapabilities: [...postgres18, ...postgresDriver] }`, or `prisma7Schema(path, { requiredCapabilities: [...postgres18, ...postgresDriver] })`. `postgres15` to `postgres18` list what each PostgreSQL version provides, and `postgresDriver` what the driver's connection provides; import them beside `defineContract` or `defineConfig`. Add the list, run `prisma contract emit`, then run `prisma db sign` against each database.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '@prisma/orm-postgres/(?:config|contract-builder)[''"]'
  - id: postgres-config-without-define-config-passes-capabilities
    summary: |
      A config that builds a PostgreSQL contract source itself, with `prismaContract` or `prisma7Contract` instead of the PostgreSQL `defineConfig`, passes the source `capabilities: postgresContractCapabilities([...postgres18, ...postgresDriver])` from `@prisma/orm-postgres/config`. Without it the contract lists no capabilities.
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
      `db.transaction(...)` on a PostgreSQL client, a serverless connection or a Supabase role-bound client needs the contract to require `sql.interactiveTransactions`. `postgresDriver` lists it; a list that leaves it out makes the callback passed to `transaction()` a type error, and makes `transaction()` throw `ORM.CAPABILITY_MISSING` at run time.
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

# A PostgreSQL contract lists the capabilities it requires

These changes apply to a project on `@prisma/orm-postgres`. Do them in the order below.

## `postgres-contract-lists-required-capabilities`

A capability is a fact that a database version or a connection provides, such as `sql.lateral` or `sql.interactiveTransactions`, and that a contract requires. A contract's capabilities used to come from the adapter. Now you write, where the contract is written, the list of every capability the contract requires. Nothing is added to it.

### 1. Choose the lists

`@prisma/orm-postgres/contract-builder` and `@prisma/orm-postgres/config` export one list for each supported PostgreSQL version, `postgres15`, `postgres16`, `postgres17` and `postgres18`, and `postgresDriver`, what the connection of the PostgreSQL driver provides. Each is a list of capability keys as error messages print them, such as `sql.returning`.

Spread the list of the oldest PostgreSQL version the contract must run on, and the driver's: `[...postgres18, ...postgresDriver]`. If production runs PostgreSQL 16 and development runs 17, use `postgres16`. A database newer than 18 provides what 18 provides. Today all four versions provide the same capabilities, so the version you choose does not change the emitted contract. It will matter when a later release adds a version with new features.

To leave a capability out, filter it out or write the keys yourself:

```ts
requiredCapabilities: [
  ...postgres18.filter((capability) => capability !== 'sql.insertOnConflictTarget'),
  ...postgresDriver,
],
```

A list that leaves out `postgresDriver` does not require `sql.interactiveTransactions`, so the callback passed to `transaction()` is a type error. See `postgres-transaction-needs-interactive-transactions`.

### 2. Write the list where the contract is written

There are four forms. Change each one the project has.

A contract written in TypeScript lists them in `defineContract`, from `@prisma/orm-postgres/contract-builder`. Before:

```ts
import { defineContract } from '@prisma/orm-postgres/contract-builder';

export const contract = defineContract({ extensions: { pgvector } }, ({ field, model }) => ({
  // ...
}));
```

After:

```ts
import { defineContract, postgres18, postgresDriver } from '@prisma/orm-postgres/contract-builder';

export const contract = defineContract(
  { requiredCapabilities: [...postgres18, ...postgresDriver], extensions: { pgvector } },
  ({ field, model }) => ({
    // ...
  }),
);
```

Without the list, `defineContract` is a type error, and at run time it throws:

> State the capabilities your contract requires in requiredCapabilities in defineContract. The list is missing.

An empty list throws the same message ending `The list is empty.` A capability set, the form the removed `capabilities` option took, is refused as not a list:

> requiredCapabilities in defineContract is not a list. State the capabilities your contract requires as a list of capability keys.

An entry that is not a capability key is refused by name, for example:

> requiredCapabilities in defineContract lists "returning", which is not a capability key. A key is a namespace and a flag joined by a dot, as error messages print it.

The config and `prisma7Schema` refuse the same four cases, naming where they take the list.

A contract written in the Prisma schema language lists them in the config's contract entry, in the `defineConfig` from `@prisma/orm-postgres/config`. The contract path becomes an object. Before:

```ts
import { defineConfig } from '@prisma/orm-postgres/config';

export default definePrismaConfig({
  orm: defineConfig({
    contract: './prisma/contract.prisma',
  }),
});
```

After:

```ts
import { defineConfig, postgres18, postgresDriver } from '@prisma/orm-postgres/config';

export default definePrismaConfig({
  orm: defineConfig({
    contract: {
      path: './prisma/contract.prisma',
      requiredCapabilities: [...postgres18, ...postgresDriver],
    },
  }),
});
```

A `.prisma` path without the list is a type error, and loading the config fails with:

> State the capabilities your contract requires in requiredCapabilities beside the contract path './prisma/contract.prisma' in the config. The list is missing.

A config whose contract is a TypeScript file (`contract: './prisma/contract.ts'`) does not change. The TypeScript contract lists its capabilities in `defineContract`, so the config refuses `requiredCapabilities` beside a `.ts` path.

A Prisma 7 schema read with `prisma7Schema` takes the list in a second argument. Before:

```ts
contract: prisma7Schema('prisma/schema.prisma'),
```

After:

```ts
contract: prisma7Schema('prisma/schema.prisma', {
  requiredCapabilities: [...postgres18, ...postgresDriver],
}),
```

Without it, loading the config fails with:

> State the capabilities your contract requires in requiredCapabilities in the options of prisma7Schema('prisma/schema.prisma'). The list is missing.

The fourth form, a config built without this `defineConfig`, is in `postgres-config-without-define-config-passes-capabilities` below.

### 3. Emit the contract

Run:

```sh
prisma contract emit
```

`contract.json` and `contract.d.ts` change. They lose the flags in `postgres-capability-flags-removed` and gain `sql.interactiveTransactions`. Commit them.

### 4. Sign each database again

Run, once for each database the application uses (development, staging, production):

```sh
prisma db sign --db <connection string>
```

Signing now checks that the database provides every capability the contract requires of it, and refuses to sign when it does not. A database signed by an earlier release was signed without that check, so its signature does not yet promise that the database satisfies the contract. Signing again makes that check. `prisma db migrate`, `prisma db update` and `prisma db init` make the same check before they change the database.

## `postgres-config-without-define-config-passes-capabilities`

A config that builds its contract source itself, with `prismaContract` from `@prisma/orm-family-sql/contract-psl/provider` or `prisma7Contract` from `@prisma/orm-family-sql/contract-prisma7/provider`, does not go through the PostgreSQL `defineConfig`. The target, adapter and driver in that config no longer add capabilities to the contract. So pass the source its capabilities, from `postgresContractCapabilities` in `@prisma/orm-postgres/config`. It takes the same list as the other forms.

Before:

```ts
contract: prismaContract('./prisma/contract.prisma', {
  target: postgres,
  createNamespace: postgresCreateNamespace,
}),
```

After:

```ts
import {
  postgres18,
  postgresContractCapabilities,
  postgresDriver,
} from '@prisma/orm-postgres/config';

contract: prismaContract('./prisma/contract.prisma', {
  capabilities: postgresContractCapabilities([...postgres18, ...postgresDriver]),
  target: postgres,
  createNamespace: postgresCreateNamespace,
}),
```

A source given no `capabilities` writes a contract that lists none. Then emit and sign, as in steps 3 and 4 above.

## `postgres-emitted-contract-is-emitted-again`

A `contract.json` and `contract.d.ts` emitted by an earlier release list flags that no PostgreSQL target, adapter or driver declares any more, such as `postgres.orderBy`. The client no longer accepts a contract that requires something its stack does not provide.

Until you emit the contract again:

- `postgres(...)`, `postgresServerless(...)` and `supabase(...)` are type errors. The error names a missing property that starts with the flag, followed by `is required by the contract but not provided by this client's connection`.
- Creating the client logs one warning with the code `CONTRACT.CAPABILITIES_NOT_PROVIDED`, through the client's `log`. For a contract without extensions it reads:

  > Your contract requires `postgres.jsonAgg`, `postgres.lateral`, `postgres.limit`, `postgres.orderBy`, `postgres.returning` and `sql.enums`, which this client's connection does not provide. Remove them from your contract's required capabilities, or connect with a driver that provides them.

- The contract lacks `sql.interactiveTransactions`, so `db.transaction(...)` is a type error and throws.

Run `prisma contract emit` (step 3 above) to fix all three.

## `postgres-transaction-needs-interactive-transactions`

`transaction()` on the PostgreSQL client, on a serverless connection, and on a Supabase role-bound client now needs the contract to require `sql.interactiveTransactions`. The PostgreSQL driver provides it, and `postgresDriver` lists it, so a contract that spreads `postgresDriver` into its list has it.

For a contract without it, the callback passed to `transaction()` is a type error that names `sql.interactiveTransactions`, and calling it throws `ORM.CAPABILITY_MISSING`:

> `transaction()` is unavailable: your contract declares no dependency on `sql.interactiveTransactions`. To enable it, add `sql.interactiveTransactions` to your contract's required capabilities.

With `@prisma/orm-better-auth`, `prismaAdapter(db, { transaction: true })` needs the same capability in the client's contract.

## `postgres-hand-built-contract-lists-capabilities`

The client used to add the capabilities of its target, adapter and driver to the contract's. It no longer does: it offers exactly what the contract lists. An emitted contract already lists what it needs. A contract built by hand, for example a JSON object written in a test, must list every capability the code uses. Take the flags from a contract emitted with the same list.

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

Emitting the contract removes them from `contract.json` and `contract.d.ts`. Remove them from any list of required capabilities you write, from any contract you build by hand, and from any code or type that names them.

## `postgres-capability-exports-moved`

Change these imports, if the project has them:

| Before | After |
| --- | --- |
| `postgresAdapterCapabilities` from `@prisma/orm-target-postgres/adapter/adapter` | `postgresAdapterCapabilities` from `@prisma/orm-target-postgres/adapter/capabilities`, or from `@prisma/orm-postgres/adapter/capabilities` |
| The flags that `postgresAdapterCapabilities` listed | `postgres15` to `postgres18` from `@prisma/orm-postgres/contract-builder` or `@prisma/orm-postgres/config`, or the table they are built from, `postgresCapabilitiesByVersion` (one row per version) from `@prisma/orm-target-postgres/target/server-version` |
| `pgVersion` (text) on `PostgresDatabaseSchemaNode` from `@prisma/orm-target-postgres/target/types` | `serverVersionNumber`: the server's `server_version_num` as a number, such as `150004` for 15.4, or `undefined` when it could not be read |

`postgresAdapterCapabilities` is now an empty set: every PostgreSQL flag today is a fact about the database, and the target declares those by version. The driver's set, `postgresDriverCapabilities`, is in `@prisma/orm-postgres/driver/capabilities` and `@prisma/orm-target-postgres/driver/capabilities`.
