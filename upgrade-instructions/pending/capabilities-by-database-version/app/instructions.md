---
changes:
  - id: postgres-contract-lists-required-capabilities
    summary: |
      A PostgreSQL contract now lists every capability it requires, where the contract is written: `defineContract({ requiredCapabilities: [...postgres18, ...postgresDriver], ... })`, the config's contract entry `{ path: './prisma/contract.prisma', requiredCapabilities: [...postgres18, ...postgresDriver] }`, or `prisma7Schema(path, { requiredCapabilities: [...postgres18, ...postgresDriver] })`. `postgres15` to `postgres18` list what each PostgreSQL version provides, and `postgresDriver` what the driver's connection provides; import them beside `defineContract` or `defineConfig`. A contract without the list still works: it requires the newest version's list and the driver's, and `prisma contract emit` warns with `CONTRACT.REQUIRED_CAPABILITIES_NOT_LISTED` until the list is added. Prisma 8.0 requires the list. Add the list, run `prisma contract emit`, then run `prisma db sign` against each database.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '@prisma/orm-postgres/(?:config|contract-builder)[''"]'
  - id: postgres-config-without-define-config-passes-capabilities
    summary: |
      A config that builds a PostgreSQL contract source itself, with `prismaContract` or `prisma7Contract`, passes the source `capabilities: postgresContractCapabilities([...postgres18, ...postgresDriver])` from `@prisma/orm-postgres/config`. Without it, a source passed to the PostgreSQL `defineConfig` requires the newest version's list and the driver's and `prisma contract emit` warns, until Prisma 8.0; a config built without the PostgreSQL `defineConfig` writes a contract that lists no capabilities.
    detection:
      glob: "**/*.{ts,mts,cts,js,mjs,cjs}"
      matches:
        - '\bprisma(?:7)?Contract\s*\('
  - id: postgres-emitted-contract-is-emitted-again
    summary: |
      A PostgreSQL `contract.json` and `contract.d.ts` emitted by an earlier release list capability flags that nothing reads any more, and lack `sql.interactiveTransactions`. They keep working: the client ignores those flags, and offers `transaction()` to such a contract. Emit them again to replace the flags with the contract's list.
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

The list is recommended now and required from Prisma 8.0. A contract that does not list them requires the newest PostgreSQL version's list and the driver's, the list `prisma orm init` writes, and the commands that load the contract source, `prisma contract emit` and `prisma contract print` among them, warn until you add it. The warning shows what to write, with its import, as `prisma orm init` writes it. For a Prisma schema given as `contract: './prisma/contract.prisma'` it reads:

```text
Your contract does not list the capabilities it requires, so it requires those of the newest PostgreSQL version and of the driver. Prisma 8.0 removes this default and requires the list. Write this as the contract entry in the config, with its import:

contract: {
  path: "./prisma/contract.prisma",
  requiredCapabilities: [...postgres18, ...postgresDriver],
}

import { postgres18, postgresDriver } from '@prisma/orm-postgres/config';
```

Its code is `CONTRACT.REQUIRED_CAPABILITIES_NOT_LISTED`. It does not change emit's exit code.

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

Without the list, `prisma contract emit` warns, saying to add `requiredCapabilities: [...postgres18, ...postgresDriver]` in `defineContract` with the import from `@prisma/orm-postgres/contract-builder`. Building the contract elsewhere, such as in a test, prints nothing.

An empty list throws:

> State the capabilities your contract requires in requiredCapabilities in defineContract. The list is empty.

A capability set, the form the removed `capabilities` option took, is refused as not a list:

> requiredCapabilities in defineContract is not a list. State the capabilities your contract requires as a list of capability keys.

An entry that is not a capability key is refused by name, for example:

> requiredCapabilities in defineContract lists "returning", which is not a capability key. A key is a namespace and a flag joined by a dot, as error messages print it.

The config and `prisma7Schema` refuse the same three cases, naming where they take the list.

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
      path: "./prisma/contract.prisma",
      requiredCapabilities: [...postgres18, ...postgresDriver],
    },
  }),
});
```

A `.prisma` path without the list, or an entry `{ path }` without it, still works, and `prisma contract emit` prints the warning quoted at the start of this section.

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

Without it, `prisma contract emit` warns and shows that call, with the import of `prisma7Schema` and the lists.

The fourth form, a contract source the config builds itself, is in `postgres-config-without-define-config-passes-capabilities` below.

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

A config that builds its contract source itself, with `prismaContract` from `@prisma/orm-family-sql/contract-psl/provider` or `prisma7Contract` from `@prisma/orm-family-sql/contract-prisma7/provider`, passes the source its capabilities, from `postgresContractCapabilities` in `@prisma/orm-postgres/config`. It takes the same list as the other forms. The target, adapter and driver no longer add capabilities to the contract.

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

A source given no `capabilities` and passed to the PostgreSQL `defineConfig`, as `contract: prismaContract(...)`, still works until Prisma 8.0: its contract requires the newest version's list and the driver's, and `prisma contract emit` warns and shows the `capabilities` line above with its import. A source given no `capabilities` in a config that names the target, adapter and driver itself, without the PostgreSQL `defineConfig`, writes a contract that lists none, with no warning: only the PostgreSQL `defineConfig` knows the default, and `postgresContractCapabilities` refuses a missing list. Then emit and sign, as in steps 3 and 4 above.

## `postgres-emitted-contract-is-emitted-again`

A `contract.json` and `contract.d.ts` emitted by an earlier release list flags that nothing reads any more, such as `postgres.orderBy` (see `postgres-capability-flags-removed`), and do not list `sql.interactiveTransactions`.

They keep working. The PostgreSQL target declares those flags as retired, so `postgres(...)`, `postgresServerless(...)` and `supabase(...)` accept such a contract with no type error and no warning, and signing ignores the flags. Such a contract was emitted before contracts listed their connection's capabilities, so `transaction()` stays available to it, as it was in that release.

Run `prisma contract emit` (step 3 above) when you add the list. The emitted contract then lists exactly what the list names, and the retired flags are gone.

## `postgres-transaction-needs-interactive-transactions`

`transaction()` on the PostgreSQL client, on a serverless connection, and on a Supabase role-bound client now needs the contract to require `sql.interactiveTransactions`. The PostgreSQL driver provides it, and `postgresDriver` lists it, so a contract that spreads `postgresDriver` into its list has it.

For a contract without it, other than one an earlier release emitted (see `postgres-emitted-contract-is-emitted-again`), the callback passed to `transaction()` is a type error that names `sql.interactiveTransactions`, and calling it throws `ORM.CAPABILITY_MISSING`:

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

Emitting the contract removes them from `contract.json` and `contract.d.ts`. A list of required capabilities that names one is refused with `CONTRACT.ARGUMENT_INVALID`, for example: ``requiredCapabilities in defineContract lists "postgres.orderBy", which is a retired capability: nothing reads it any more. Remove it from the list.`` Remove them from any list you write, from any contract you build by hand, and from any code or type that names them.

## `postgres-capability-exports-moved`

Change these imports, if the project has them:

| Before | After |
| --- | --- |
| `postgresAdapterCapabilities` from `@prisma/orm-target-postgres/adapter/adapter` | `postgresAdapterCapabilities` from `@prisma/orm-target-postgres/adapter/capabilities`, or from `@prisma/orm-postgres/adapter/capabilities` |
| The flags that `postgresAdapterCapabilities` listed | `postgres15` to `postgres18` from `@prisma/orm-postgres/contract-builder` or `@prisma/orm-postgres/config`, or the table they are built from, `postgresCapabilitiesByVersion` (one row per version) from `@prisma/orm-target-postgres/target/server-version` |
| `pgVersion` (text) on `PostgresDatabaseSchemaNode` from `@prisma/orm-target-postgres/target/types` | `serverVersionNumber`: the server's `server_version_num` as a number, such as `150004` for 15.4, or `undefined` when it could not be read |

`postgresAdapterCapabilities` is now an empty set: every PostgreSQL flag today is a fact about the database, and the target declares those by version. The driver's set, `postgresDriverCapabilities`, is in `@prisma/orm-postgres/driver/capabilities` and `@prisma/orm-target-postgres/driver/capabilities`.
