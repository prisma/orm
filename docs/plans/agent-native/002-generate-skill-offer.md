# Task: One-Time Interactive Skill Offer on `prisma generate`

## Overview

Offer existing projects (which never ran the new `prisma init`) a one-time, interactive,
time-limited prompt to install the Prisma skills, shown after a successful `prisma generate`.
Reuses the NPS survey infrastructure wholesale: same gating, same timeout pattern, same
persistence location.

## Prior art: the NPS survey

`packages/cli/src/utils/nps/survey.ts` (`handleNpsSurvey`), triggered only from
`packages/cli/src/Generate.ts` after a successful non-watch generate, unless `--no-hints`:

- **TTY**: `isInteractive()` from `packages/internals/src/utils/isInteractive.ts`
  (`stdin.isTTY && TERM !== 'dumb'`), plus a Deno guard.
- **Environment gating**: `isCi()`, `maybeInGitHook()`, `isInNpmLifecycleHook()`,
  `isInContainer()` (all in `packages/internals/src/utils/`), and
  `daysSinceFirstCommand(...) >= 1` via `packages/cli/src/utils/commandState.ts`.
- **Timeout**: `promptTimeoutSecs = 30`; a `timeout()` helper races the readline answer against
  a timer resolving `undefined` (survey.ts:199-210).
- **Persistence**: JSON files under `env-paths('prisma').config` (e.g.
  `~/.config/prisma-nodejs/` on Linux): `nps.json` (acknowledgement) and `commands.json`
  (first-command timestamp).
- **Telemetry**: `PosthogEventCapture` (`packages/cli/src/utils/nps/capture.ts`).

## Design

- New module `packages/cli/src/utils/skills/skills-offer.ts` exposing
  `handleSkillsOffer(): Promise<void>`, mirroring `handleNpsSurvey`'s shape (injectable into
  `Generate` for tests, like the existing `surveyHandler` constructor parameter).
- **Gates**, in order; any failure returns silently:
  1. Not already acknowledged: no `skills-offer.json` in the config dir.
  2. Skills not already present: no `skills-lock.json` and no `.claude/skills/prisma-*` or
     `.agents/skills/prisma-*` in the project.
  3. `isInteractive()`, not Deno, `!isCi()`, `!maybeInGitHook()`, `!isInNpmLifecycleHook()`,
     `!isInContainer()`, `daysSinceFirstCommand(...) >= 1`.
- **Prompt**: a single yes/no question ("Install Prisma's agent skills so AI coding tools work
  better in this project? [y/N]"), 30-second timeout via the shared `timeout()` helper
  (extract it from `survey.ts` into a shared util rather than duplicating). Default and
  timeout answer is No.
- **Persistence**: write `skills-offer.json` (`{ offeredAt, accepted }`) in the same config dir,
  unconditionally after the prompt resolves — the offer fires **once ever per machine**,
  unlike the NPS survey's once-per-timeframe.
- **On accept**: run the shared skill-install runner from task 001 (project-level install into
  the current working directory's project root), streaming its output.
- **Coordination with NPS**: at most one prompt per generate run. If the skills offer fires,
  skip the NPS survey for that run; the survey remains eligible on the next generate.
- **Telemetry**: capture `skills_offer_shown` / `skills_offer_accepted` via the existing
  `PosthogEventCapture` path (decide project key during review).

## Scope

### Files to modify (prisma/prisma)

1. `packages/cli/src/utils/skills/skills-offer.ts` (new) — gating, prompt, persistence.
2. `packages/cli/src/utils/nps/survey.ts` — extract the `timeout()` helper (and possibly the
   readline safety proxy) into a shared module under `packages/cli/src/utils/`.
3. `packages/cli/src/Generate.ts` — invoke the offer next to `handleNpsSurvey` (same
   `--no-hints` / watch-mode / generator-error guards), with the one-prompt-per-run rule.
4. `packages/cli/src/__tests__/` — tests mirroring `nps.test.ts`: each gate, timeout path,
   accept path (runner mocked), persistence write, NPS mutual exclusion.

## Steps

1. Extract shared prompt utilities from `survey.ts`.
2. Implement `skills-offer.ts` with the gates and persistence above.
3. Wire into `Generate.ts` with the mutual-exclusion rule.
4. Tests.

## Acceptance criteria

- The offer appears at most once ever on a developer machine, only on an interactive TTY
  outside CI/containers/hooks, and never together with the NPS survey in one run.
- Declining, ignoring (timeout), or accepting all write the acknowledgement file; no repeat.
- Accepting installs skills into the current project and reports what was written.
- `--no-hints` and watch mode fully suppress the offer.

## Open questions

- Should acknowledgement be per-machine (proposed) or per-project? Per-machine avoids nagging
  across repos; the trade-off is that a user who declines once never hears about it again —
  acceptable, since init (task 001) and the docs remain discovery paths.
- Whether `prisma dev` should also be an offer surface later (out of scope here).
