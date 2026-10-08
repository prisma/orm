# @internal/sqlite-codec-testkit

Database-backed conformance harness for SQLite codec JSON projections.

## Purpose

A codec descriptor's `projectJson()` renders SQL that reproduces `codec.encodeJson()` inside the database. This package runs that claim against a live SQLite: it stores a representative value in a column of the case's declared storage type, projects the stored column, executes the projection, and checks that the parsed result agrees with `encodeJson` and round-trips back through `decodeJson`.

It is dev-only tooling, not a runtime dependency — extension authors install it to verify their own codec descriptors the same way this package's own `test/` suite verifies every built-in SQLite codec descriptor.

## Usage

```ts
import { runSqliteCodecProjection } from '@internal/sqlite-codec-testkit';
import type { SqliteCodecConformanceCase } from '@internal/sqlite-codec-testkit';

const conformanceCase: SqliteCodecConformanceCase = {
  codecId: 'my-extension/my-codec@1',
  // A codec an extension contributes rather than the target registering —
  // the built-in registry only knows the built-ins.
  descriptor: myCodecDescriptor,
  label: 'representative value',
  value: someApplicationValue,
  storageType: 'TEXT',
};

const outcome = await runSqliteCodecProjection(connection, conformanceCase);
// outcome.failure is undefined when the projection conforms.
```

`connection` is any object satisfying `ConformanceConnection` — `{ query(sql, params?) }` — so the caller supplies whichever SQLite client it already owns. Its rows must carry each value as the runtime driver returns it, because the harness reads an ordinary row with the codec's `fromWire` and compares it with the projected value.

## Scope

The harness, case types, and runner are the public API — the `dist`/`src` this package ships. The built-in SQLite codec catalogue is not part of that surface: it lives in this package's own `test/` directory (excluded from the published tarball by `files`), where it exercises the same harness an extension author consumes, rather than being general-purpose vocabulary.

A SQLite codec descriptor carries no native type, so `storageType` states the column's declared SQLite type directly.
