# Slice plan: generate-skill-offer

**Spec:** `projects/agent-native/slices/generate-skill-offer/spec.md`
**Branch:** `tml-2971-s2-one-time-skill-offer-on-prisma-generate`, stacked on
`tml-2968-s1-install-prisma-skills-during-prisma-init` (D5); same implementer worktree
(`agent-native-s1`, dependencies built). Slice PR base = the S1 branch, retargeted to `main`
after S1 merges.

## Dispatch plan

### Dispatch 1: offer module and shared timeout helper

- **Outcome:** `packages/cli/src/utils/skills/skills-offer.ts` exports
  `handleSkillsOffer(): Promise<{ prompted: boolean }>` implementing the spec's gates,
  prompt, persistence, accept path (S1 runner), and telemetry — with `timeout()` extracted
  to `packages/cli/src/utils/prompt-timeout.ts` (and `survey.ts` re-importing it), and
  `packages/cli/src/__tests__/skills-offer.vitest.ts` green: every gate short-circuits,
  timeout defaults to No, accept invokes the (mocked) runner, all four outcomes persist
  `skills-offer.json`, telemetry fires only when prompted, the wrapper never throws.
- **Builds on:** The spec's chosen design + S1's `installSkills` interface (in this branch).
- **Hands to:** A unit-tested `handleSkillsOffer` + shared `timeout()` that Generate wiring
  consumes as a black box.
- **Focus:** The module, the extraction, their tests. No `Generate.ts` changes; `survey.ts`
  touched only for the import swap.

### Dispatch 2: Generate wiring and mutual exclusion

- **Outcome:** `prisma generate` (non-watch, successful, `!hideHints`) calls the offer
  before the NPS survey and skips the survey when `prompted === true`; injectable for tests
  like `surveyHandler`; a Generate-level test pins the ordering and the mutual exclusion;
  packages/cli typecheck + the relevant vitest files green.
- **Builds on:** Dispatch 1's `handleSkillsOffer` interface.
- **Hands to:** Feature-complete offer behavior, fully covered by mocked tests — the state
  Dispatch 3 proves live.
- **Focus:** `Generate.ts` + its tests only.

### Dispatch 3: live TTY evidence

- **Outcome:** The slice-DoD captures exist: under a real pty (`script -qec`), first
  `prisma generate` in a scratch project shows the offer, declining writes
  `skills-offer.json`, a second run stays silent; one accept-path run installs skills via
  S1's runner; a CI-env/non-TTY run shows no prompt. All returned in the report under
  `## Verification evidence` (orchestrator appends to `verification.md`).
- **Builds on:** Dispatch 2's feature-complete behavior; Dispatch 1's persistence shape
  (isolate `env-paths` config dir per run via env, so captures don't pollute the real one).
- **Hands to:** Slice at DoD — PR-open evidence.
- **Focus:** Verification only; code changes only for what the live runs prove broken
  (separate commit + report).

## Sizing

| Dispatch | Size | dispatch-INVEST note                                                             |
| -------- | ---- | -------------------------------------------------------------------------------- |
| 1        | M    | One outcome: tested offer machinery. Extraction is mechanical and consumed here. |
| 2        | M    | One outcome: wired generate. Consumer-side only.                                 |
| 3        | S    | Evidence checklist, binary; worktree already built.                              |

## Handoff completeness

DoD condition 1 (TTY once-ever demo) ← D3; condition 2 (accept live) ← D3; condition 3
(non-TTY silent) ← D3; gate/persistence/telemetry correctness ← D1+D2 tests. CI-green +
reviewer-accept inherited via the slice PR.
