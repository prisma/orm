# Plan

Three slices, one pull request each, in order. Slice 2 needs slice 1 to be observable in the built CLI. Slice 3 needs slice 2's functions.

## Slice 1: the CLI loads a `Temporal` implementation (TML-3250)

- The CLI entry point installs `temporal-polyfill` on `globalThis` only when `globalThis.Temporal` is undefined, before any command runs. The same for the other entry points that run control-plane code in a user's process: the Vite plugin that emits contracts and the language server, if they reach a `Temporal` codec.
- `temporal-polyfill` is a runtime dependency of the package that loads it, and of the published package that ships it.
- Tests run the built CLI as a child process with no polyfill preloaded: `contract emit` on a PSL schema with a `DateTime` default, and `db init` on a contract with date, time and list defaults.
- Done when both tests pass and fail without the change.

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
