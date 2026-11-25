# Dispatch 5: the last release's example apps against the current build

Issued 2026-11-25 to the implementer (Opus, medium effort). Slice spec: [../spec.md](../spec.md), sections "The last release", "The last release's example apps", "GA only". Trial: [../../../spikes/2026-11-25-break-detection-trials.md](../../../spikes/2026-11-25-break-detection-trials.md); its report and scripts are in `wip/break-spike/apps/` (gitignored, in this worktree).

The design is strong guidance and our best effort, not a fixed spec. Check it against the code as you go. Where you find it wrong, incomplete or worse than an alternative, say so with evidence; do not build what you believe is wrong, and do not depart from it silently.

## Outcome

`pnpm api:examples` takes each app under `examples/` as it was at the last release's git tag and type-checks it, type tests included, against the current build. CI runs it in the `typecheck` job after `pnpm typecheck:examples`. With today's `rc` versions it reports in the job summary and passes; once the last release has a plain version, an error that is not recorded fails the job.

## Requirements

- Use `lastRelease` from `scripts/public-api/last-release.mjs`; do not write a second lookup. Fetch only that tag, with depth 1.
- For each app that exists at the tag: replace its files, apart from `node_modules`, with the tag's (`git archive <tag> examples/<app> | tar -x`); run its step before typecheck where it has one (`prisma7-adoption`, `react-router-demo`; find them from each app's scripts, not a hard-coded list if the scripts say it); run its `tsc --noEmit` directly. Restore the app's current files afterwards, on success and on failure, so a local run leaves `git status` clean. An app that did not exist at the tag is listed as skipped.
- Compile the committed contracts as they were at the tag; never re-emit.
- Records of deliberate changes: an error that the policy allows (an addition that breaks an exact type assertion, an input that is now accepted) or a recorded break is recorded with the release it applies to and a reason, in one file outside every app folder (the app folders are replaced during the run). Choose how an error is identified so that a record stays valid for the life of one release's tag (the tag's files do not change). A record for an earlier release is skipped and listed as removable, never failed. A record that matches no error fails the run.
- Report errors grouped by app and file, with counts, because one deliberate change gave over 1,000 lines in the trial.
- GA rule: use `isPrerelease` from `scripts/public-api/compat.mjs`. Tests can force GA.

## Tests (write them first; each must be able to fail)

With a small fixture app and a small fixture git repository built in the test (not the real tag): an unchanged app passes; a planted change to a result type fails when treated as GA and reports and passes when not; a recorded error passes and a record that matches nothing fails; a stale record is listed as removable and passes; an app missing at the tag is skipped; the app's current files are restored after a failing run.

## Constraints

- Work only in this worktree. Every scratch file under `wip/`. No system temp folders.
- The build in `dist` is current; do not run `pnpm build`.
- Never run a whole test suite. Run only the test files you write, plus lint and typecheck of the touched files and `pnpm lint:workflows`. You may run `pnpm api:examples` over the real apps once at the end, with a hard time limit.
- Hard time limits on long commands (`perl -e 'alarm N; exec @ARGV' …`). Kill only PIDs you started.
- Two other agents may be changing `scripts/public-api/compat*.mjs`, `scripts/public-api/api-compat.mjs`, the `api-compat` job in `ci.yml`, `.github/workflows/api-changes.yml` and `.github/workflows/scripts/api-changes*`. Do not edit those, except to import from `compat.mjs` and `last-release.mjs`. In `ci.yml`, change only the `typecheck` job. In `package.json`, add only your script and your test files. Stage only your own files by path; if `git` reports `index.lock`, wait and retry.
- Commit small, intent-named commits with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`, ending each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push. No destructive git operations; never `git checkout` or `git restore` a tracked file you did not change.
- `pnpm` only; no bare casts in production TypeScript; comments only where code cannot say it.

## Report

Return: what you built, file by file; test results; the run over the real apps (time, per-app result, every error and your judgement of it); the record format; where you departed from this brief and why; what you did not verify.
