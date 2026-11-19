# Known failures of the SQL ORM client

Each test here states what a call should do and is marked `it.fails`, because the ORM client does not do it yet. A test starts failing the run when the behaviour changes; remove its `.fails` then.

| Test | What happens today |
| --- | --- |
| SQLite: a `BigInt` beyond ±(2^53 − 1), on `create` and on read | `create` throws `RangeError` after the row is stored, and every later read of the table throws it too |
| SQLite: a `sql.Char(n)` value with a trailing space | the value is read without the space, and a filter on the value read does not find the row |
| `select` before `create` on a variant stored in its own table | `select` is ignored and every field is returned |
| `create` on a variant stored in its own table, with a relation callback | refused with `ORM.FIELD_UNKNOWN` |
| `upsert` on a variant whose key a row of another variant holds | returns that row, which the variant does not contain |
| `deleteAll` returning rows, on a model related to itself with `onDelete: SetNull` | with `RETURNING`, a row another deleted row changed comes back with its foreign key `null`; without, as it was before the delete |
| `update` of a key, on a model related to itself with `onUpdate: Cascade` | with `RETURNING` the call returns the foreign key as written, and the table holds what the cascade left |
| Postgres: a `TimeTemporal(p)` value from `23:59:59.5` up | the database rounds it to `24:00:00`, and the row can no longer be read |

The two cascade cases follow from what `RETURNING` reports in SQL, so they may be accepted; the tests then need to say so.

The fixtures are emitted contracts: `pnpm emit` in `test/integration` writes `fixtures/*/generated/`.
