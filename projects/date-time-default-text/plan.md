# Plan

Three slices, one pull request each, in order. Slice 2 needs slice 1 to be observable in the built CLI. Slice 3 needs slice 2's functions.

## Slice 1: the Postgres control plane works with no global `Temporal` (TML-3250)

- One function in `@internal/target-postgres` returns the `Temporal` to use: the runtime's when it exists, else the one the control-plane entry registered. The codec helpers and the two `now` generators call it and never read the global.
- The target's control-plane entry registers `temporal-polyfill`. No runtime entry imports it.
- `temporal-polyfill` is a required peer dependency of the package that imports it and of the published packages that ship that entry, so a project that already installs it has one copy. npm, pnpm and bun install it automatically; Yarn users add it.
- Tests run the built CLI as a child process that has no `Temporal`: `contract emit` on a PSL schema with a `DateTime` default, `db init` on a contract with date, time and list defaults, and `node migration.ts` with a date default. A test asserts `globalThis.Temporal` is still undefined afterwards.
- Done when the tests pass, fail without the change, and the runtime bundle sizes are unchanged.

## Slice 2: standard text in the data types, casts and codecs (TML-3302)

- One function per data type in `@internal/target-postgres` and `@internal/target-sqlite`, with a table-driven test that compares it with `Temporal` where a `Temporal` type exists.
- The casts from text call it.
- `encodeJson` of `pg/timestamptz-date@1`, the four `*-string@1` codecs, `pg/timetz@1` and `sqlite/datetime@1` writes the standard text; `decodeJson` reads it.
- A parity fixture with date, time, `BigInt` and `Bytes` defaults in PSL and TypeScript.
- Upgrade instructions and ADR 254.
- Done when the schema in the spec stores one text three times in the built CLI.

## Slice 3: verification, planning, infer and print use the same functions (TML-3371)

- `resolvedDefaultsEqual` compares date and time defaults through the functions, for every data type in the spec's table, in place of the JavaScript `Date` comparison.
- Every DDL path renders a date or time default through one function.
- `contract infer` and `contract print` convert the database's text before the check that a printed value reads back as the stored value.
- Integration test: a database created from a contract with non-standard default text verifies against the re-emitted contract and plans no change.
- Close-out: delete this directory.

Slices 2 and 3 may have to merge together if slice 2 alone breaks verification or infer tests. Decide when slice 2's tests run.
