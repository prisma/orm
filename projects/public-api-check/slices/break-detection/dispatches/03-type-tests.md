# Dispatch 3: type tests generated from the last release

Issued 2026-11-25 to the implementer (Opus, medium effort). Slice spec: [../spec.md](../spec.md), sections "The last release", "Generated type tests", "GA only". Trial: [../../../spikes/2026-11-25-break-detection-trials.md](../../../spikes/2026-11-25-break-detection-trials.md); its full report and working code are in `wip/break-spike/types/report.md` and `wip/break-spike/types/trial/` (gitignored, in this worktree).

The design is strong guidance and our best effort, not a fixed spec. Check it against the code as you go. Where you find it wrong, incomplete or worse than an alternative, say so with evidence; do not build what you believe is wrong, and do not depart from it silently.

## Outcome

`pnpm api:compat` installs the last release of each published package beside the current build and compiles a generated test for each of its own exports, reporting breaks, undecided comparisons and recorded breaks. CI runs it in a new `api-compat` job. With today's `rc` versions it reports in the job summary and passes; once the last release has a plain version, a break fails the job.

## Requirements

- The last-release lookup (spec, "The last release") is a function the example-app check will also call.
- The install goes in a gitignored folder with its own workspace file; third-party versions are taken from the repository's lockfile, not a hand-written list; installed `@prisma/orm-*` copies get a version of their own without touching pnpm's global store.
- Export names come from `readExports` over the release's declarations. Forwarded names are skipped.
- The comparison helper keeps call and construct signatures, turns methods into function-typed properties, and exists once per side. One direction: current assignable to the last release.
- Each generated file ends with a test that must fail; the run fails if it does not.
- TS2589 is reported as undecided.
- Records of deliberate breaks live beside each package's `api.txt` (choose the file name and format; JSON is fine). Each names the import path, the export, the release it applies to and the reason. A record becomes `// @ts-expect-error <reason>`; a record for an earlier release fails the run.
- GA rule: a package is checked strictly when the last release's version has no pre-release part; an export whose name starts with `preview_` or `ea_` is never strict. Tests can force a package to be treated as GA.
- Output: per package, counts and the list of breaks, undecided and recorded; written to the job summary in CI.
- The job reuses the build from the cache as the `Lint` job does, and runs a few packages at a time to stay within the runner's memory.

## Tests (write them first; each must be able to fail)

With small fixture packages under `scripts/public-api/fixtures/` standing in for a release and a current build, treated as GA: removing an export fails; narrowing a parameter fails; narrowing a method parameter fails; adding an optional parameter passes; a new required member on an interface accepted by an exported function fails; a new required member on a type only returned passes; a recorded break passes and fails once undone; a stale record fails; the same comparison with a pre-release version reports and passes; two copies with one version are still compared.

## Constraints

- Work only in this worktree. Every scratch file under `wip/`. No system temp folders.
- First run `pnpm install` and then `pnpm build` once, because the branch moved to a newer `main`. After that, never run `pnpm build` again without need.
- Never run a whole test suite. Run only the test files you write or change, plus lint and typecheck of the touched files, `pnpm lint:deps` and `pnpm api:check`.
- Hard time limits on long commands (`perl -e 'alarm N; exec @ARGV' …`). Kill only PIDs you started.
- Another implementer works in this worktree at the same time on `.github/workflows/api-changes.yml` and `.github/workflows/scripts/api-changes*.mjs`. Do not touch those files. Stage only your own files by path; if `git` reports `index.lock`, wait and retry.
- Commit small, intent-named commits with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`, ending each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push. No destructive git operations.
- Follow the repository's rules: `pnpm` only; no bare casts in production TypeScript; comments only where code cannot say it.

## Report

Return: what you built, file by file; test results; the full run over all packages (time, memory, counts per package, every break and undecided with your judgement of each); where you departed from this brief and why; what you did not verify.
