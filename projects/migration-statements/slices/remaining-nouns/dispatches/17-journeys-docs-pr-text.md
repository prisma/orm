# Dispatch 17: journeys, the ADR number, loose ends, and the PR text

**Plan:** [`../plan-pr3.md`](../plan-pr3.md) · **Spec:** [`../spec.md`](../spec.md) "Done when" · **Builds on:** dispatch 16 · **Branch:** `tml-3537-value-objects-storage`

## Outcome

PR 3 is ready for the two-reviewer `/drive-code-review`. Its journeys show the new behaviour from the CLI, the ADR has a free number, and the PR text is drafted.

### 1. The ADR number

Main already has an ADR 278 ("Each database's packages live in one folder"), and open PRs use 307 and 308. Do these:
- Rename ours to **ADR 309**: `docs/architecture docs/adrs/ADR 309 - Value objects are storage entities, and a discriminator column names a value set.md`.
- Update every reference to our ADR across code comments, docs, the skill, the upgrade fragments and the project files. That is about 44 references. Leave references to the other ADR 278 as they are.
- Add the index row in `docs/architecture docs/ADR-INDEX.md`.
- Before you commit, check again that 309 is free on `origin/main` and in open PRs (`gh pr list --repo prisma/orm --state open --json files`).

### 2. Journeys

Add CLI journeys under `test/integration/test/cli-journeys/`, following the existing journeys and their helpers. Each journey runs through both `migration plan` (then `migrate`) and `db update`, and a later plan is empty (spec "Done when"). Run them on Postgres (PGlite):
- **A value object column on a managed table.**
  - `migration plan` writes the value object check.
  - `migrate` applies it.
  - A row the ORM writes is accepted, and a row with an extra key is refused.
  - `db verify` is clean.
- **Changing a value object.** Add a member, and then make a member nullable. Each one is a storage change. The plan drops the old check and adds the new one. On a table with rows that fit the new shape, the apply works.
- **A row that does not fit.** Adding the check to a table that already holds a bad row fails. The error names the constraint and changes nothing.
- **Adding a variant.** The discriminator check is replaced, and the new variant's value is accepted.
- **A storage change with no operation.** Change a value object used only by an external table's column. `migration plan` writes a migration with no operations, and `migrate` moves the marker.

On MongoDB (mongodb-memory-server), add one journey: a value object change updates the collection validator, as before this PR. This shows that moving value objects into storage did not break Mongo.

### 3. Loose ends from dispatch 16

- `test/integration/test/sql-orm-client/fixtures/contract.ts` patches a built contract to add `Address` to storage. That leaves its `storageHash` stale. Author the value object through a user-facing surface instead (`.agents/rules/no-contract-data-patching-in-tests.mdc`). Or, if no SQL TypeScript surface exists, use the emitted fixture.
- The upgrade script does not write discriminator value set types into snapshot `contract.d.ts` files. Find out whether anything reads them: typecheck an upgraded copy of `prisma-8-demo` under `wip/d16-upgrade/`. If something does, write them. If nothing does, say so in the app fragment.
- On the upgraded copy, `migration plan` asked for `--from`. Find out why. If the project's `db` ref or graph is left inconsistent by the script, fix the script. If the request is expected, say why in the fragment.
- The `mongo-demo` and `retail-store` chains fail `db migrate` on mongodb-memory-server. Check out `origin/main` into a new worktree under `wip/`, and run the same commands there to find out whether this happens on main too. Report the result with the commands. Do not fix it here.

### 4. The PR text

Draft the PR title and description at `wip/pr3-body.md`. Follow `skills-contrib/create-pr/SKILL.md`:
- The title is "TML-3537: " followed by a plain sentence saying what a user can now do or see. No conventional prefix.
- Open with a concrete example: a PSL value object, the `contract.json` before and after, and the Postgres check it derives.
- Then build the explanation step by step.
- State each decision before its alternatives. Put the alternatives last.
- List the upgrade steps.
- Close with the line `Agent: radagast-20` and no AI attribution line.
- Never hard-wrap the prose.

## Rules

- Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`. Run only named files inside `test/integration`, with `pnpm test <file>`, and journeys with `pnpm test:journeys <file>`.
- Use `mise exec --` for node and pnpm. Never `npx`.
- Do not write to `/tmp` or any system temp directory. Save slow output under `wip/` and read the file.
- Never use bare `git stash`.
- Write tests first.
- No comments where the code can say it. No bare `as` casts in production code. No `any`.
- Never hard-wrap Markdown prose. ADRs carry no ticket ids or dispatch names.
- Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution lines. Stage files explicitly.
- Do not push. Do not open a PR.

## Done when

- The new journeys pass.
- The enum value journeys, the namespace journeys and the plans-with-no-operations journeys still pass.
- `fixtures:check`, `lint:deps`, `lint:ratchets`, `check:error-reference` and `check:upgrade-coverage --mode pr --prev $(git merge-base HEAD origin/main) --head HEAD` pass.
- Typecheck, lint and `test --coverage` pass in every touched package.

## Report

Plain English, short sentences. Cover:
- the ADR renumbering;
- each journey and what it shows;
- each loose end and its answer;
- where the PR text is;
- the checks;
- the commits.
