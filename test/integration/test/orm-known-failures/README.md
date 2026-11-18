# Known failures of the SQL ORM client

Each test here states what a call should do and is marked `it.fails`, because the ORM client does not do it yet. A test starts failing the run when the behaviour changes; remove its `.fails` then.

| Test | What happens today |
| --- | --- |
| `deleteAll` returning rows, on a model related to itself with `onDelete: SetNull` | with `RETURNING`, a row another deleted row changed comes back with its foreign key `null`; without, as it was before the delete |
| `update` of a key, on a model related to itself with `onUpdate: Cascade` | with `RETURNING` the call returns the foreign key as written, and the table holds what the cascade left |
| Postgres: a `TimeTemporal(p)` value from `23:59:59.5` up | the database rounds it to `24:00:00`, and the row can no longer be read |

The two cascade cases follow from what `RETURNING` reports in SQL, so they may be accepted; the tests then need to say so.

The fixtures are emitted contracts: `pnpm emit` in `test/integration` writes `fixtures/*/generated/`.
