# Slice: nothing breaks for a project on the current release candidate

Settled with the operator on 2026-11-27. Same pull request as [slice-required-capabilities-list.md](slice-required-capabilities-list.md). This brief is our best effort: the goal is fixed, the mechanism is open. If the code shows a simpler or more correct way, do that and say why.

## Goal

A project exactly as the last release candidate left it, with its config, its contract source and its emitted `contract.json` unchanged, keeps working after it upgrades to a release that has this pull request: it type-checks, it emits, and it runs queries and `transaction()`. It may get warnings that tell it what to change. It gets no error and no type error.

Today the pull request breaks such a project in at least two ways, and manual QA saw a third thing that is not explained.

## 1. A missing list gets a default, and emit says what to add

When `requiredCapabilities` is missing (not when it is empty, not a list, or holds a bad entry; those stay refusals), the PostgreSQL facade uses the newest version's list and the driver's, which is what `init` writes. This holds in `defineContract`, in the config's contract entry for a Prisma schema, in `prisma7Schema`, and in `postgresContractCapabilities`. The contract's type carries the default's keys, so `transaction()` and the other type-level checks work as if the author had written the list.

`prisma contract emit` then prints one warning that says the contract's required capabilities were not listed, that the default was used, and exactly what to add: the line and its import, produced by the same node `init` uses to write it (`packages/3-targets/postgres/9-facade/src/init/contract-entry.ts`), not a second copy of the text. It is a warning with a code, in the error reference, and it does not change emit's exit code. It must come from emit: loading a TypeScript contract file anywhere else prints nothing. Find how a contract source already hands warnings or diagnostics to emit and use that channel; if there is none that fits without changing `packages/1-framework`, stop and report what it would take.

This is a stopgap. The warning and the default are removed, and the list becomes required again, no later than `8.0`. Say so in the doc comment of the option and in the warning's error reference entry. Wording of the warning follows the project's terms: a contract *requires* capabilities; never "requires no".

## 2. An emitted `contract.json` from the release candidate keeps type-checking and starts without a warning

Earlier commits on this branch removed capability flags that nothing read: `postgres.orderBy`, `postgres.limit`, `postgres.lateral`, `postgres.jsonAgg`, `sql.enums`, and the extension flags `pgvector.cosine`, `postgis.geometry` and `paradedb/bm25` (verify the exact set against `git diff $(git merge-base HEAD bot/main)...HEAD` and the release candidate's emitted contracts; there may be more). A release candidate's `contract.json` still lists them, so the client's connection check reports each as required but not provided: a type error where the client is created (`StackProvides`) and a warning at start.

Make those keys known as retired, declared by the component that owned them (the PostgreSQL target for its own, each extension for its own, if that fits how extension descriptors are composed; otherwise the target, with the reason), and have the client's check ignore a retired key, at type level and at run time. A retired key gates nothing. It disappears from a contract when it is emitted again. Check also that signing ignores them.

## 3. A test that takes a release candidate project as it is

Add a test that uses a small project's config, contract source and emitted `contract.json` and `contract.d.ts` exactly as the last published release candidate produced them (take them from the tag, `git show <tag>:<path>`, for one Prisma schema project and one TypeScript contract project; commit them as fixtures with a note of the tag they came from, and never regenerate them), and proves the goal: it type-checks against this branch's packages, emit succeeds with the warning from part 1, the client is created with no warning from the connection check, and a query and a `transaction()` run. Put it where the repository's tests of that kind live, and make sure pull request CI runs it (CI skips the integration tests on pull requests; if the only fitting home is there, say so and add the type-level and emit parts somewhere CI does run).

Manual QA reported that an example app taken whole from the merge base did not work on this branch because of its `contract.json` ([reviews/required-list-manual-qa.md](reviews/required-list-manual-qa.md), step 8). Find out exactly what breaks, whether this pull request or something else causes it, and fix it if it is this pull request's. Report it either way. Also confirm, do not assume, that a release candidate's contract lists `sql.interactiveTransactions`; if it does not, `transaction()` breaks for those users and that needs its own fix.

## Docs you update

The upgrade instructions (the list is now recommended, with the warning, not required), the facade README, the error reference, and docs/reference/capabilities.md. The orchestrator updates the decision record, the spec and the plan; leave those.

## Rules for the work

- Tests first. Read `CLAUDE.md` and `.agents/rules/`. No `any`, no bare `as`, no comments where code can say it, no hard-wrapped markdown.
- Under `packages/1-framework`, nothing may change without the operator's approval. If part 1's warning cannot reach emit without it, stop and report.
- **This machine is shared by many agent sessions in two accounts, and it crashed on 2026-11-26 when several ran heavy commands at once.** Every build, install, typecheck, lint, `api:*` command and test runs as `lockf -t 3600 /Users/Shared/claude-shared/heavy-command.lock <command>`. Never run a whole test suite or a whole-repository check: run the test files you touch plus typecheck and lint of the packages you touch. `pnpm build` after changing exported types, `pnpm api:update` and `pnpm fixtures:emit` are each allowed once at the end if needed, under the lock. Save long output under `wip/`, never `/tmp`.
- Stay inside this worktree. Do not push. Commit in small steps with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`, staging files by name, each message ending `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Report back

What you built for each part and where it differs from this brief; the exact warning text; the retired keys and who declares them; what the QA failure in step 8 was; whether a release candidate contract lists `sql.interactiveTransactions`; which CI job runs the new test; the checks you ran and their results.
