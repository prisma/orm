# State: convenience date and time types on SQLite, MySQL and MongoDB (2026-10-30, iris-50)

Linear: TML-3714. Spec, plan and slice specs are beside this file; decisions are in the spec and ADR 314 and ADR 315.

## Slices

All four slices are implemented, reviewed with `/drive-code-review` (both passes, until no finding was left open) and pushed to the `bot` remote. Each branch is stacked on the one before it.

| Slice | Linear | Branch | State |
| --- | --- | --- | --- |
| 1. `@internal/type-implementations` and SQLite | TML-3780 | `tml-3714-type-implementations-and-sqlite` | prisma/orm#30922, CI green, waiting for Will's review |
| 2. MySQL | TML-3787 | `tml-3714-mysql` (slice 1 merged in) | no PR yet: opened after #30922 is reviewed |
| 3. MongoDB TypeScript builder takes `type.*` | — | `tml-3714-mongo-type-helpers` (from `main`) | no PR yet |
| 4. MongoDB convenience types | — | `tml-3714-mongo` (slices 1, 2 and 3 merged in) | no PR yet |
| 5. Close-out | — | — | after the slice PRs merge |

Open the PRs in order 1, 2, 3, 4, each after the one before is reviewed. After a base PR squash-merges, merge `main` into the next branch (never rebase).

## Decisions made in this session

- `dataTypeId` on the SQL family's `DefaultResolverColumn` stays; publishing `@internal/type-implementations` inside `@prisma/orm-framework` stays; MySQL gets its full table.
- MongoDB's builder copies the typed-helper code into the MongoDB family, because the framework does not hold helpers two families share only for reuse.
- MySQL writes are cut to the column's precision; a column with no written precision holds whole seconds; `Duration` is `varchar(191)`; the timestamp `Date` codec is `mysql/timestamp-date@1`.
- MongoDB's calendar date has its own data type, `mongo/calendar-date`, written as a plain string (no tag: tag names are unique per target and `date` is the instant's).
- Prisma 6's MongoDB `DateTime @db.Date` stays an instant (`mongo/date@1`): Prisma 6 stores the full instant there. The earlier claim that it stored midnight UTC was wrong.
- The MongoDB query builder keeps sending values as given; codec-encoded builder values are TML-3788.

## Follow-ups filed

TML-3781 to TML-3785 (earlier), TML-3786 (MySQL codec test kit), TML-3788 (MongoDB query builder values). Deferred items are in `deferred.md`.

## Known unrelated failures

- `@prisma/orm-target-postgres`'s `cross-shell-tarball` test fails locally when the npm registry refuses `@vercel/detect-agent` ("trust downgrade").
- `test/ports/prisma/functional/driver-adapters-error-forwarding` fails on `main` too (an `it.fails` case now passes).
