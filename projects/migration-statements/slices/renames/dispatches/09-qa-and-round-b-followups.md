# Dispatch 9 — Manual QA findings and round B follow-ups

**Slice:** [`../spec.md`](../spec.md) · **Branch:** `tml-3475-statement-renames` · **Tier:** Opus · **Inputs:** `../../manual-qa-reports/2026-10-07-qa-opus.md` (F1–F11, with exact commands and outputs) and `../reviews/system-design-review.md` § Round B verification (R1–R4, S08 nit). Read both.

## QA findings

- **F1 (blocker).** No error text may advise a step that drops data. `STATEMENT_ORIGIN_UNKNOWN` must not say "run the command without statements" unless it also says that plan drops the old table with its rows and asks for consent; prefer giving only the route that works (F2).
- **F2.** The same error explains why there is no snapshot (the earlier `--db` run did not advance a ref) and gives the route the QA run verified: store the old contract first with `db update --db <url> --advance-ref <name>` run against the old contract, then run the rename. Say that adding `--advance-ref` to the failing command does not help, and that `migration plan --from` does not apply to `db update`.
- **F3.** The MongoDB field advice must not leave documents half-moved: say that a collection validator or unique index on the field has to be changed before `$rename` can move the values, and order the steps so they work (check them against `MongoMemoryReplSet` the way QA did). If no short recipe is safe, say what must be handled and stop there.
- **F4.** When the delta leg refuses a statement, `migration plan` writes nothing, including the automatic baseline. Plan every leg before writing any package. If that is more than a small change, stop and report.
- **F5.** A second `db update` with the same statements says the database already has the new names (the old name is missing from the origin and the new name is present), so the statement should be dropped.
- **F6.** No user-facing text or JSON shows the internal namespace id `__unbound__`: describe an entity in the unbound namespace by its bare name, and leave `namespaceId` out of JSON for it or decide one documented rendering. Check the CLI output, the error texts and `describeMigrationStatement`.
- **F7.** Every `STATEMENT_INVALID` / `STATEMENT_UNRESOLVED` case says what to type: the accepted forms for syntax errors, and for a reversed statement, a swap, an identity rename, and a field statement placed before its model statement, the statement or order that would work.
- **F8.** The `@@map` refusal says how to follow it: emit an intermediate contract with only the table change, run `prisma migration new` with `...this.renameTable({ ... })`, then plan the field rename.
- **F9.** When a plan with statements also has placeholders, the human output still lists the operations and `Statements applied`, and the JSON's `operations` and `appliedStatements` agree.
- **F10.** The extension upgrade instructions say what a planner that cannot carry out statements must do (refuse a non-empty list with `statementRefused`, never ignore it), when a planner sets `refusedStatement`, the import path of each new type, and what the `appliedStatements` detection misses.
- **F11.** The skill's MongoDB rename workaround matches the CLI advice (mongosh, not `migration.ts`), and its error-code table lists the three `MIGRATION.STATEMENT_*` codes.

## Round B follow-ups

- **R1.** `operationIds` assumes ids are unique in a plan, and Postgres rename and drop ids omit the schema. First find whether operation ids are persisted or compared anywhere beyond `ops.json` (runner, ledger, marker, attestation, migration hash). If they are, refer to a statement's operations by position in the plan instead of id. If they are not, add the schema to every Postgres id that names a table without it and regenerate the fixtures. Either way, state the uniqueness rule where operation ids are defined and test two same-named tables in different namespaces.
- **R2.** One origin type: `MigrationPlan.origin` and the `Migration.origin` getter use `PlanOrigin | null`; `PlanOrigin` gains optional `profileHash`.
- **R3.** Remove from framework doc comments any statement about MongoDB's current behaviour; in particular the `FieldCoordinate` doc must not settle the Mongo field-name question `deferred.md` leaves to slice 4.
- **R4.** Rename `StatementCall` to a name for what it is (a call that carries companion calls), since the hand-written facade uses it too.
- **S08 nit.** `SqlMigration.providedInvariants` reads operations through `Migration.readOperations(this)`.

## Gate and rules

As dispatch 8. Re-run the QA commands for F1, F2, F5, F6, F7 and F9 through the built CLI and paste the new output in the hand-back. Small signed `TML-3475:` commits; no attribution lines; no push; no destructive git.
