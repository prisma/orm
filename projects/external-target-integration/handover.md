# Handover: a database target built outside this repository works with `init` and generated files

Written 2026-11-19 by the session `isildur-87`, before a rate limit. Read this file first, then the files it points to.

## Context sources

- **Previous session's transcript** (full history, including every design call and Will's words): `/Users/will/.claude/projects/-Users-will-Projects-prisma-orm--claude-worktrees-prisma-orm-pr-31008-ffaaf9/a3fbd48f-9c50-4764-8b36-9acf8ebc20fe.jsonl`. Will's messages: `jq -r 'select(.type=="user" and (.message.content|type)=="string") | .message.content' <file>`.
- **Project docs** in this folder: [spec.md](spec.md) (purpose, definition of done), [plan.md](plan.md) (the three pull requests), [sql-server-team.md](sql-server-team.md) (the instructions for the outside team), and one spec per slice under [slices/](slices/).
- **Decision records:** `docs/architecture docs/adrs/ADR 324 - Generated files import from the module the target package names.md` and `ADR 325 - init gets everything about a target from the target package.md`. Also read `ADR 323 - Prisma 8 is not a package manager and does not second-guess one.md` and `ADR 219 - Database driver coupling …md`, which shaped how `init` installs.
- **Author guide:** `skills/prisma-8/references/build-a-target-package.md`.
- **Gitignored files in the old worktree** `/Users/will/Projects/prisma/orm/.claude/worktrees/prisma-orm-pr-31008-ffaaf9/`: `projects/external-target-integration/learnings.md` (lessons, copied below), the review files under `projects/external-target-integration/slices/*/reviews/`, and `wip/` (briefs, the CodeRabbit triage of the merged `init` pull request). Copy what you need; they are not in git.

## The goal

A team at Microsoft is building a SQL Server target for Prisma 8 in their own repository. An application on their package must get the same `prisma orm init` and the same generated files as an application on `@prisma/orm-postgres`, with nothing about SQL Server in Prisma's repository. Two rules from the spec: a Prisma 8 extension is installed one way (add the package, import it in `prisma.config.ts`), and Prisma's own targets get no path an outside target lacks.

## Where it stands

| Change | State |
| --- | --- |
| Generated `contract.d.ts` and `migration.ts` import from modules the target package's config names (`contract.typesModule`, `migrations.module`) | Merged, prisma/orm#31078, 2026-11-18. TML-3830 and TML-3143 closed. Not yet in a release: rc.24 predates it. |
| `init` writes the project from the target package's init contribution (`<package>/init`, typed `InitContribution` from `@prisma/orm-toolchain/cli/init-contribution`) | Merged, prisma/orm#31093, 2026-11-18. TML-3702 closed. `--target` still takes only `postgres` and `mongodb`. |
| `init --target` accepts any package name (TML-3831) | **In progress** on branch `tml-3831-init-any-package`, pushed to the `bot` remote. No pull request yet. See "The open slice". |
| The SQL Server team's instructions | `sql-server-team.md` is up to date for #31078. Will sends it; do not contact the team. |

Linear project: P-TML-1170. Follow-up tickets in it: TML-3876 (migration operations name their module with a fixed string each renderer replaces), TML-3877 (the kinds of type declaration are listed by hand in two packages), TML-3878 (two components binding one local type name from different modules are not refused), TML-3879 (the publish workflow does not check module names a package states as data), TML-3881 (`init` does not install a target package's other required peers, `temporal-polyfill` and `@types/pg`). TML-3876, 3877 and 3879 need Will's decision before work (framework or CI changes).

## The open slice: `init --target <any package>`

Spec: [slices/any-package-name/spec.md](slices/any-package-name/spec.md). Ticket TML-3831 (In Progress). Implementer brief: `wip/briefs/any-package-name-implementer.md` in the old worktree (copy it).

Decided, recorded in ADR 325 (Consequences): `init` cannot learn an unlisted package's drivers before installing it and must not read the registry, so an unlisted package's first install is the package and `dotenv`; the package manager handles its required peers; the contribution's `peerPackages` go into the later install. A listed package keeps its drivers in the first install. `--target` is validated with `validate-npm-package-name`, not a regex.

Commits on the branch: the spec and ADR update; the author guide and the CLI doc sections (written by the orchestrator); then the implementer's commits: `--target` takes any package name, SQLite and MySQL init contributions, a SQLite journey cell that runs a query, the stand-in packaging test running `init --target <stand-in>`, and CLI README and error-reference docs. The implementer was stopped mid-task for the rate limit; any `wip:` commit on the branch is its unfinished work. Check `git log origin/main..HEAD` and its last report below.

Left to do on this slice:

1. Read the implementer's last commits and finish what it left (its report is appended at the end of this file if it arrived in time).
2. Write the upgrade instructions: `upgrade-instructions/pending/<name>/app/instructions.md` (`--json` gains `package`; `target` is the package name for an unlisted package; any new error code) and `…/extension/instructions.md` (facade changes in SQLite and MySQL require an extension declaration; `pnpm check:upgrade-coverage --mode pr --prev origin/main --head HEAD` checks it). Follow `skills-contrib/record-upgrade-instructions/SKILL.md`.
3. Check the `prisma` CLI repository (prisma/prisma-cli) for tests of `orm init`'s flags and JSON output; the plan says they may need the same update.
4. Run `/drive-code-review` (two reviewers, Opus at high effort), fix the findings, repeat until clean; then manual QA (below); then open the pull request with the `drive-pr-description` skill, `Agent: <name>` above the attribution line.
5. Close-out of the whole project after it merges: see plan.md § Close-out (move the durable parts of `sql-server-team.md` into the author guide and delete the rest, strip references to this folder, delete the folder, final retro).
6. After a release contains #31078 and this slice, tell Will so he can send the SQL Server team the version.

## How to verify by hand (manual QA)

Build (`pnpm build`), then in a scratch folder under `wip/` (never `/tmp`): make a `package.json`, symlink a built package from `packages/9-public/@prisma/<name>` into `node_modules/@prisma/<name>` with an **absolute** path, and run `node <repo>/packages/1-framework/3-tooling/cli/dist/bin.mjs orm init --target <…> --authoring psl --skip-install --no-interactive`. Cases used for the merged slice: Postgres PSL, MongoDB TypeScript, package not installed, a package with no `init` entrypoint (link `orm-sqlite` under the `orm-postgres` name; now that SQLite has an entrypoint, use `orm-mariadb`), `--probe-db` against a refused port, and against a TCP listener that never answers (should give up at 20 seconds). For this slice add: `--target @prisma/orm-sqlite`, `--target @prisma/orm-mysql`, an invalid name, and `--json` output.

## How to work here (rules that cost corrections before)

- **Execution mode:** design with Will, then work silently through slice, `/drive-code-review`, fixes, manual QA, and bring the result to him. Make engineering calls yourself and record them in the pull request. Interrupt only for an invalidated design, a framework-domain change he has not directed, or an irreversible step. Messages to Will: plain English, no ticket numbers or coined terms as the only description, one question with a recommendation, no question UI.
- **Subagents:** implementers on Opus at medium effort, reviewers on Opus at high effort; pass both explicitly. Docs (ADRs, specs, guides, PR text, upgrade instructions) are written by the orchestrator, never delegated.
- **Tests:** never run `pnpm test:integration`, `test:e2e`, `test:all` or `test:packages`, or a pattern sweep of integration files. Run only the named files, from inside `test/integration` with `pnpm test <path>`. Pull request CI skips integration tests on purpose; the merge queue runs them. Never kill processes by pattern.
- **Git:** stage by path; commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"` and end messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push with `git push bot <branch>`. `gh pr edit` fails with the bot token; update a body with `gh api -X PATCH repos/prisma/orm/pulls/<n> -F body=@<file>`. Turn on Auto-fix for every pull request; after approval, auto-merge is on and the queue runs; watch the queue with a background loop on `mergeQueueEntry`.
- **Hooks:** a Bash command whose text contains the bare name of the other package manager is refused; write such text with the Write tool. Running `biome` or `vitest` directly is refused; use `pnpm lint` / `pnpm test`.
- **Review comments:** verify every reviewer and CodeRabbit claim in the code or the library's source before acting; reply on each thread with what changed and resolve it. Never state as fact something you have not checked.
- **Framework domain** (`packages/1-framework`): changes need Will's decision. He directed the config members, the init contribution interface and the CLI's loader; ADR 324 and 325 record them.

## Lessons from this project (from the gitignored learnings file)

- Use the glossary's words from the first draft (`docs/glossary.md`: target, target package, extension).
- A decision record states rules, not open questions.
- A bare `git commit` commits everything staged; in a worktree shared with a subagent, commit with an explicit path and check `git show --stat`.
- Do not split a change where the first half breaks what the second repairs; check each hand-off against what an application sees.
- "Nothing emitted changes" claims need checking against every way a file is emitted.
- State the boundary of "fix the class" by what the code feeds (text of a generated file versus plan order or hashes).
- A brief asking for "a check on every pull request" must say not to change the CI workflow.
- Read the code before filing a ticket about it; four tickets were rewritten after the fact.
- When merging main, re-read every changed contract: main made `pg` a required peer of `@prisma/orm-postgres` mid-slice, which reversed an accepted decision about install order.
- Prefer letting the platform do the work (Node's own resolution in a child process) over a library or hand-written copy of its rules; both differed from Node.

## The implementer's last report (summarised)

All its work is committed (no `wip:` commit): `9a4fcd07f4`, `d0d66bac1b`, `2adfcd2c29`, `db5d12955b`, `778c29f470`. The seven acceptance criteria each have a passing test: `test/packaging/standin-target.test.ts`, `cli.init-templates.e2e.test.ts` (new contract hashes recorded), the CLI's `init-unlisted-target.test.ts`, `test/commands/init/input-values.test.ts`, `init-prisma7-output.test.ts`, and the init journey with a SQLite cell that runs a query (`RUN_INIT_JOURNEY=1`, 108 tests). CLI and SQLite/MySQL facade tests, typecheck and lint pass; `lint:ratchets` (139), `lint:deps`, `check:error-reference` pass.

Not run to the end: `pnpm fixtures:check` and `test/integration/test/cli.init-target-packages.test.ts`. Run both first.

Its decisions, to check in review:

- `--target` also matches a listed package by its exact package name: `--target @prisma/orm-postgres` resolves as `postgres`, with `pg` in the first install.
- Names are checked with `validate-npm-package-name`'s `validForNewPackages`, so names with capital letters are refused. It is a dependency of the CLI and of `@prisma/orm-toolchain`. An invalid value is `CLI.INIT_INVALID_FLAG_VALUE` with `problems` in its meta.
- An unlisted package with a Prisma 7 schema is refused (`CLI.INIT_PRISMA7_TARGET_MISMATCH`, or `CLI.INIT_PRISMA7_PROVIDER_UNSUPPORTED`).
- The picker's extra entry is "Another target package". Human output has no `package` row.
- SQLite and MySQL contributions have no `peerPackages`, `serverRequirement`, `probe` or `readme`. SQLite's `DATABASE_URL="./dev.db"` is a path relative to where commands run; `prisma.config.ts` passes it as `db.connection` and `db.ts` as `path`.
- It changed the integration package's `pretest` build filter to include `@prisma/orm-sqlite` and `@prisma/orm-mysql`. That affects CI; review it.
- The stand-in package's `runtime` and `static` re-export `@prisma/orm-postgres`, and its `defineConfig` now takes `db` and an optional `output`.
