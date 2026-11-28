# Dispatch 53 (MongoDB): fixes from review round 35, QA round 22 and CodeRabbit's third follow-up

**Inputs.**
- **Review:** `projects/migration-statements/slices/stored-name-renames/reviews/pr2-round-35/`: F01 to F04 in `code-review.md`, and A87 to A90 in `system-design-review.md`. Three of the design findings repeat findings from elsewhere:
  - A87 is the same finding as F02 and QA 43.
  - A89 overlaps F01 and QA 44.
  - A88 and A90 are separate findings.
- **QA:** findings 43 and 44 in `projects/migration-statements/manual-qa-reports/2026-11-27-qa-stored-names-mongo-round-22.md`.
- **CodeRabbit:** the last entry in `wip/coderabbit/inline-4.md` (comment 4715646485), with the orchestrator's view under it.

**Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/migration-statements-handover-494725`. **Branch:** `gandhi-65/tml-3840-mongo-stored-name-renames`. **Tier:** Opus, medium effort.

Keep your notes in `wip/mongo-stored-names/d38-progress.md`, under the heading "Dispatch 53". The rules of dispatch 28 hold:

- run only the test files you change, one per command;
- change nothing under `packages/1-framework` beyond `3-tooling/cli`;
- no AI attribution in commits;
- do not push;
- you may build.

Run every heavy command through `lockf -t 3600 /Users/Shared/claude-shared/heavy-command.lock <command>`.

## The decisions (made by the orchestrator)

**A database whose policy permits only `migrate`** (F02, A87, QA 43). The runner already receives the database's policies.

- Offer the `db sign` route only where the policy permits `reconcile`.
- Where it does not, say plainly which routes remain. Writing `ops.json` again applies only if no other database has applied the migration, and dropping applies only if the collection holds nothing the user needs. When neither applies, say that this database's change policy permits no recovery for this create.
- Never suggest changing the policy or `--permit-policy-change`. ADR 320 explains why: an agent that has run out of ideas acts on whatever the error offers it.
- This case is already a dead end on `main`, which has no after-check on any create. This PR does not make it worse, so stating the fact is enough.
- Make the same change in the error reference and the upgrade note.

**How to tell that a source document was copied** (F01, A89, QA 44, CodeRabbit).

- Replace the rule "same `_id` and same values in the fields the copy does not change" with a query the runner prints. The query runs the copy's own stages for that group on the source documents. It then lists each source document whose result has no identical document in the target with the same `_id`: compare the whole document, after the stages.
- The user deletes from the source only the documents the query does not list. A document that was updated in a renamed field after the copy is then listed and kept.
- Say plainly that a source document whose result is identical to a document already in the target counts as copied. Its content is in the target under the same `_id`, so the only thing lost is a second identical copy. A user who must keep identical duplicates keeps the source and reconciles it by hand.
- Live tests:
  - a copy that renames a field, where the source's renamed field is updated after the stop;
  - a target that already holds an identical document.

## Fix

1. Carry out both decisions.
2. **A88.** Say what `db sign` checks on MongoDB: collections, validators and indexes, not documents. Also say that `migration status` then shows the migration as applied.
3. **A90.** Set `copyCounts` to undefined before the count read.
4. **F03.** In the count-read test, give the copy an empty reply, not a fake "changed nothing" reply, and assert `databaseUnchanged: false`.
5. **F04.** Make the sentence in the error reference about a failed count read match the code.

Then update the error reference and the upgrade note. List the lines of `wip/mongo-stored-names/pr-body.md` that need to change, but do not edit that file.

## Done when

- `mise exec -- pnpm build` is clean.
- `pnpm api:check` passes.
- Typecheck and lint pass in `@internal/target-mongo`.
- `lint:deps`, `lint:ratchets`, `lint:docs` and `check:upgrade-coverage` pass.
- Every test file you change passes, each run on its own.

## Report

Write plain English, and keep it short:

- for each item, what changed and which test failed first;
- the commits;
- each check, with its result.
