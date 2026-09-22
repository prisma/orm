# Handover — slice B (PR #30350), 2026-09-22

Written by the orchestrating agent at the end of its session so a fresh agent in a fresh worktree can finish the PR. Read this first, then the transcript, then the ADR and the slice spec.

## Where to read the full context

- Session transcript (JSONL, large; read the last few hundred entries first): `/Users/will/.claude/projects/-Users-will-Projects-prisma-orm--claude-worktrees-literal-types-column-defaults-852235/7027d270-1794-4af8-a493-4a499aa764ed.jsonl`
- Design (authoritative): [ADR 254 - Data types and casts](../../../../docs/architecture%20docs/adrs/ADR%20254%20-%20Data%20types%20and%20casts.md)
- Slice spec and plan: [spec.md](spec.md), [plan.md](plan.md). The spec's "Decisions that scope this slice" and "Amendments made during the rework" are the settled scope.
- Project memory for this work: `/Users/will/.claude/projects/-Users-will-Projects-prisma-orm/memory/literal-types-column-defaults-pr.md`.

## State of the branch and PR

- PR: https://github.com/prisma/orm/pull/30350, base `main`, head branch `remove-dbgenerated-literal-types` on the bot remote (`git@github-wmadden-electric:prisma/orm.git`, remote named `bot`). Push as the bot; never through `origin`.
- Last pushed commit: `d24c1e43ca`. Everything is committed and pushed; the working tree of the old worktree is clean.
- Will (wmadden) has **approved** the PR. Auto-merge is **enabled** (merge queue, squash). All CodeRabbit threads and all three of Will's threads are replied to and resolved.
- The ruleset needs: one approving code-owner review (done), the required checks green, then the queue merges.

## Update after the handover was written

`origin/main` has been merged (merge commit `e4ffcb0d95`, conflict in `descriptor-meta.ts` resolved by dropping the `QueryOperationTypes` import main removed), the four tests from main that lacked `dataTypeLookup` now pass it, and the parity contract is re-emitted with main's two new capability flags. Workspace typecheck and lint are green; CI on the new push is the confirmation. If CI is green the remaining steps are 5 and 6 below.

## What was failing before that (both from the same cause)

CI on `d24c1e43ca` runs against a merge with the current `main`, which has moved by three commits since the branch last merged it (`fc66f544c2` full-text search, `c5a8b5ad52` migration plan changes, `dd867230cd` TML-2566 contract snapshot hashes). Two checks fail:

1. **Fixtures**: `pnpm fixtures:check` shows a diff in `test/integration/test/authoring/parity/default-data-types/expected.contract.json` (the parity pair this slice added).
2. **Integration Tests (2/4)**: `test/authoring/cli.emit-parity-fixtures.test.ts` fails for the same pair with "expected {...} to deeply equal {...}" (three cases, integration and packaging projects).

Locally, at `d24c1e43ca` before merging the new `main`, both were green. The likely cause is main's TML-2566 change to what a contract snapshot carries (or another contract-shape change on main) which the checked-in expected contract predates. `git merge-tree --write-tree HEAD origin/main` also reports conflicts now, so `main` must be merged by hand.

Files that conflict with main (from merge-tree):
packages/3-targets/6-adapters/postgres/src/core/descriptor-meta.ts
Auto-merging docs/reference/error-reference.md
Auto-merging packages/0-shared/publish-surface/src/shells.ts
Auto-merging packages/1-framework/1-core/framework-components/src/exports/authoring.ts
Auto-merging packages/1-framework/1-core/framework-components/src/shared/framework-authoring.ts
Auto-merging packages/1-framework/3-tooling/cli/src/control-api/client.ts
Auto-merging packages/2-sql/2-authoring/contract-psl/src/interpreter.ts
Auto-merging packages/2-sql/2-authoring/contract-ts/src/contract-definition.ts
Auto-merging packages/3-targets/3-targets/postgres/package.json
Auto-merging packages/3-targets/3-targets/postgres/tsdown.config.ts
Auto-merging packages/3-targets/6-adapters/postgres/src/core/descriptor-meta.ts
CONFLICT (content): Merge conflict in packages/3-targets/6-adapters/postgres/src/core/descriptor-meta.ts
Auto-merging packages/3-targets/6-adapters/sqlite/src/core/descriptor-meta.ts
Auto-merging packages/9-public/@prisma/orm-postgres/package.json
Auto-merging packages/9-public/@prisma/orm-target-postgres/package.json
Auto-merging test/integration/test/authoring/attribute-specs.lsp-consumability.test.ts

## What to do, in order

1. Create a fresh worktree from the bot branch: `git fetch bot remove-dbgenerated-literal-types` then `git worktree add ../<name> bot/remove-dbgenerated-literal-types` (or check it out). Run `pnpm install --frozen-lockfile` and `pnpm build`, then `pnpm install --frozen-lockfile` again if `node_modules/.bin/prisma` is missing (see the memory note on fresh worktrees).
2. `git merge origin/main`, resolve the conflicts keeping both intents (the branch's data-type work and main's changes), and run `pnpm typecheck`.
3. Re-emit the parity pair: `pnpm fixtures:emit` (or `pnpm fixtures:check` and inspect the diff). The only expected change is `default-data-types/expected.contract.json`; if any other contract changes, stop and understand why before committing.
4. Full gates, via the `:agent` variants and their logs (`.agents/rules/running-tests.mdc`): `pnpm build`, `pnpm typecheck`, `pnpm test:packages`, `pnpm test:integration` (set `AGENT_CMD_TIMEOUT_SECONDS=2400`), `pnpm test:e2e`, `pnpm lint`, `pnpm lint:deps`, `pnpm lint:docs`, `pnpm lint:throws`, `pnpm lint:framework-vocabulary`, `pnpm check:error-reference`, `pnpm coverage:packages`, `pnpm fixtures:check`, `pnpm check:upgrade-coverage --mode pr`. Known pre-existing flakes: a `useDevDatabase` 5 s hook timeout in one journey, and mongodb-memory-server "port already in use"; both pass when the file is re-run alone.
5. Commit (explicit `git add`, `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`, body ending with the Co-Authored-By line the harness gives you), push to `bot`, and let the merge queue take it. If new review comments appear, address them and reply on the threads.
6. After the merge: close PR #30334 (the ADR's own PR; this branch carries its commits), and update the memory file to say the PR merged.

## Rules that bit during this work

- Will decides design; do not invent vocabulary. Rejected words: "literal types", "accepts" (use "casts"), "spelling", "literal readers/writers", "bunching". A data type is the database type; the family registers no types; casts are declared by the receiving type.
- Write design documents to files, never into chat. Do not push while a design discussion is open.
- Strict assembly is deliberate: a codec without a registered data type is an error.
- The PR title carries no Linear prefix (no ticket exists) and the checklist says so.
