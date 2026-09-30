# Date and time defaults are stored in one standard text

Linear: TML-3250 (slice 1), TML-3302 (slice 2), TML-3371 (slice 3).

## Purpose

A literal date or time column default is stored in `contract.json` in one standard text per data type, whichever surface wrote it and however the user typed it. The CLI can read, check and render such a default on a Node runtime that has no global `Temporal`.

```prisma
model Event {
  id Int      @id
  a  DateTime @default("2024-01-01T00:00:00Z")
  b  DateTime @default("2024-01-01T00:00:00.000Z")
  c  DateTime @default("2024-01-01T01:00:00+01:00")
}
```

Today `prisma contract emit` fails on this schema in the published CLI, because the check needs a global `Temporal`. With `Temporal` loaded it stores three different texts for one instant. After this project it stores `"2024-01-01T00:00:00Z"` three times.

## Decisions

1. **The standard text of each data type is the text `Temporal` prints.** A TypeScript contract already stores this through `encodeJson` of the `Temporal` codecs.

   | Data type | Standard text | Example |
   |---|---|---|
   | `pg/timestamptz` | UTC instant, `T` separator, `Z` | `2024-01-01T00:00:00Z` |
   | `pg/timestamp` | date and time, no offset | `2024-01-01T12:34:56` |
   | `pg/date` | date | `2024-01-01` |
   | `pg/time` | time, no offset | `12:34:56` |
   | `pg/timetz` | time and offset, `±HH:MM`, `Z` for zero | `12:34:56+02:00` |
   | `pg/interval` | ISO 8601 duration as `pg/interval@1` writes it | `P2Y1M` |
   | `sqlite/datetime` | the same text as `pg/timestamptz` | `2024-01-01T00:00:00Z` |

   A fraction of a second has no trailing zeros and no more than six digits. A year outside 0000 to 9999 is written as a sign and six digits, as `Temporal` does. `infinity` and `-infinity` are standard text for `pg/date`, `pg/timestamp` and `pg/timestamptz`; a column whose codec cannot hold them refuses them in its own check, as today.

2. **One pure function per data type produces the standard text from written text.** It uses no `Temporal` and no JavaScript `Date`. It lives in the target package, next to the data type. Every place that needs the standard text calls it: the data type's cast from text, `encodeJson` of the codecs whose in-memory type is not a `Temporal` type, schema verification, the migration planner's comparison, `contract infer` and `contract print`.

3. **Text that does not meet the rules is refused.** The function refuses, with a message that says what is wrong and shows a correct example: an offset on `pg/timestamp`, `pg/date` or `pg/time`; no offset on `pg/timestamptz` or `pg/timetz`; a date on a time type or a time on `pg/date`; more than six fraction digits; a value that is not a real date or time. It reads what PostgreSQL prints as well as ISO 8601: a space in place of `T`, an offset of `+HH`, `+HH:MM` or `+HH:MM:SS`, and a ` BC` suffix.

4. **The Postgres target's date and time code gets `Temporal` from the runtime when it has one, and from the target's own control-plane code when it has none.** Nothing installs a global. The three files that use `Temporal` (`temporal-codec-helpers.ts` and the two `now` generators in `@internal/target-postgres`) read it through one function. That function returns `globalThis.Temporal` when it is defined. Otherwise it returns the implementation that the target's control-plane entry registered, which comes from `temporal-polyfill`. The application runtime entries register nothing and do not import the polyfill, so an application process that loads no control-plane code and has no `Temporal` still gets `RUNTIME.TEMPORAL_UNAVAILABLE`, as today. The registered implementation is held once per process. An application that loads control-plane code in its own process, as under `vite dev` with the Vite plugin or in a script that calls the control client, therefore decodes dates without its own `Temporal`; TML-3391 tracks giving the implementation to the control plane's codec instances only. This covers every control-plane path with no call at any entry point: the PSL default check, DDL rendering in `db init`, `db update` and `node migration.ts`, `contract infer`, the Vite plugin, the language server and the programmatic control client.

## Non-goals

- Checking a default against a column's precision (`Timestamp(3)`). No codec does this today. Tracked in TML-3372.
- Tightening codecs that accept more than their declared input type, beyond the date and time codecs this project changes. Tracked in TML-3300.
- A PSL tag for date and time values. ADR 254 leaves that open.
- The application runtime. It reads no literal default.

## Requirements across slices

- PSL and TypeScript store the same text for the same value, for every data type in the table. A parity fixture proves it.
- Every codec of a data type writes that type's standard text from `encodeJson` and reads it in `decodeJson`.
- A database created from a contract emitted before this project still verifies against the contract emitted after it, with no schema change planned.
- `contract infer` prints a date or time default as a literal, and emitting the printed schema stores the same text infer read.
- No control-plane path needs a global `Temporal`, and none creates one.
- The storage hash changes for a contract whose date or time default was not already in the standard text. The upgrade instructions say how to detect this and what to do.

## Definition of done

- The schema in Purpose emits in the built CLI, run as a child process with no polyfill preloaded, and stores one text three times.
- `db init` creates a table with a date default in the same conditions.
- ADR 254 states the standard text of the date and time types and that a cast from text produces it.
- `docs/architecture docs/subsystems/` and the package READMEs that describe defaults match the code.
- This directory is deleted in the last slice's pull request.

## Risks

- The function and `Temporal` disagree on an edge case. A test compares them over a table of inputs.
- The planner writes a default into DDL as quoted text in one path and through the codec in another. A year outside 0000 to 9999 in ISO form is not valid PostgreSQL input, so every DDL path must render through one function.
- Shipping the polyfill adds a required peer dependency to the Postgres target and the Postgres facade. npm, pnpm and bun install it automatically; Yarn users add it. The application runtime entries must not import it; a bundle-size check proves it.
- A process can hold two `Temporal` implementations, the runtime's and the polyfill's. The function prefers the runtime's, and the codecs recognise a value by its `Symbol.toStringTag`, not by `instanceof`.
