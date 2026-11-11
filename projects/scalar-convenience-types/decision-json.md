# Decision: PostgreSQL `Json` stays the `json` type

Decided by Will on 2026-11-11, after asking Serhii Tatarintsev.

## Decision

On PostgreSQL, `Json` stays an explicit type: it means a `json` column (codec `pg/json@1`), as it does today. `Jsonb` stays the explicit type for a `jsonb` column (codec `pg/jsonb@1`). There is no `Json` convenience type, no `PlainJson` name, no `plainJsonColumn` rename, and no contract change for existing schemas.

TML-3789 and its PR, prisma/orm#30966, proposed the opposite: `Json` as a convenience type defaulting to `jsonb`, with `Json(storage: json)` giving a type renamed `PlainJson`. That PR is to be closed without merging.

## Why

- Since the `@db.*` attributes were removed, most PostgreSQL types in PSL use PostgreSQL's own names verbatim. A name that exactly matches one PostgreSQL type but means a different one is a trap for anyone who knows PostgreSQL (Serhii's argument).
- The case for `jsonb` was real: the `json` codec declares no traits (`packages/3-targets/postgres/1-target/src/core/codecs.ts`), so a `json` field cannot be filtered by equality, and PostgreSQL cannot index or make unique a `json` column. Containment and JSON path operators exist only for `jsonb`. But a user who needs these hits the limit early, and the fix is to write `Jsonb`. The better answer is to make that moment clear, not to change what `Json` means.

## What follows

1. Close prisma/orm#30966 with a comment pointing here. Cancel TML-3789 in Linear with this reason.
2. Record the decision in ADR 316 (`docs/architecture docs/adrs/ADR 316 - PostgreSQL scalars get convenience types.md`): replace "a `Json` convenience type is decided separately" with "`Json` and `Jsonb` stay explicit types; `Json` is not a convenience type, because it is the exact name of the PostgreSQL `json` type", with the reasons above. Same in `projects/scalar-convenience-types/spec.md`.
3. Clearer errors where a `json` field hits the limit (Serhii's suggestion). The places to look: an equality filter on a `json` field (today a TypeScript error from the missing `equality` trait), `@unique` or `@@index` on a `json` column, and an enum over `json` (already has `enumRefusal`). Each should name the field, say `json` has no equality operator in PostgreSQL, and suggest `Jsonb`. This needs a ticket; check Linear first.
4. Docs: `docs/reference/scalar-types.md` and the `prisma-8` skill reference say to write `Jsonb` unless the input must be kept exactly as written.
5. TML-3790 (SQLite, MySQL and MongoDB convenience types) must not make `Json` a convenience type on any target, for the same reason.
