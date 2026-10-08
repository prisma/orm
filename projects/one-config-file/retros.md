# Retros

## 2026-10-05 · Final retro (mandatory at project close)

**Trigger.** Project close. Three slices merged; two side fixes found by the slice 3 proof merged or open.

**What happened against what was planned.**

- The design settled in one session with Will on 2026-09-30 and did not change during execution. Every open question in the brief was resolved there, and the grounding passes before each slice replaced guesses with file-level facts; the one public API change (the programmatic operations taking `config`) came from grounding, not from the spec, and was raised to Will at the right time rather than discovered at review.
- The slice 3 proof from the real `prisma` binary against a project outside the workspace found a user-facing defect (`DEPLOY.ALCHEMY_BIN_MISSING` in plain pnpm projects) that no unit test or workspace run could have shown. The cross-repository proof the brief demanded earned its cost.
- The one process failure: a branch-only CI flake was "fixed" by serialising suites in `ci.yml` on a hypothesis, and the same test failed again. Root cause was a race in the test plus a test that never exercised its named behaviour, in a package the project did not touch. Lesson landed as `drive/calibration/failure-modes.md` § F39 and in agent memory.
- Guardrail-bot change requests stay "changes requested" after their findings are fixed and the bot re-reviews clean; they block merge until dismissed. Routine now: dismiss with a note once the re-review reports no new findings.
- Release ordering across three repositories worked as planned: engine untouched, Composer 0.26.0 published from the slice 2 merge, host 8.0.0-rc.20 pinned to it, web docs last.

**Deferred, with homes.**

- Command-line teardown and logs (`branch delete`, `service logs`): recorded in `projects/consolidate-clis/` as the grammar project's work.
- Dropping the `effect` pin once `effect` 4 is stable or Alchemy pins its peer: raised with Alchemy's maintainer on 2026-09-30.
- The dependency-cruiser exclusion of `prisma.config.ts`: recorded in ADR-0049 in prisma/composer.
- Local Postgres instance names including the registry root; the crash-supervision test's time budget: listed in prisma/composer#333's description.
