# Capabilities Reference

A capability is a fact that a database version or a connection provides, and that a contract requires, such as `RETURNING` or interactive transactions. On PostgreSQL the author lists the capabilities the contract requires as keys, such as `sql.returning`; on MySQL, MariaDB and SQLite the contract takes its adapter's fixed list at emit, and a MongoDB contract lists none. `contract.json` stores them in `contract.capabilities`, as flags grouped by namespace:

```json
{
  "capabilities": {
    "sql": { "returning": true, "interactiveTransactions": true },
    "postgres": { "distinctOn": true }
  }
}
```

The query builder and the ORM client offer a feature only when the contract lists its flag as `true`. The list is fixed when the contract is emitted. Nothing adds to it at run time, and the client does not ask the database.

The decision record is [ADR 335](../architecture%20docs/adrs/ADR%20335%20-%20A%20contract%20lists%20the%20capabilities%20it%20requires.md).

## Who declares a capability

On PostgreSQL, each capability is declared by the component that knows the fact:

| Component | Declares | Example |
| --- | --- | --- |
| Target | What the database provides, by version | `sql.lateral` on PostgreSQL 15 to 18 |
| Driver | What the connection provides | `sql.interactiveTransactions` |

No PostgreSQL capability is declared by the adapter, and extension packs declare none. On MySQL, MariaDB and SQLite, the adapter declares a fixed list that emit writes into every contract, the target and the driver declare none, and no client check runs yet. MongoDB's components declare none (see [MySQL, MariaDB, SQLite and MongoDB](#mysql-mariadb-sqlite-and-mongodb)).

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

The author writes the list of every capability the contract requires, where the contract is written. Nothing is added to it. The facade exports what each supported version provides, `postgres15` to `postgres18`, built from the table above, and what the driver's connection provides, `postgresDriver`, from `@prisma/orm-postgres/contract-builder` and `@prisma/orm-postgres/config`. Each is a list of capability keys as messages print them.

- A TypeScript contract lists them in `defineContract`: `defineContract({ requiredCapabilities: [...postgres18, ...postgresDriver] }, …)`.
- A Prisma schema lists them in the config's contract entry: `contract: { path: './prisma/contract.prisma', requiredCapabilities: [...postgres18, ...postgresDriver] }`. A `.ts` path with `requiredCapabilities` beside it is refused.
- A Prisma 7 schema lists them in `prisma7Schema('prisma/schema.prisma', { requiredCapabilities: [...postgres18, ...postgresDriver] })`.
- A config that builds its contract source itself, with `prismaContract` or `prisma7Contract`, passes `capabilities: postgresContractCapabilities([...postgres18, ...postgresDriver])` to the source.

The list must be a list, not empty, and each entry a capability key; otherwise `CONTRACT.ARGUMENT_INVALID` says which of the three it is.

Until Prisma 8.0, the list may be left out, as a contract written for a release candidate leaves it out: in `defineContract`, in the config's contract entry (or a bare `.prisma` path), and in `prisma7Schema`. Such a contract requires the newest version's list and the driver's, `[...postgres18, ...postgresDriver]`, the list `prisma orm init` writes, and its type knows those keys. `prisma contract emit` reports the warning `CONTRACT.REQUIRED_CAPABILITIES_NOT_LISTED` with the line to add and its import, and its exit code does not change. Building a TypeScript contract anywhere else prints nothing. `postgresContractCapabilities` has no default. Prisma 8.0 removes the default and requires the list. To leave a capability out, filter it out or write the keys yourself:

```typescript
requiredCapabilities: [
  ...postgres18.filter((capability) => capability !== 'sql.insertOnConflictTarget'),
  ...postgresDriver,
]
```

A list without `postgresDriver` does not require `sql.interactiveTransactions`, so `transaction()` is unavailable to it. Spreads of these lists, a filter by comparison and keys written out all stay literal in the contract's type, so the type-level checks below see each key. A list typed as `RequiredCapabilities` names no key in the type.

Extensions listed in `extensions` add no flags. `contract.json` stores the flags as a nested object, namespace by namespace, and never a version.

### Contracts emitted by a release candidate

The release candidates wrote the adapter's fixed list into every PostgreSQL contract, with flags nothing reads any more: `postgres.orderBy`, `postgres.limit`, `postgres.lateral`, `postgres.jsonAgg`, `postgres.returning`, `sql.enums`, and the extensions' `postgres.pgvector.cosine`, `postgres.postgis.geometry` and `postgres.paradedb/bm25`. The PostgreSQL target declares them as retired (`retiredCapabilities` on its runtime descriptor). The client's check ignores a retired flag, at type level and when the client is created, and signing never checks it, because no row of the table names it. Those contracts also list no connection capability, so a contract that names a retired flag may call `transaction()` without `sql.interactiveTransactions`, as every client of that release could. The flags leave the contract when it is emitted again. The extensions' flags are declared by the target, not by each extension, because those releases wrote them into the `postgres` namespace and the client's type-level check sees the target but not the extensions.

### Where each check happens

| When | What is checked | On failure |
| --- | --- | --- |
| Authoring a Prisma schema | A feature that needs a flag, such as `@@check` or a scalar list | A diagnostic, such as `PSL_CHECK_UNSUPPORTED_TARGET` or `PSL_SCALAR_LIST_UNSUPPORTED_TARGET` |
| Type-checking a query | A method that needs a flag, such as `forUpdate()` or `distinctOn()` | The method is not offered |
| Running a query | The same methods, for a contract whose type does not say | `ORM.CAPABILITY_MISSING`; a locking clause the adapter cannot render fails with `RUNTIME.AST_UNSUPPORTED` |
| Type-checking `transaction()` | `sql.interactiveTransactions`, unless a release candidate emitted the contract | The callback passed to `transaction()` is a type error that names the flag |
| Calling `transaction()` | `sql.interactiveTransactions`, unless a release candidate emitted the contract | `ORM.CAPABILITY_MISSING` |
| Creating the client | Flags that are not the database's, and not retired, must be provided by the client's adapter and driver | A type error, and a warning with code `CONTRACT.CAPABILITIES_NOT_PROVIDED` through the client's `log`, once. `verifyMarker: false` turns the warning off |
| `db verify`, `db sign` | The database's flags against the server's version (`server_version_num`) | `CONTRACT.DATABASE_CAPABILITIES_NOT_PROVIDED`; nothing is signed |
| `db migrate`, `db update`, `db init` | The same, for every contract space, before anything runs | `MIGRATION.DATABASE_CAPABILITIES_NOT_PROVIDED`; nothing is changed |

Only the flags in the target's table are checked against the database. A flag no row names, such as one a newer release added, is left to the client, which reports it with the flags its adapter and driver lack. A server older than PostgreSQL 15 is always refused. A server newer than the last row is treated as the last row. The refusal names the first version that provides each missing capability. The CLI offers no `db update` for it, since that cannot upgrade a server. [Error reference](./error-reference.md) has each code.

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

Extension descriptors declare no capability flags ([ADR 335](../architecture%20docs/adrs/ADR%20335%20-%20A%20contract%20lists%20the%20capabilities%20it%20requires.md)). The namespacing rule of [ADR 117](../architecture%20docs/adrs/ADR%20117%20-%20Extension%20capability%20keys.md), under which an extension's keys would go under its own namespace such as `pgvector`, is background only.

## Maturity and versioning of keys

- A capability has no maturity level of its own. It has the level of the package that publishes it ([ADR 330](../architecture%20docs/adrs/ADR%20330%20-%20A%20maturity%20level%20is%20written%20in%20a%20package's%20version%20and%20an%20API's%20name.md)).
- There are no feature flags. A capability that is not ready ships in a package below Generally Available, or under a name that starts with its level, such as `preview_`.
- A capability key is immutable once published. A new capability can be added in any release, as a new version's list on PostgreSQL. Changing what a published key means requires a new key.

## References

- [ADR 335: A contract lists the capabilities it requires](../architecture%20docs/adrs/ADR%20335%20-%20A%20contract%20lists%20the%20capabilities%20it%20requires.md)
- [Capability gating](../architecture%20docs/patterns/capability-gating.md)
- [Extensions Glossary](./extensions-glossary.md)
