# @internal/postgres-codec-testkit

Database-backed conformance harness for PostgreSQL codec JSON projections.

## Purpose

A codec descriptor's `projectJson()` renders SQL whose JSON value the codec's `fromWire` reads as it reads an ordinary row of the column. This package runs that claim against a live PostgreSQL: it writes a representative value through `toWire`, stores it in a column of the codec's native type, reads it back as an ordinary row and through the projection inside a JSON constructor, and checks that `fromWire` reads both to the value the case started from. For every case it also checks that `toDataTypeValue(fromDataTypeValue(v))` equals `v`.

It is dev-only tooling, not a runtime dependency — extension authors install it to verify their own codec descriptors the same way this package's own `test/` suite verifies every built-in PostgreSQL codec descriptor.

## Usage

```ts
import { runPostgresCodecProjection } from '@internal/postgres-codec-testkit';
import type { PostgresCodecConformanceCase } from '@internal/postgres-codec-testkit';

const conformanceCase: PostgresCodecConformanceCase = {
  codecId: 'my-extension/my-codec@1',
  // A codec an extension contributes rather than the target registering —
  // the built-in registry only knows the built-ins.
  descriptor: myCodecDescriptor,
  label: 'representative value',
  value: someApplicationValue,
};

const outcome = await runPostgresCodecProjection(connection, conformanceCase);
// outcome.failure is undefined when the projection conforms.
```

`connection` is any object satisfying `ConformanceConnection` — `{ query(sql, params?) }` — so the caller supplies whichever PostgreSQL client it already owns. Its rows must carry each value as the runtime driver returns it, PostgreSQL's text for every type, because the harness reads an ordinary row with the codec's `fromWire` and compares it with the projected value.

## Scope

The harness, case types, and runner are the public API — the `dist`/`src` this package ships. The built-in PostgreSQL codec catalogue is not part of that surface: it lives in this package's own `test/` directory (excluded from the published tarball by `files`), where it exercises the same harness an extension author consumes, rather than being general-purpose vocabulary.
