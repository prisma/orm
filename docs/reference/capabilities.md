# Capabilities Reference

This document defines the canonical capability keys and reserved namespaces used throughout Prisma 8 for adapter negotiation, feature gating, and extension integration.

Capabilities describe **what the database environment can do**. Adapters report capabilities at connect time, and the runtime negotiates them with extension packs. The contract only **declares requirements** (`contract.capabilities`) and pins the resulting `profileHash`; it does not define capabilities.

## Adapter (database) capabilities

Adapter-reported features of the database runtime. These are not contract-owned; they are discovered and negotiated.

### `sql`
Common SQL features reported by adapters using the `sql` namespace. This is a naming convention for shared SQL keys, not a separate “SQL family” capability set.

| Capability | Type | Description | Stability |
|------------|------|-------------|-----------|
| `lateral` | boolean | Supports LATERAL joins | Stable |
| `returning` | boolean | Supports RETURNING clauses for DML operations (INSERT, UPDATE, DELETE) | Stable |
| `jsonAgg` | boolean | Supports JSON aggregation functions. The ORM's one-query include needs it, with `outerReferencesInDerivedTables` and `jsonAggWithoutTruncation` (see [Capabilities that choose how includes load](#capabilities-that-choose-how-includes-load)). | Stable |
| `outerReferencesInDerivedTables` | boolean | Resolves a reference to the outer query from inside a derived table (`FROM (SELECT …) alias`) in a subquery. The ORM's one-query include needs it, because every row include reads from such a derived table. MariaDB does not report it. | Stable |
| `jsonAggWithoutTruncation` | boolean | When the database aggregates rows into a JSON array that is too large, the query fails or the array cannot be decoded; it never returns a shorter valid array. The ORM's one-query include needs it. MariaDB does not report it: it cuts the array with only a warning. | Stable |
| `enums` | boolean | Supports native enum storage types | Stable |
| `foreignKeys` | boolean | Supports FOREIGN KEY constraint DDL | Stable |
| `checkConstraint` | boolean | Supports CHECK constraint DDL. Gates the `@@check` authoring surface: a PSL contract declaring a check against an adapter that does not report this is refused at authoring. | Stable |
| `autoIndexesForeignKeys` | boolean | Database automatically creates indexes for foreign keys | Stable |
| `defaultInInsert` | boolean | Supports `DEFAULT` as a value in multi-row `INSERT ... VALUES` (e.g. `INSERT INTO t (a, b) VALUES (1, DEFAULT)`). When false, the ORM splits multi-row inserts by column signature so each statement has a uniform column list. | Stable |
| `insertOnConflictSkip` | boolean | Can skip rows that collide with a unique constraint instead of failing the statement. Gates `createAll(rows, { onConflict: 'skip' })` and the same option on `createAndCount`. | Stable |
| `insertOnConflictWithoutTarget` | boolean | Can skip colliding rows without naming the constraint that was violated. Gates the same option when `conflictOn` is omitted. It covers skipping only, not an upsert without conflict columns. | Stable |
| `insertOnConflictTarget` | boolean | An insert's conflict clause applies only to the unique columns it names. MySQL's `ON DUPLICATE KEY UPDATE` fires on any unique key, so the MySQL adapter does not report it. When an adapter does not report it, the ORM sends an upsert as an insert whose update-on-conflict clause names no conflict columns, meaning any unique key; the adapter must render that clause as "any unique key" or refuse it. | Stable |
| `forUpdate` | boolean | Can render the row-locking clause `FOR UPDATE` on a select. Gates `forUpdate()`. | Stable |
| `forShare` | boolean | Can render `FOR SHARE` or its equivalent on a select. Gates `forShare()`. | Stable |
| `lockOf` | boolean | Can limit a locking clause to named tables or aliases (`OF "t"`). Needed by the `of` option of the SQL builder's locking methods, and by all four ORM locking methods, which always render `OF` the model's table. | Stable |
| `lockNowait` | boolean | Can make a locking clause fail at once on a locked row (`NOWAIT`). Gates the `nowait` option of the locking methods. | Stable |
| `lockSkipLocked` | boolean | Can make a locking clause leave locked rows out of the result (`SKIP LOCKED`). Gates the `skipLocked` option of the locking methods. | Stable |

### Capabilities that choose how includes load

The ORM client loads includes with the one-query include, a correlated subquery per include that aggregates the related rows into JSON, only when the contract's `sql` group reports all three of `jsonAgg`, `outerReferencesInDerivedTables` and `jsonAggWithoutTruncation`. A key reported only in another group, such as `postgres.jsonAgg`, does not count. When any of the three is missing or `false`, the ORM client loads includes with one query per relation: it reads the parent rows, then the related rows of all those parents in one statement per include, and attaches them in memory. A very large set of parents is split: each statement carries at most 10 000 bound parameters and about 1 MiB of key values, so one include can take several statements. Every parent table in the include tree needs a primary key or a unique key with no nullable column; without one the read fails with `ORM.ROW_IDENTITY_MISSING`. There is no user switch between the two ([ADR 164](../architecture%20docs/adrs/ADR%20164%20-%20Repository%20Layer.md)). The Postgres, SQLite and MySQL adapters report all three; the MariaDB adapter reports only `jsonAgg`.

### `postgres`
PostgreSQL-specific capabilities managed by the adapter.

| Capability | Type | Description | Stability |
|------------|------|-------------|-----------|
| `partialIndex` | boolean | Supports partial/filtered indexes | Stable |
| `deferrableConstraints` | boolean | Supports DEFERRABLE constraints | Stable |
| `savepoints` | boolean | Supports savepoint transactions | Stable |
| `transactionalDDL` | boolean | Supports transactional DDL | Stable |
| `explainFormat` | enum | EXPLAIN output format (`text` \| `json`) | Stable |
| `forNoKeyUpdate` | boolean | Can render the row-locking clause `FOR NO KEY UPDATE` on a select. Gates `forNoKeyUpdate()`. | Stable |
| `forKeyShare` | boolean | Can render the row-locking clause `FOR KEY SHARE` on a select. Gates `forKeyShare()`. | Stable |

### `mysql`
MySQL-specific capabilities managed by the adapter.

| Capability | Type | Description | Stability |
|------------|------|-------------|-----------|
| `jsonFunctions` | boolean | Supports JSON functions | Stable |
| `generatedColumns` | boolean | Supports generated columns | Stable |
| `checkConstraints` | boolean | Supports CHECK constraints | Stable |
| `explainFormat` | enum | EXPLAIN output format (`text` \| `json`) | Stable |

### `sqlite`
SQLite-specific capabilities managed by the adapter.

| Capability | Type | Description | Stability |
|------------|------|-------------|-----------|
| `json1` | boolean | Supports JSON1 extension | Stable |
| `fts5` | boolean | Supports FTS5 full-text search | Stable |
| `rtree` | boolean | Supports R*Tree spatial indexing | Stable |

### Example adapter reports
Postgres adapters should always report `sql.lateral: true` and `sql.returning: true`. The MySQL adapter reports neither.

Postgres (example):
```json
{
  "sql": { "lateral": true, "returning": true, "jsonAgg": true, "outerReferencesInDerivedTables": true, "jsonAggWithoutTruncation": true, "enums": true, "foreignKeys": true, "checkConstraint": true, "autoIndexesForeignKeys": false },
  "postgres": { "partialIndex": true, "transactionalDDL": true, "explainFormat": "json" }
}
```

MySQL (example):
```json
{
  "sql": {
    "orderBy": true,
    "limit": true,
    "foreignKeys": true,
    "enums": true,
    "defaultInInsert": true,
    "jsonAgg": true,
    "outerReferencesInDerivedTables": true,
    "jsonAggWithoutTruncation": true
  }
}
```

## Extension pack capabilities

Extension capabilities are prefixed by pack namespace to avoid collisions. These are negotiated alongside adapter capabilities at connect time.

### `pgvector`
PostgreSQL vector extension capabilities.

| Capability | Type | Description | Stability |
|------------|------|-------------|-----------|
| `ivfflat` | boolean | Supports IVFFlat indexing | Stable |
| `hnsw` | boolean | Supports HNSW indexing | Stable |
| `vector` | object | Vector type support with params | Stable |

### `postgis`
PostGIS geospatial extension capabilities.

| Capability | Type | Description | Stability |
|------------|------|-------------|-----------|
| `gist` | boolean | Supports GiST spatial indexing | Stable |
| `geography` | boolean | Supports geography type | Stable |
| `geometry` | boolean | Supports geometry type | Stable |
| `srid` | array | Supported SRID values | Stable |

### `pg_trgm`
PostgreSQL trigram extension capabilities.

| Capability | Type | Description | Stability |
|------------|------|-------------|-----------|
| `trigram` | boolean | Supports trigram similarity | Stable |
| `gin` | boolean | Supports GIN trigram indexes | Stable |

## Reserved Namespaces

The following namespaces are reserved and cannot be used by extension packs:

### Core Namespaces
- `prisma` - Reserved for Prisma core features
- `core` - Reserved for core adapter capabilities
- `internal` - Reserved for internal implementation details
- `sql` - Reserved for common SQL capability keys reported by adapters

### Adapter Namespaces
- `postgres` - PostgreSQL adapter capabilities
- `mysql` - MySQL adapter capabilities
- `sqlite` - SQLite adapter capabilities
- `mongodb` - MongoDB adapter capabilities (future)

### System Namespaces
- `system` - System-level capabilities
- `debug` - Debug and development capabilities
- `test` - Testing and validation capabilities

## Capability Key Rules

### Naming Convention
- Use lowercase with underscores or camelCase within namespaces (`jsonAgg`, `partial_index`)
- Boolean capabilities use simple names: `lateral`, `savepoints`
- Complex capabilities use descriptive names: `explainFormat`, `transactional_ddl`

### Stability Contract
- A capability key published by a Generally Available package cannot change meaning or be removed within a major ([ADR 329](../architecture%20docs/adrs/ADR%20329%20-%20From%208.0.0%2C%20an%20application%20upgrades%20within%20Prisma%208%20without%20changes.md)).
- A capability has no maturity level of its own: it has the level of the package that publishes it ([ADR 330](../architecture%20docs/adrs/ADR%20330%20-%20A%20maturity%20level%20is%20written%20in%20a%20package's%20version%20and%20an%20API's%20name.md)).

### Versioning
- A new capability can be added in any release
- A change to what a published key means requires a new capability key

## Capability Negotiation

### Adapter Advertisement
Adapters declare supported capabilities at connect time:

```typescript
interface AdapterCapabilities {
  [namespace: string]: {
    [capability: string]: boolean | string | object | array
  }
}
```

### Contract Requirements
Contracts declare required capabilities in `contract.capabilities`:

```json
{
  "capabilities": {
    "sql": { "lateral": true, "returning": true },
    "postgres": { "transactionalDDL": true },
    "pgvector": { "ivfflat": true }
  }
}
```

### Negotiation Process
1. Adapter advertises available capabilities (discovered from the database environment)
2. Runtime checks contract requirements against adapter capabilities
3. Missing required capabilities cause connection failure
4. Optional capabilities are noted but don't block connection

### Error Codes
- `E_CAPABILITY_MISSING` - Required capability not available
- `E_CAPABILITY_INCOMPATIBLE` - Capability value incompatible
- `E_CAPABILITY_UNKNOWN` - Unknown capability key

## Extension Pack Guidelines

### Namespace Selection
- Use descriptive, lowercase names: `pgvector`, `postgis`, `pg_trgm`
- Avoid generic terms: `vector`, `geo`, `search`
- Check reserved namespaces before publishing

### Capability Declaration
- Declare all capabilities your pack requires
- Use stable capability keys from this reference
- Document capability requirements in pack README

### Compatibility Matrix
- Test against multiple adapter versions
- Document minimum capability requirements
- Provide fallback behavior for missing capabilities

## Future Extensions

### Planned Capabilities
- `pg_stat_statements` - Query statistics
- `pg_hint_plan` - Query plan hints
- `pg_partman` - Partition management
- `timescaledb` - Time-series extensions

### Community Guidelines
- Follow naming conventions
- Document capability requirements
- Provide migration paths for capability changes
- Submit capability keys for review before publishing

## References

- [ADR 065: Adapter capability schema & negotiation v1](../architecture%20docs/adrs/ADR%20065%20-%20Adapter%20capability%20schema%20&%20negotiation%20v1.md)
- [ADR 117: Extension capability keys](../architecture%20docs/adrs/ADR%20117%20-%20Extension%20capability%20keys.md)
- [Extensions Glossary](./extensions-glossary.md)

## Capability Matrix

Canonical capability keys with descriptions, typical implementers, and ADR references.

| Capability key | Description | Implemented by | ADRs |
|---|---|---|---|
| sql.enums | Native enum storage types | adapters with native enums | ADR 065 |
| sql.lateral | LATERAL join lowering | adapters that support LATERAL | ADR 065 |
| sql.returning | RETURNING support for DML | adapters that support RETURNING | ADR 065 |
| sql.jsonAgg | JSON aggregation support | adapters that support JSON aggregation | ADR 065 |
| sql.outerReferencesInDerivedTables | Outer references resolve inside a derived table in a subquery | adapters whose database resolves them | — |
| sql.jsonAggWithoutTruncation | An oversized JSON aggregate fails rather than returning a shorter array | adapters whose database never truncates silently | — |
| sql.foreignKeys | FK constraint DDL support | adapters that support FOREIGN KEY | ADR 161 |
| sql.checkConstraint | CHECK constraint DDL support; gates `@@check` | adapters that support CHECK | ADR 244 |
| sql.autoIndexesForeignKeys | DB auto-indexes FKs | adapters where DB auto-creates FK indexes | ADR 161 |
| sql.defaultInInsert | Supports DEFAULT in multi-row INSERT VALUES | adapters that support DEFAULT keyword as a value | — |
| sql.insertOnConflictSkip | Skip rows colliding with a unique constraint; gates `onConflict: 'skip'` | adapters that can skip conflicting rows | — |
| sql.insertOnConflictWithoutTarget | Skip colliding rows without naming the constraint | adapters that can skip without a conflict target | — |
| sql.insertOnConflictTarget | A conflict clause applies only to the columns it names | adapters whose conflict clause can be limited to named columns | — |
| postgres.partialIndex | Partial/filtered index support | postgres adapter | ADR 065 |
| mysql.generatedColumns | Generated column support | mysql adapter | ADR 065 |
| sqlite.fts5 | FTS5 support | sqlite adapter | ADR 065 |
| pgvector.cosine | Cosine distance and similarity operations | pgvector pack | ADR 112–115 |
| postgis.geometry | Geometry type support | postgis pack | ADR 112–115 |

Notes
- Capability keys are versioned and namespaced; see ADR 117 for stability rules.
- Keep this matrix updated with adapter and pack changes.
