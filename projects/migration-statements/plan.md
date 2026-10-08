# Project plan — Migration statements

**Spec:** [`spec.md`](./spec.md) · **Linear:** [Destructive changes need stated intent](https://linear.app/prisma-company/project/destructive-changes-need-stated-intent-7626c0107cd9), plan issue [TML-3474](https://linear.app/prisma-company/issue/TML-3474) · **Shaping PR:** prisma/orm#30604 · **Working branch:** `tml-3474-migration-statements`

## Summary

Four slices. The first three stack: the statement surface with renames, then the refusal and consent model, then the scaffolded verbs and the remaining nouns. The fourth, Mongo, builds on the second and runs in parallel with the third. Each slice is one PR, stacked on the working branch until the shaping PR merges and then retargeted to `main`.

## Slices

### Slice 1 — Statements on the command line, and renames of models and fields on Postgres and SQLite

**Linear:** [TML-3475](https://linear.app/prisma-company/issue/TML-3475) · **Folder:** `slices/renames/`

**Outcome.** Both commands accept `--rename old:new` for models and fields, with a model rename across namespaces resolved but refused until slice 3. The framework parses each statement, resolves it against the origin and destination contracts, and applies it in order to a working copy of the origin. The SQL planners emit the table or column rename and every companion rename, with names from the destination contract. `db update` resolves its origin contract from the marker hash through the snapshot store and fails every rename when it cannot. An unusable statement is an error. Non-data drops are widening. The written migration is what a user could write by hand.

**Builds on.** The planner substrate from prisma/orm#30570, without its contract section.

**Hands to.** A statement type the framework owns, parsed and resolved, delivered to every family planner as resolved entities; the working-copy mechanism statements apply to; the origin-contract resolution for `db update`; a column rename operation on both SQL targets.

### Slice 2 — Both commands refuse data loss by default, and `--delete` is the per-operation consent

**Linear:** [TML-3476](https://linear.app/prisma-company/issue/TML-3476) · **Folder:** `slices/refusal/`

**Outcome.** `migration plan` refuses any plan that loses data, with the error `db update` uses. The refusal lists each destructive operation with the statements that resolve it. `--delete` consents to one operation, for namespaces, models and fields, and replaces `--confirm` on both commands. The terminal consent question asks per operation. Upgrade fragments record both changes; the CLI README describes statements and consent.

**Builds on.** Slice 1. Two things slice 1 leaves for it: the missing-origin check in the CLI statement resolver runs over the whole input and must move inside the per-statement loop so that `--delete` works without an origin contract; and the `@@map`-only rename gap in `deferred.md` must be decided before the refusal text is written. Decided 2026-10-07 on prisma/orm#30638: dropping a row-level-security policy and disabling row-level security stay `widening` (they lose no data), and slice 2 adds a separate consent question before `db update` applies an operation that widens who can read or write rows, answered per operation like the data-loss consent and refused in a non-interactive run unless consented.

**Hands to.** The refusal shape every later verb hooks its statements into; the per-operation consent model; `--confirm` gone.

### Slice 3 — Convert and backfill scaffold the placeholder migration, and the remaining nouns

**Linear:** [TML-3477](https://linear.app/prisma-company/issue/TML-3477) · **Folder:** `slices/convert-backfill/`

**Outcome.** `--convert` scaffolds the type change with the placeholder in the slot that carries the conversion, and `--backfill` the backfill transform; both refused on `db update`; the scaffolding stops being automatic. `--rename` on enum values, namespaces and value object fields, a model move across namespaces (`alter table set schema` on Postgres, deferred from slice 1 on 2026-10-06 because no operation existed for it), and `--convert` on a variant, plan the row updates, the JSON rewrites and the schema rename. `--delete` on an enum value nulls where nullable, else refuses.

**Builds on.** Slice 2.

**Hands to.** Project close-out for the SQL targets.

### Slice 4 — The same statements on MongoDB

**Linear:** [TML-3478](https://linear.app/prisma-company/issue/TML-3478) · **Folder:** `slices/mongo/`

**Outcome.** The Mongo planner takes the same resolved statements: collection rename, document rewrites for field and value object field renames, drops and unsets for deletes, a data transform scaffold for convert, under the slice 2 refusal and consent model. No family vocabulary enters the framework.

**Builds on.** Slice 2.

**Hands to.** Project close-out for Mongo.

## Stretch goal — interactive statements when a human runs the command

Recorded 2026-10-06 at the operator's request. This is the eventual direction, and the slices build with it in mind so that it drops in on top of their mechanisms; it is not a slice of its own, and it is built once the mechanisms it needs exist (after slice 2 at the earliest).

When `migration plan` or `db update` detects a destructive operation and no statement covers it, the command today refuses and prints the statements that would resolve it. The stretch goal: when the command is run by a human in a terminal (stdin and stdout are a TTY, and no `--json` or similar non-interactive flag is set), the refusal becomes an interactive prompt that asks, per destructive operation, what the user means: rename it to a name they type, or delete it. Each answer is exactly the statement the refusal would have printed, applied in order, and the plan then proceeds as if the statements had been given on the command line. In a script, an agent, or CI (no TTY) the behaviour stays as it is: refuse and print the statements.

Rules that carry over unchanged: the prompt never guesses or proposes a rename candidate; it asks. The statements are not recorded anywhere; the migration file or the database is the record. The consent model of slice 2 (`--delete` per operation) is what the "delete" answer maps to.

What the slices do now so this drops in later (see the spec's cross-cutting requirement 12):

- The refusal is a structured value first and text second: a list of destructive operations, each with the entity it touches in domain coordinates and the statements that would resolve it, rendered to the error message by the command. The prompt consumes the same list.
- Statement text is parsed, resolved and applied through one function the command calls, which takes the statement strings and the two contracts and does not care whether the strings came from the command line or from an answer typed at a prompt. Statements can therefore be added after the command has started and the plan re-run.
- The per-operation consent question that `db update` already asks in a terminal is the seed of this prompt, so slice 2 keeps it as a per-operation question rather than folding it into a yes/no over the whole plan.

## Sequencing

- **Stack:** slice 1 → slice 2 → slice 3.
- **Parallel:** slice 4 runs beside slice 3 once slice 2 has merged.

## Dependencies

- Nothing external. The shelved prisma/orm#30570 is a source to copy from, not a dependency; its branch stays as a draft.
- Users get the feature through the next published CLI release after slice 2 merges; slices 1 and 2 together are the minimum that changes behaviour a user sees.

## Close-out (required)

- [ ] Verify every project DoD item in [`spec.md`](./spec.md)
- [ ] Write the ADR and amend ADR 001, ADR 028 and the Data Contract and Migration System subsystem docs
- [ ] Migrate long-lived docs into `docs/`
- [ ] Strip repo-wide references to `projects/migration-statements/**`
- [ ] Delete `projects/migration-statements/`
