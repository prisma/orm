# Dispatch 2 — Statement grammar and resolver in the framework

**Slice:** [`../spec.md`](../spec.md) · **Plan entry:** [`../plan.md`](../plan.md) § Dispatch 2 · **Branch:** `tml-3475-statement-renames` · **Tier:** Opus

## Task

Add to the framework CLI package a parser for `--rename <old>:<new>` statement text and a resolver that turns parsed statements into resolved statements against an origin contract and a destination contract, following every rule in the slice spec's § Grammar and § Resolution. Add `statements: readonly ResolvedStatement[]` to the framework planner input and pass `[]` at every place the input is constructed.

## Outcome

After this dispatch, any later code can take the raw strings a user typed after `--rename`, and get back either an ordered list of resolved statements in domain coordinates, or one of the three errors the spec names, without any family or target code having run. The invariant: resolution speaks only contract vocabulary (namespace, model, field) and never storage (table, column, schema), so the framework stays family-blind and the same resolver serves Postgres, SQLite and later Mongo.

## Scope

**In**

- `packages/1-framework/3-tooling/cli`: the statement parser, the resolver, their types, and their unit tests. Export the resolved statement type and the resolve function from the control API (the package's `src/control-api/` area, exported through whatever the package uses as its control API entry) so dispatch 5 can call it from the two commands.
- `packages/1-framework/1-core/framework-components/src/control/control-migration-types.ts`: `MigrationPlannerInput` gains `statements: readonly ResolvedStatement[]`, required. Put the `ResolvedStatement` type where the planner input can see it (framework-components is below the CLI package, so the type lives in framework-components and the CLI package imports it; the parser and resolver stay in the CLI package).
- Every construction site of `MigrationPlannerInput` passes `statements: []` (use `git grep` to find them all, including tests and the Mongo target, which must still compile).
- The three error codes `MIGRATION.STATEMENT_INVALID`, `MIGRATION.STATEMENT_UNRESOLVED` and `MIGRATION.STATEMENT_ORIGIN_UNKNOWN` declared wherever the CLI package declares its `MIGRATION.*` codes (start from `packages/1-framework/3-tooling/cli/src/utils/cli-errors.ts` and `src/control-api/types.ts`). The error-reference doc entry for each code is dispatch 5's job unless the code declaration mechanism forces the doc entry now; if it does, write it.

**Out**

- Declaring `--rename` on `migration plan` or `db update` (dispatch 5).
- Anything in `packages/2-sql`, `packages/3-targets` or the Mongo target beyond adding `statements: []` where the planner input is built (dispatch 3 and 4).
- Resolving the origin contract for `db update` (dispatch 5). `MIGRATION.STATEMENT_ORIGIN_UNKNOWN` is declared here and thrown by the resolver when it is given statements and no origin contract; the caller supplies the hash and directory for the message, so give the resolver a way to receive them.
- Changing the slice spec or plan. If a rule in the spec cannot be implemented as written, stop and report; do not improvise.

## The rules to implement (from the slice spec, restated here so the brief is self-contained)

Grammar:

- A statement is one string `<old>:<new>`. Each side is a coordinate of one to three segments separated by `.`: `Model`, `namespace.Model`, `Model.field` or `namespace.Model.field`.
- Invalid, `MIGRATION.STATEMENT_INVALID`: no `:`, more than one `:`, an empty segment, more than three segments on a side. The message quotes the statement and lists the four accepted forms.
- Both sides must have the same depth once resolved: model to model or field to field. Model on one side and field on the other is `MIGRATION.STATEMENT_INVALID`.
- Names match exactly, including case.

Resolution:

- Resolution runs in the framework against the origin contract and the destination contract and produces domain coordinates: namespace id, model name, and field name when present. Never a table or column.
- A two-segment side is read both as `namespace.Model` and as `Model.field`. Exactly one reading resolving is that reading. Both resolving is `MIGRATION.STATEMENT_UNRESOLVED` naming both readings. Neither is `MIGRATION.STATEMENT_UNRESOLVED` naming both attempts.
- A side without a namespace resolves when exactly one namespace of the relevant contract declares the model; several is `MIGRATION.STATEMENT_UNRESOLVED` listing the qualified candidates. The default namespace is not special.
- Model rename `A:B`: `A` must be a model of the origin; `B` must be a model of the destination; `B` must not be a model of the origin; `A` must not be a model of the destination. Each failure is `MIGRATION.STATEMENT_UNRESOLVED` naming the contract searched and the names found there. `A` and `B` may differ in namespace, name or both.
- Field rename `M.a:N.b`: `M` and `N` must resolve to the same destination model; a field rename naming two different models is `MIGRATION.STATEMENT_INVALID` saying a field cannot move between models. The origin counterpart of that model is the origin model an earlier `--rename` in the same list renamed to it, or else the origin model at the same coordinate. `a` must be a field of the origin counterpart; `b` must be a field of the destination model; `b` must not be a field of the origin counterpart; `a` must not be a field of the destination model.
- A model coordinate may name a variant; it resolves like a model. A coordinate naming a value object, or a field of one, is `MIGRATION.STATEMENT_UNRESOLVED` saying value object renames are not supported in this release. A relation field resolves like any field.
- Statements resolve against the application contract space only; a name that exists only in an extension space is unresolved.
- Statements are resolved in the order given; the output preserves that order.
- With one or more statements and no origin contract: `MIGRATION.STATEMENT_ORIGIN_UNKNOWN`, before anything else.

Resolved statement shape: ordered; each carries kind `rename`, entity `model` or `field`, the origin domain coordinate and the destination domain coordinate. Choose field names that read as domain vocabulary. The resolver must not depend on the SQL family or any target package.

## Edge cases and dispositions

| Case | Disposition |
| --- | --- |
| Swap `A:B` then `B:A` | Second statement unresolved: `A` exists in the origin. Resolution reads contracts, not a working copy. Test it. |
| `A:B` then `A.x:B.y` | Invalid: the second statement's two models do not resolve to the same destination model (`A` is not in the destination). Test it. |
| `A:B` then `B.x:B.y` | Valid: origin counterpart of `B` is `A`, so `x` is looked up in origin `A`. Test it. |
| Contract with one namespace, bare `Model` | Resolves through the sole namespace. |
| Contract with two namespaces both declaring `User`, bare `User` | Unresolved, candidates listed as `ns.User`. |
| `a.b` where `a` is a namespace with model `b` and also a model `a` with field `b` | Unresolved, both readings named. |
| Destructive git operations | Forbidden without orchestrator approval: no `git clean`, `git reset --hard`, `git stash drop/clear`, `git checkout -- .`, `rm -rf` on the worktree. The stash stack is shared with other sessions; never `git stash`. |
| F24 / F31 stale `dist` | Run `mise exec -- pnpm build` before trusting a red typecheck or test in this worktree; it was created fresh today. |
| F14 lint not run | `pnpm lint` per touched package is a separate CI job; run it. Typecheck must cover `test/**`. |
| F26 class, not instance | If the reviewer names a class of defect, sweep the whole diff for it. |

## Where to look first

- The slice spec § Grammar and § Resolution, and the project spec's § Place in the larger world for coordinates (ADR 221, ADR 224, ADR 223) and extension spaces.
- How the CLI package reads a contract's namespaces, models, fields, variants and value objects today: `packages/1-framework/3-tooling/cli/src/control-api/operations/plan-resolution.ts` and `migration-plan.ts` show where the origin and destination contracts are in hand.
- How `MIGRATION.*` error codes are declared and thrown: `src/utils/cli-errors.ts`, `src/control-api/types.ts`, and the existing `MIGRATION.DESTRUCTIVE_CHANGES` code as the worked example.
- The repo rules: `CLAUDE.md` golden rules (arktype not zod, no `any`, no bare `as` outside tests, `blindCast`/`castAs` from `@internal/utils/casts`, tests before implementation, test names omit "should", `ifDefined` for optional keys, `pathe` not `node:path`, test files under 500 lines).

## Validation gate

Run every command through `mise exec --` (for example `mise exec -- pnpm typecheck`). Save long output to a file under `wip/` and read the file; do not re-run to grep different lines.

1. Pre-flight, before any change, to confirm the branch you inherit is green: `mise exec -- pnpm build`, then `mise exec -- pnpm typecheck`, then `mise exec -- pnpm --filter @internal/target-postgres --filter @internal/target-sqlite --filter @internal/family-sql test` (adjust the filter names to the real package names). Report the result as its own line. If something is red and it is not yours, report it and stop; do not fix it.
2. End of dispatch: `mise exec -- pnpm typecheck`; `mise exec -- pnpm --filter <each touched package> lint`; `mise exec -- pnpm --filter <each touched package> test`; `mise exec -- pnpm lint:deps` (imports change); `mise exec -- pnpm lint:framework-vocabulary` and report its count against the branch's count before your change (it must not rise).
3. Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all` in full.

## Completed when

- The parser and resolver exist in the framework CLI package with unit tests covering every rule and every edge case in the two tables above, and the tests fail if the rule they cover is removed (check at least two by removing the rule and watching the test go red, then restore it).
- `MigrationPlannerInput.statements` exists and every construction site passes `[]`; the whole workspace typechecks.
- The three error codes are declared.
- No family or target vocabulary was added under `packages/1-framework` (the resolver names namespaces, models, fields; never tables, columns, schemas, collections).
- The validation gate is green, and the report lists each command and its result.
- Work is committed on `tml-3475-statement-renames` in small intent-named commits, each with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`, subject prefixed `TML-3475:`. No "Co-Authored-By" or "Generated with" lines. Do not push.

## Operational

- Heartbeat: append a line to `wip/heartbeats/implementer.txt` every 10 minutes or at each phase change, in the form `ts=<ISO> phase=<short> note=<short>`.
- Time-box: about two hours. If you are past that with the resolver still incomplete, write a heartbeat saying so and finish the parser and the planner input change first.
- Halt and report instead of improvising when: a spec rule cannot be implemented as written; the contract types do not expose something the rules need (for example, which models are variants or value objects); a change outside the in-scope files is needed to compile.
- Stay inside this worktree: `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/prisma-orm-pr-transcripts-7cfc03`. Do not read or write other checkouts.

## Return shape

1. What was built, by file, in three to eight lines.
2. The validation gate table: command, result.
3. The two "remove the rule, watch it fail" checks you did.
4. Decisions you made that the spec did not pin, each with the alternative you rejected.
5. Anything you could not do, and why.
6. The list of commits (`git log --oneline` of your commits).
