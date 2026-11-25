# Manual QA: the checks against the last release

Who uses this: a contributor, human or agent, whose pull request changes what a published package exports. End users of Prisma 8 see no change, because nothing published changes. The QA confirms each check reacts to a real change in source code, built as CI builds it, and that the contributor guide is enough to act on what it reports.

Run on the pull request's head after `pnpm install` and `pnpm build`. Work in this worktree; put every scratch file under `wip/qa/`. Revert every change to tracked files at the end and confirm `git status` is clean. Never run whole test suites. Record each step's command, its output (shortened) and pass or fail in the report.

## Local steps

1. **Setup.** `git status` is clean, `pnpm api:check` passes, and `pnpm api:compat --only @prisma/orm-extension-middleware-cache` exits 0 and says the last release is a pre-release. Pass if all three hold.
2. **A break in source.** In the source behind `@prisma/orm-extension-middleware-cache`, make the `options` parameter of `createCacheMiddleware` required. Run `pnpm build`, then `pnpm api:compat --only @prisma/orm-extension-middleware-cache`. Pass if it reports a break of `createCacheMiddleware` on path `.`, marked as reported only, and exits 0; and if the same with `--ga` exits 1 and names the same break.
3. **Recording it.** Following only `docs/Public API Compatibility.md`, record the break in the package's `api-breaks.json`. Pass if `--ga` now exits 0 and lists the break as recorded.
4. **Undoing it.** Revert the source change, `pnpm build`, run with `--ga` again with the record still there. Pass if it fails and says the record no longer matches a break. Remove the record.
5. **A compatible change.** Add an optional second parameter to `createCacheMiddleware`. Build and run with `--ga`. Pass if it reports no break. Revert and build.
6. **The example apps.** `pnpm api:compat:examples --only prisma-8-demo` exits 0. Then change, in source, a result type that the app's type tests at the last release assert (find one from `examples/prisma-8-demo/test/` at the last release's tag), build, and run again with `--ga`. Pass if it fails and names the app, the file and the error, and if `git status -- examples` shows no change to the app's own files. Revert and build.
7. **The guide.** Read `docs/Public API Compatibility.md` and the `api-changes` failure message produced by `node .github/workflows/scripts/api-changes.mjs` in its tests or a dry run. Pass if a contributor could act on each failure from the text alone.

## On a real pull request (the orchestrator runs these)

8. Push a commit that adds an export to a published package and its updated `api.txt`. Pass if the `API changes` check posts one comment listing the added line and fails, naming the export.
9. Add an `## API changes` section to the description naming the export with a reason. Pass if the check runs again and passes, and the comment is edited, not posted a second time.
10. Revert the commit. Pass if the comment is edited to say no list changes, and the check passes.

## Cleanup

11. Revert all source changes, `pnpm build`, `pnpm api:check`. Pass if the lists match and `git status` is clean.

## Report

Write `projects/public-api-check/manual-qa-reports/<date>-<runner>.md` with each step's result. Name each problem found as a finding (`Q01`, `Q02`…), with what you did, what happened and what you expected.
