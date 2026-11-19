# Plan: scalar convenience types

Spec: [spec.md](spec.md). The PostgreSQL part was approved by Will on 2026-11-02. Will accepted the `Json` and other-target design and names on 2026-11-17.

## Slices

Each slice is one PR, branched from `main`. A slice starts only after the one before it has merged.

| # | Slice | Linear | State |
| --- | --- | --- | --- |
| 1 | PostgreSQL `Int`, `BigInt`, `Float`, `Decimal`, `String`, `Boolean`, `Bytes`; explicit renames with deprecated aliases; ADR 316 | TML-3715 | Merged, prisma/orm#30942 |
| 2 | PostgreSQL `Json` as a convenience type that defaults to `json`; explicit name `PlainJson`; `jsonColumn` renamed; `sql.String` renamed `sql.Varchar`; ADR 316 amended; the duplicate ADR 316 renumbered | TML-3789 | Merged, prisma/orm#31065 |
| 3 | MongoDB convenience types; `Int`, `Float` and `Boolean` stop being deprecated; the deprecation warning fires wherever a deprecated name is written; `type.Int64()` removed with an upgrade instruction; new ADR with the shared rules and MongoDB's table | TML-3790 | Merged, prisma/orm#31067 |
| 4 | SQLite convenience types and explicit renames; new `Boolean` and `Decimal` codecs; column helpers renamed; shared decimal and boolean value code | TML-3790, TML-3562, TML-3782 | In progress |
| 5 | MySQL convenience types for all eight names, with the codecs it lacks: bigint as number, float, double, decimal, boolean, bytes and JSON; the plain-JSON check shared with MongoDB | TML-3790, TML-3783 | Not started |
| 6 | Close-out: final retro, definition-of-done evidence, long-lived docs checked, this folder deleted | TML-3715 | Not started |

Slice 2 reuses the closed prisma/orm#30966 (branch `tml-3789-json-convenience-type`) as a reference: it already declares the type choice and `PlainJson`. The default flips to `json`, and everything that handled a contract change is left out.

MongoDB comes before SQLite and MySQL because it is a released target; the other two are proofs of concept. MySQL is last and largest, because it needs new codecs. Another session is building MySQL's query rendering in the same target, so slice 5 merges main before it starts and again before it is queued.

## Per slice

1. Implementation dispatches, on Opus, split as below. Every slice is still one PR.
2. `/drive-code-review` without the walkthrough, on Fable, then fixes, repeated until clean.
3. Manual QA with the real CLI on the pushed tip.
4. Hand the PR to Will.

Dispatches per slice:

- **Slice 2:** (a) renumber the duplicate ADR 316, as its own commit; (b) `Json`; (c) `sql.Varchar`.
- **Slice 3:** (a) the deprecation warning in every place, with tests and no type changes; (b) type choices, renames, `type.Int64()`, fixtures, docs, ADR, upgrade instructions.
- **Slice 4:** (a) renames, type choices and column helpers over existing codecs; (b) the `Decimal` codec, shared decimal code, `BigIntNumber`, the journey test and upgrade instruction; (c) the `Boolean` codec.
- **Slice 5:** (a) probe a live MySQL and MariaDB server and fill the codec table in the spec; (b) type choices and explicit names over existing codecs; (c) `Int8Number`, `Float4`, `Float8`, `NumericString`; (d) `Bool`, `Longblob`, `PlainJson`, MariaDB; (e) docs, ADR, example app, upgrade instructions. Merge main before each dispatch.

Each slice names a new folder under `upgrade-instructions/pending/`.

The architect and principal engineer design reviews of 2026-11-17 are in `reviews/` (not tracked). Both were satisfied with changes; the spec and this plan include those changes.

## Tracker work, outside the slices

- A ticket for clearer errors where a PostgreSQL `json` field hits a limit.
- Correct the closing comment on prisma/orm#30966 and the description of TML-3789, which say `Json` gets no convenience type.
- Branch `tml-3789-json-stays-explicit` holds a handover and a decision record that this spec replaces. It is not merged.

## Follow-ups to file at close-out

- The deprecation warner exists in both the SQL and MongoDB PSL interpreters (`deprecated-type-names.ts` in each) because a shared home would be the framework; move it to `@internal/psl-parser/interpret` when a framework change is allowed.
