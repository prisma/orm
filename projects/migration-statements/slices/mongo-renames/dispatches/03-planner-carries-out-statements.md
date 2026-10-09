# Dispatch 3 — The MongoDB planner carries out renames and deletes

**Slice:** [`../spec.md`](../spec.md) § Decisions, § How it works · **Plan:** [`../plan.md`](../plan.md) dispatch 3 · **Builds on:** dispatches 1 and 2

## Outcome

`migration plan` and `db update` on MongoDB rename collections and fields from `--rename`, and ask about a removed field, which `--delete` answers by removing it from every document. The temporary refusal (`renameStatements`, `keepDataByHand`) is gone.

## What to build

1. **Collection rename.** A model statement whose collection name changes renames the collection in the working copy of the origin schema before the diff (`mongo-planner.ts`, `planCalls`), and plans one `renameCollection`. Indexes and the validator then diff as usual.
2. **Field rename.** A field statement plans one `renameField`. For a variant's field, `filter` is `{ <discriminator field>: <variant value> }`, read from the base model (`discriminator.field`, `variants.<Name>.value`; a variant's `fields` hold only its own fields). A statement whose stored names do not change plans nothing and reports applied with no operations.
3. **Field removal is data loss.** A field present in the origin model and absent from the destination, on a collection that is not dropped, plans one `unsetField` (with the variant filter for a variant's field) and reports a `field` subject in `dataLoss` (with `loss: 'drop'` once slice 3a's loss kinds are on `main`). Without an origin contract the subject is `{ kind: 'storage', name: '<collection>.<field>' }`. The question offers `rename` and `delete`.
4. **Order.** Collection renames, collection creates, index drops, rewrites (renames and removals), index creates, validator changes, option changes, collection drops. Plans with no statements and no removed fields are unchanged; prove it with the existing planner tests passing untouched.
5. **Refusals** (`statementRejected`, reason named): renaming or removing `_id`; a field whose stored name contains `.` or starts with `$` (MongoDB reads it as a path or an operator; `@map` can produce one); renaming a model stored in a time-series collection or a view; a collection rename onto a name the working schema already has; a field stored on one side only; any statement when the control policy is not `managed`.
6. **`appliedStatements`** count only the rename or rewrite each statement accounts for.
7. **Delete the temporary refusal.** The `renameStatements` member in `control-migration-types.ts`; MongoDB's setting in `control-target.ts`; `keepDataByHand`, `keepTheData` and `NOT_IN_THIS_RELEASE` in `mongo-planner.ts`; `keepDataByHandFor` and its parameter in `plan-questions.ts`; the reads in `db-run.ts` and `migration-plan.ts`. Keep the unrelated `renameStatements()` helper in `statement-text.ts`.
8. **After slice 3a merges** (if it has by then): resolved statements have a `kind`. Carry out `kind: 'rename'`; refuse `convert` and `backfill` as 3a's MongoDB code does today.

## Not in this dispatch

Journeys, docs, ADR amendments and upgrade fragments (dispatch 4).

## Tests

- Planner unit tests for each item above, rewriting `mongo-planner.statements.test.ts` and `db-update-statements.test.ts` (both assert the old refusal), and the `keepDataByHand` cases in `mongo-planner.data-loss.test.ts`.
- CLI tests that used `keepDataByHand` or `renameStatements` (listed in `wip/grounding-4a.md` § 7 in the parent worktree).
- Against mongodb-memory-server, through the planner and runner: a model rename and a field rename with a unique index on the field and a closed validator; a field removal; a variant field rename where another variant stores a field with the same name, which keeps its value.

## Halt conditions

Stop and report if the working-schema rename cannot happen before the diff without changing the shared schema IR; or if removing a field from a variant cannot be told apart from removing it from the base in the diff.

## Gate

The plan's gate, plus `pnpm lint:framework-vocabulary`, `pnpm check:error-reference`, and the named files `test/integration/test/cli-journeys/delete-statements-migration.mongo.e2e.test.ts` and `mongo-db-update-consent.e2e.test.ts` (S4 of the first now succeeds instead of refusing).
