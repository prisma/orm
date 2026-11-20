# Slice: generate-skill-offer

_(Parent project `projects/agent-native/`. Outcome: existing projects get exactly one polite,
interactive, time-limited offer to install the skills catalog on `prisma generate`.)_

## At a glance

After a successful interactive `prisma generate`, the CLI asks once — ever, per machine —
whether to install the Prisma agent skills, reusing the NPS survey's gating, timeout, and
persistence machinery, and S1's install runner on acceptance. At most one prompt per generate
run: the offer preempts the NPS survey.

## Chosen design

New module `packages/cli/src/utils/skills/skills-offer.ts` exposing
`handleSkillsOffer(): Promise<{ prompted: boolean }>`, injectable into `Generate` like the
existing `surveyHandler` constructor parameter. The entire body is wrapped never-throws —
an offer failure must never fail `generate`.

**Gates, in order; any failure returns `{ prompted: false }` silently:**

1. No acknowledgement: `skills-offer.json` absent from `env-paths('prisma').config` (the
   directory `nps.json` lives in).
2. Skills not already present in the project: no `skills-lock.json` and no
   `.claude/skills/prisma-*` / `.windsurf/skills/prisma-*` / `.agents/skills/prisma-*`
   under `process.cwd()`. If present,
   write the acknowledgement with outcome `already-installed` and return (never scan again).
3. `isInteractive()` (from `@prisma/internals`), not Deno (same guard/rationale as
   `survey.ts` — readline on Deno blocks generate), `!isCi()`, `!maybeInGitHook()`,
   `!isInNpmLifecycleHook()`, `!isInContainer()`, `daysSinceFirstCommand(...) >= 1`.

**Prompt:** one yes/no question ("Install Prisma's agent skills so AI coding tools work
better with this project? (y/N)"), 30-second timeout via the `timeout()` helper extracted
from `survey.ts` into a shared module (`packages/cli/src/utils/prompt-timeout.ts`); default
and timeout mean No.

**Persistence:** write `skills-offer.json` (`{ offeredAt, outcome }`, outcome ∈ `accepted` |
`declined` | `timeout` | `already-installed`) unconditionally after the prompt resolves —
once ever per machine, unlike NPS's per-timeframe acknowledgement.

**On accept:** run S1's `installSkills({ cwd: process.cwd() })`, streaming output; on
`{ ok: false, manualCommand }` print the same non-fatal warning pattern as init.

**Generate wiring:** in the non-watch success path where `handleNpsSurvey` runs (gated by
`!hideHints`), call the offer first; if it prompted, skip the NPS survey for this run (the
survey stays eligible next run). Same injectability-for-tests approach as `surveyHandler`.

**Telemetry:** one event, `skills_offer_resolved` `{ outcome, cliVersion }`, emitted through
the existing `PosthogEventCapture` path and NPS project key, only when a prompt was actually
shown (not for `already-installed`). Unit-tested via injected capture; no live PostHog in
tests.

## Coherence rationale

One reviewable unit: one new module plus one extracted helper, wired at a single Generate
call site, with tests. The runner it calls is S1's, unchanged.

## Scope

**In:** `packages/cli/src/utils/skills/skills-offer.ts` (new);
`packages/cli/src/utils/prompt-timeout.ts` (new; `survey.ts` re-imports from it);
`packages/cli/src/Generate.ts` (offer invocation + NPS mutual exclusion);
`packages/cli/src/__tests__/skills-offer.vitest.ts` (new) and a `Generate`-level test for
the mutual-exclusion rule; minimal touch to `packages/cli/src/utils/nps/survey.ts` (import
the extracted helper only).

**Out:** any NPS behavior change beyond skip-this-run; the init path (S1); per-project
acknowledgement (per-machine is the project working position); new telemetry keys or
consent flows; watch mode and `--no-hints` paths (both stay fully suppressed).

## Pre-investigated edge cases

| Edge case                                            | Disposition                                                                                                                        | Notes                                                 |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Readline on Deno blocks `generate`                   | Deno guard identical to `survey.ts`                                                                                                | Known from the NPS implementation's own comment       |
| Config-dir write failure (read-only HOME, sandboxes) | Whole offer is never-throws; a failed acknowledgement write means the offer may repeat next run — acceptable over failing generate | NPS `writeConfig` has no such guard; do not copy that |
| Two prompts in one run (offer + NPS)                 | Offer runs first; `prompted === true` skips NPS this run                                                                           | Designed-in mutual exclusion                          |

## Slice-specific done conditions

- [ ] Live TTY demonstration (e.g. under `script -qec` for a pty): first `prisma generate`
      in a scratch project shows the offer; declining writes `skills-offer.json`; a second
      run shows no prompt. Captured for the PR description.
- [ ] Accept path demonstrated live once: skills land in the project via S1's runner.
- [ ] Non-TTY / CI-env run shows no prompt (capture).

## Open Questions

1. Telemetry key reuse (NPS project key) vs a dedicated key. Working position: reuse — no
   new secrets or config; review may override before release.

## References

- Parent project: `projects/agent-native/spec.md`; task draft
  `docs/plans/agent-native/002-generate-skill-offer.md`
- Linear: [TML-2971](https://linear.app/prisma-company/issue/TML-2971/s2-one-time-skill-offer-on-prisma-generate)
- NPS machinery: `packages/cli/src/utils/nps/survey.ts` (gates, timeout, persistence),
  `packages/cli/src/utils/nps/capture.ts`, `packages/cli/src/utils/commandState.ts`,
  `packages/cli/src/Generate.ts` (`surveyHandler` injection, `--no-hints` gating)
- S1 runner: `packages/cli/src/init/skill-install.ts` (branch
  `tml-2968-s1-install-prisma-skills-during-prisma-init`; this slice stacks on it, D5)
