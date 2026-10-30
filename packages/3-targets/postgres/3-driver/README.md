# @internal/driver-postgres

PostgreSQL driver for Prisma 8.

## Package Classification

- **Domain**: targets
- **Layer**: drivers
- **Plane**: multi-plane (migration, runtime)

## Overview

The PostgreSQL driver provides transport and connection management for PostgreSQL databases. It implements the `SqlDriver` interface for executing SQL statements, explaining queries, and managing connections.

In Prisma 8, "driver" refers to the Prisma 8 interface (not the underlying `pg` library). Drivers are transport-agnostic: they own pooling, connection management, and transport protocol (TCP, HTTP, etc.), but contain no dialect-specific logic. All dialect behavior lives in adapters. Instantiation is separate from connection; `create()` returns an unbound driver, `connect(binding)` binds at the boundary ([ADR 159](../../../../docs/architecture%20docs/adrs/ADR%20159%20-%20Driver%20Terminology%20and%20Lifecycle.md)).

This package spans multiple planes:

- **Migration plane** (`src/exports/control.ts`): Control plane entry point for driver descriptors
- **Runtime plane** (`src/exports/runtime.ts`): Runtime entry point for driver implementation

## Purpose

Provide PostgreSQL transport and connection management. Execute SQL statements and manage connections without dialect-specific logic.

## Responsibilities

- **Connection Management**: Acquire and release database connections
- **Statement Execution**: Execute SQL statements with parameters
- **Query Result Parser Policy**: Configure `pg` so runtime query rows expose every column as raw server text, because codecs own decoding; control-plane queries keep `pg` parsing except for array columns
- **Query Explanation**: Execute EXPLAIN queries for query analysis
- **Connection Pooling**: Manage connection pools (when applicable)
- **Transport Protocol**: Handle PostgreSQL protocol (TCP, HTTP, etc.)

**Non-goals:**

- Dialect-specific SQL lowering (adapters)
- Query compilation (sql-query)
- Runtime execution (runtime)

## Architecture

```mermaid
flowchart TD
    subgraph "Runtime"
        RT[Runtime]
        ADAPTER[Adapter]
    end

    subgraph "Postgres Driver"
        DRIVER[Driver]
        POOL[Connection Pool]
        CONN[Connection]
    end

    subgraph "PostgreSQL"
        PG[(PostgreSQL)]
    end

    RT --> ADAPTER
    ADAPTER --> DRIVER
    DRIVER --> POOL
    POOL --> CONN
    CONN --> PG
    PG --> CONN
    CONN --> DRIVER
    DRIVER --> RT
```

## Components

### Driver (`postgres-driver.ts`)

- Main driver implementation
- Implements `SqlDriver` interface
- Manages connections and executes statements
- Handles PostgreSQL protocol

### Row parser policy

The runtime requires a driver to return every row value as `string | Uint8Array | null`, where the string is the text the server prints for the type ([ADR 155](../../../../docs/architecture%20docs/adrs/ADR%20155%20-%20Driver%20Codec%20Boundary%20and%20Lowering%20Responsibilities.md)). Buffered, cursor, and named cursor `query` paths meet that requirement by passing `serverTextTypes` to `pg`. That policy returns raw server text for every type OID, so `pg` never parses a value. Rows from `query` carry the server's text output for every column, and that text is the wire value (ADR 030) every Postgres codec decodes: `t` for a `bool`, `\x0102` for a `bytea`, `NaN` for a `float8`, `1 day 02:03:04` for an `interval`, `{a,b}` for an array, and the JSON text for a `json` or `jsonb` value. A stored JSON string such as `"standard"` keeps its quotes until codec decoding. Direct driver `query` callers see the same server text strings. A reader that consumes `query` rows without a codec, such as the runtime marker check, must parse the text itself.

`explain` passes no `types` option, so its rows use the default `pg` parsing.

The control driver passes `controlTextTypes` instead. Control-plane queries read catalog rows without codecs, so that policy keeps `pg` parsing for scalar types and returns raw text only for the array OIDs that `pg-types` registers (`PG_TYPES_ARRAY_OIDS`), which the control plane parses itself.

The policies are scoped to each driver query; caller-owned clients and the global `pg` type parsers keep their defaults.

## Related Subsystems

- **[Adapters & Targets](../../docs/architecture%20docs/subsystems/5.%20Adapters%20&%20Targets.md)**: Driver specification

## Related ADRs

- [ADR 159 — Driver Terminology and Lifecycle](../../../../docs/architecture%20docs/adrs/ADR%20159%20-%20Driver%20Terminology%20and%20Lifecycle.md)
- [ADR 005 — Thin Core Fat Targets](../../../../docs/architecture%20docs/adrs/ADR%20005%20-%20Thin%20Core%20Fat%20Targets.md)
- [ADR 016 — Adapter SPI for Lowering](../../../../docs/architecture%20docs/adrs/ADR%20016%20-%20Adapter%20SPI%20for%20Lowering.md)
- [ADR 251 — Target-owned Postgres list framing](../../../../docs/architecture%20docs/adrs/ADR%20251%20-%20Target-owned%20Postgres%20list%20framing.md)

## Usage

Use the descriptor + connect lifecycle:

```typescript
import postgresDriver from '@internal/driver-postgres/runtime';

const driver = postgresDriver.create({ cursor: { batchSize: 100 } });
await driver.connect({ kind: 'url', url: process.env.DATABASE_URL });
// driver is now bound; use acquireConnection, query, execute, etc.
```

Binding variants:

- `{ kind: 'url', url }`: Driver creates a Pool from the connection string and ends it on `close()`
- `{ kind: 'pgPool', pool, ownedByDriver }`: Use an existing pg Pool
- `{ kind: 'pgClient', client, ownedByDriver }`: Use an existing pg Client (direct connection)

`ownedByDriver` says whether the driver ends the pool or client on `close()`. With `false` (a pool or client the caller supplied) the driver never ends it. A client that has not started connecting is connected on first use, whoever owns it; pg has no public flag for this, so the driver reads pg's `_connected`, `_connecting`, `_ending` and `_queryable` fields, and treats a client that is ending or no longer queryable as lost. A client whose connect failed or whose connection dropped cannot be reused: the driver rejects every later use.

When a direct driver gives up a supplied client (for example after a failed rollback), it marks the client unusable, sends a `ROLLBACK` for any transaction it opened on it, and never ends it. Binding that client again fails: create a new client.

The driver ensures the session settings the stack's target declares on every connection it uses; the PostgreSQL target declares `DateStyle=ISO`, which every date and time codec that reads a date or timestamp needs, and `lc_monetary=C`, which the `money` codec needs. Both also change how the application's own raw SQL prints dates and `money` on those connections. A pool or client made by `createPgPool` or `createPgClient`, as a `url` binding's pool is, starts each session with the settings as startup options, after any `options` the URL or `PGOPTIONS` gives, and reads its connection string, `PGOPTIONS` and certificate files when it opens each connection, as pg does. On any other pool or client, the driver sets the settings with one statement on each connection before first use, and again after a connection from `acquireConnection()` is released.

With `cursor: { disabled: true }` (or buffered cursor fallback), driver-level pool queries return their connection after fetching, before yielding buffered rows for decoding or consumption. Cursor streams retain the connection until completion or iterator cleanup. Queries on caller-owned connections and transactions never release the caller's lease.

## Exports

- `./runtime`: Runtime entry point for driver implementation
  - Default: `postgresRuntimeDriverDescriptor` — use `create()` for unbound driver, then `connect(binding)`
  - `createPgPool(config, sessionSettings)` and `createPgClient(config, sessionSettings)`: a pg pool or client whose sessions start with the session settings
  - Types: `PostgresBinding`, `PostgresDriverCreateOptions`, `QueryResult`
- `./control`: Control plane entry point for driver descriptors
  - Default export: `DriverDescriptor` for use in `prisma.config.ts`
