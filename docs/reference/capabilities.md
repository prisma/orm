# Capabilities Reference

A capability is a feature a contract may use, such as `RETURNING` or interactive transactions. The contract lists the capabilities it requires in `contract.capabilities`, as flags grouped by namespace:

```json
{
  "capabilities": {
    "sql": { "returning": true, "interactiveTransactions": true },
    "postgres": { "distinctOn": true }
  }
}
```

The query builder and the ORM client offer a feature only when the contract lists its flag as `true`. The list is fixed when the contract is emitted. Nothing adds to it at run time, and the client does not ask the database.

The decision record is [ADR 335](../architecture%20docs/adrs/ADR%20335%20-%20A%20contract's%20capabilities%20follow%20from%20the%20database%20version%20its%20author%20states.md).

## Who declares a capability

Each capability is declared by the component that knows the fact:

| Component | Declares | Example |
| --- | --- | --- |
| Target | What the database provides, by version | `sql.lateral` on PostgreSQL 15 to 18 |
| Driver | What the connection provides | `sql.interactiveTransactions` |
| Adapter | What it can write as a query, beyond the database's facts | none on PostgreSQL today |
| Extension pack | Flags of its own namespace, through the `capabilities` of its descriptor | none of the shipped packs declares one |

Keys in the `sql` namespace are shared by every SQL target. They are not a separate set for the SQL family.

## PostgreSQL

### The table of versions

The PostgreSQL target holds the table of which version provides which capability: `postgresCapabilitiesByVersion` in `@prisma/orm-postgres/target/server-version`. Prisma supports PostgreSQL 15, 16, 17 and 18. No feature Prisma supports needs a version above 15, so the four rows are equal today:

| Capability | 15 | 16 | 17 | 18 | What reads it |
| --- | --- | --- | --- | --- | --- |
| `postgres.distinctOn` | yes | yes | yes | yes | `distinctOn()` |
| `postgres.forNoKeyUpdate` | yes | yes | yes | yes | `forNoKeyUpdate()` |
| `postgres.forKeyShare` | yes | yes | yes | yes | `forKeyShare()` |
| `sql.returning` | yes | yes | yes | yes | Reading back rows an insert, update or delete wrote |
| `sql.defaultInInsert` | yes | yes | yes | yes | `DEFAULT` as a value in a multi-row insert; without it the ORM splits the insert by columns |
| `sql.lateral` | yes | yes | yes | yes | Lateral joins |
| `sql.scalarList` | yes | yes | yes | yes | A scalar list field in a Prisma schema |
| `sql.checkConstraint` | yes | yes | yes | yes | `@@check` in a Prisma schema |
| `sql.insertOnConflictSkip` | yes | yes | yes | yes | `createAll(rows, { onConflict: 'skip' })` and the same option of `createAndCount` |
| `sql.insertOnConflictWithoutTarget` | yes | yes | yes | yes | The same option without `conflictOn` |
| `sql.insertOnConflictTarget` | yes | yes | yes | yes | An upsert whose conflict clause names its columns |
| `sql.forUpdate` | yes | yes | yes | yes | `forUpdate()` |
| `sql.forShare` | yes | yes | yes | yes | `forShare()` |
| `sql.lockOf` | yes | yes | yes | yes | The `of` option of the locking methods, and the ORM's locking methods |
| `sql.lockNowait` | yes | yes | yes | yes | The `nowait` option of the locking methods |
| `sql.lockSkipLocked` | yes | yes | yes | yes | The `skipLocked` option of the locking methods |
| `sql.jsonAgg` | yes | yes | yes | yes | The one-query include (see below) |
| `sql.outerReferencesInDerivedTables` | yes | yes | yes | yes | The one-query include |
| `sql.jsonAggWithoutTruncation` | yes | yes | yes | yes | The one-query include |

A supported version's row does not change within a major version, and a test pins each row. A feature that needs a newer database arrives with a new row.

The PostgreSQL adapter declares no capabilities. The PostgreSQL driver declares `sql.interactiveTransactions`.

### How a contract gets its list

The author states the PostgreSQL version where the contract is written. There is no default.

- A TypeScript contract states it in `defineContract`: `defineContract({ databaseVersion: 18 }, …)`.
- A Prisma schema states it in the config's contract entry: `contract: { path: './prisma/contract.prisma', databaseVersion: 18 }`. A `.prisma` path given as a bare string is refused, and a `.ts` path with `databaseVersion` or `capabilities` beside it is refused.
- A Prisma 7 schema states it in `prisma7Schema('prisma/schema.prisma', { databaseVersion: 18 })`.
- A config that builds its contract source itself, with `prismaContract` or `prisma7Contract`, passes `capabilities: postgresContractCapabilities({ databaseVersion: 18 })` to the source.

Each of these also takes an optional `capabilities` list. The facade then builds the contract's list in this order:

1. The row of the stated version.
2. Each set of the `capabilities` list, in order. A later set's flag replaces an earlier one's, and `false` turns a flag off.
3. Only the flags that are on are kept.

The `capabilities` list holds what the connection provides. It defaults to `defaultConnectionCapabilities`, exported from `@prisma/orm-postgres/config` and `@prisma/orm-postgres/contract-builder`: the sets of the adapter and the driver the facade's client runs with, `[{}, { sql: { interactiveTransactions: true } }]`. A list you write replaces the default. To keep interactive transactions, start it from the default:

```typescript
capabilities: [...defaultConnectionCapabilities, { sql: { insertOnConflictTarget: false } }]
```

Extensions listed in `extensions` add their own flags. The contract stores the flags and never the version.

### Where each check happens

| When | What is checked | On failure |
| --- | --- | --- |
| Authoring a Prisma schema | A feature that needs a flag, such as `@@check` or a scalar list | A diagnostic, such as `PSL_CHECK_UNSUPPORTED_TARGET` or `PSL_SCALAR_LIST_UNSUPPORTED_TARGET` |
| Type-checking a query | A method that needs a flag, such as `forUpdate()` or `distinctOn()` | The method is not offered |
| Running a query | The same methods, for a contract whose type does not say | `ORM.CAPABILITY_MISSING`; a locking clause the adapter cannot render fails with `RUNTIME.AST_UNSUPPORTED` |
| Type-checking `transaction()` | `sql.interactiveTransactions` | The callback passed to `transaction()` is a type error that names the flag |
| Calling `transaction()` | `sql.interactiveTransactions` | `ORM.CAPABILITY_MISSING` |
| Creating the client | Flags that are not the database's must be provided by the client's adapter and driver | A type error, and a warning with code `CONTRACT.CAPABILITIES_NOT_PROVIDED` through the client's `log`, once. `verifyMarker: false` turns the warning off |
| `db verify`, `db sign` | The database's flags against the server's version (`server_version_num`) | `CONTRACT.DATABASE_CAPABILITIES_NOT_PROVIDED`; nothing is signed |
| `db migrate`, `db update`, `db init` | The same, for every contract space, before anything runs | `MIGRATION.DATABASE_CAPABILITIES_NOT_PROVIDED`; nothing is changed |

Only the flags in the target's table are checked against the database. A flag no row names, such as one a newer release added, is left to the client, which reports it with the flags its adapter and driver lack. A server older than PostgreSQL 15 is always refused. A server newer than the last row is treated as the last row. The refusal names the first version that provides each missing capability, and the version to state instead. The CLI offers no `db update` for it, since that cannot upgrade a server. [Error reference](./error-reference.md) has each code.

## MySQL, MariaDB, SQLite and MongoDB

These contracts take no version. They take a fixed list from their adapter, which emit writes into the contract:

- MySQL: `mysqlAdapterCapabilities`. It has no `returning`, `lateral` or `insertOnConflictTarget`: `ON DUPLICATE KEY UPDATE` fires on any unique key.
- MariaDB: MySQL's list, with `returning`, `outerReferencesInDerivedTables` and `jsonAggWithoutTruncation` off.
- SQLite: `sqliteAdapterCapabilities`. It has `returning` and no `lateral`.
- MongoDB: no capabilities.

Each of the SQL lists includes `sql.interactiveTransactions`.

## Capabilities that choose how includes load

The ORM client loads includes with one query, a correlated subquery per include that aggregates the related rows into JSON, only when the contract's `sql` namespace has all three of `jsonAgg`, `outerReferencesInDerivedTables` and `jsonAggWithoutTruncation`. The same key in another namespace does not count. When any of the three is missing or `false`, the client loads includes with one query per relation: it reads the parent rows, then the related rows of all those parents in one statement per include, and joins them in memory. A very large set of parents is split: each statement carries at most 10 000 bound parameters and about 1 MiB of key values. Every parent table in the include tree needs a primary key or a unique key with no nullable column; without one the read fails with `ORM.ROW_IDENTITY_MISSING`. There is no user switch between the two ([ADR 164](../architecture%20docs/adrs/ADR%20164%20-%20Repository%20Layer.md)). PostgreSQL, SQLite and MySQL contracts have all three. MariaDB contracts have only `jsonAgg`.

## Extension capability keys

An extension pack's flags go under its own namespace, such as `pgvector`, so they cannot collide with a target's ([ADR 117](../architecture%20docs/adrs/ADR%20117%20-%20Extension%20capability%20keys.md)). None of the shipped packs (pgvector, PostGIS, ParadeDB, citext, Supabase) declares a flag today.

## References

- [ADR 335: A contract's capabilities follow from the database version its author states](../architecture%20docs/adrs/ADR%20335%20-%20A%20contract's%20capabilities%20follow%20from%20the%20database%20version%20its%20author%20states.md)
- [Capability gating](../architecture%20docs/patterns/capability-gating.md)
- [Extensions Glossary](./extensions-glossary.md)
