# Plan: scalar convenience types

Spec: [spec.md](spec.md). The PostgreSQL part was approved by Will on 2026-11-02. The `Json` and other-target parts await his review.

## Slices

Each slice is one PR, branched from `main`. A slice starts only after the one before it has merged.

| # | Slice | Linear | State |
| --- | --- | --- | --- |
| 1 | PostgreSQL `Int`, `BigInt`, `Float`, `Decimal`, `String`, `Boolean`, `Bytes`; explicit renames with deprecated aliases; ADR 316 | TML-3715 | Merged, prisma/orm#30942 |
| 2 | PostgreSQL `Json` as a convenience type that defaults to `json`; explicit name `PlainJson`; `jsonColumn` renamed; ADR 316 amended; the duplicate ADR 316 renumbered | TML-3789, reopened with this scope | Not started |
| 3 | MongoDB convenience types; `Int`, `Float` and `Boolean` stop being deprecated; the deprecation warning fires wherever a deprecated name is written; new ADR for the other targets' tables | TML-3790 | Not started |
| 4 | SQLite convenience types and explicit renames; new `Boolean` and `Decimal` codecs; `sql.String` renamed `sql.Varchar` | TML-3790, TML-3562 | Not started |
| 5 | MySQL convenience types for all eight names, with the codecs it lacks: float, double, decimal, boolean, bytes and JSON; decimal text handling moves to the shared package | TML-3790, TML-3782 | Not started |
| 6 | Close-out: final retro, definition-of-done evidence, long-lived docs checked, this folder deleted | TML-3715 | Not started |

Slice 2 reuses the closed prisma/orm#30966 (branch `tml-3789-json-convenience-type`) as a reference: it already declares the type choice and `PlainJson`. The default flips to `json`, and everything that handled a contract change is left out.

MongoDB comes before SQLite and MySQL because it is a released target; the other two are proofs of concept. MySQL is last and largest, because it needs new codecs. Another session is building MySQL's query rendering in the same target, so slice 5 merges main before it starts and again before it is queued.

## Per slice

1. One implementation dispatch, on Opus: declarations, tests, fixtures, docs, ADR and upgrade instructions change together.
2. `/drive-code-review` without the walkthrough, then fixes, repeated until clean.
3. Manual QA with the real CLI on the pushed tip.
4. Hand the PR to Will.

## Tracker work, outside the slices

- A ticket for clearer errors where a PostgreSQL `json` field hits a limit.
- Correct the closing comment on prisma/orm#30966 and the description of TML-3789, which say `Json` gets no convenience type.
- Branch `tml-3789-json-stays-explicit` holds a handover and a decision record that this spec replaces. It is not merged.
