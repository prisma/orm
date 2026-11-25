# Dispatch 2: trial of the last release's example apps against the current build

Issued 2026-11-25 to a spike implementer (Opus, medium effort). Slice: [../spec.md](../spec.md). Project design: [../../../spec.md](../../../spec.md), section "Result types: the last release's example apps".

## Question

A query's result type is worked out from the user's contract and query, so it can change while every exported declaration stays the same. The design is that CI compiles the example apps as they were at the last release, with their type tests, against the current build, so that a pull request cannot edit an app to fit a break. Can that work here, and how? The design is our best effort, not a fixed spec: if the trial shows it is wrong or a better way exists, say so with evidence.

## What to find out

1. **The last release.** Which git tag or commit is the last release (tags look like `v8.0.0-rc.25-dev.9`; check what was published to the registry), and how CI would find it.
2. **How the apps resolve packages.** The apps under `examples/` depend on packages as `workspace:8.0.0-rc.25`. Find how to take an app's files as they were at the last release and have them resolve `@prisma/*` to the current build, without changing the repository's workspace or lockfile. Consider at least: a `git worktree` of the tag with the current `dist` linked in; copying the old app into `wip/` with a `node_modules` that links to the current packages; TypeScript `paths`. Say which is cleanest for CI.
3. **Which apps and checks.** Which apps have type tests (13 files, mostly in `examples/prisma-8-demo`) and what their typecheck command is. Do the apps need their contract emitted first, and does that need a database? A contract emitted by the old release's tooling or by the current one?
4. **A working trial.** Do it for `examples/prisma-8-demo` at the last release, under `wip/break-spike/apps/` only. Report whether it compiles cleanly against the current build, every error if not (each classed as a real change since the last release, or caused by the method), and the time.
5. **A planted break.** Show that a change to a result type is caught, without touching `dist` (another trial reads it at the same time): for example, point the old app at a copy of one package's declarations under `wip/` in which a result type is changed.
6. **Cost in CI.** What the CI job would need: checkout depth, install, build reuse from the cache, time.

## Constraints

- Work only inside this worktree, and put every file you create under `wip/break-spike/apps/`. A `git worktree` of the tag, if you use one, also goes under that folder, and you remove it at the end. No system temp folders.
- Do not run whole test suites, in any package or app. Run only the typecheck and the type test files of the app under trial. Do not run `pnpm build`: the build in `dist` is current, and another trial is reading it at the same time.
- Every long-running command gets a hard time limit. Kill only processes you started, by PID.
- No destructive git operations, no commits, no pushes. `git status` must be clean at the end apart from gitignored files.
- If a step proves impossible, stop that step, report why, and carry on with the rest.

## Report

Write `wip/break-spike/apps/report.md`: the answers to each question, the numbers, the commands you ran, and what you did not verify. Return a short summary with the recommendation first.
