# Slice plan: init-skill-install

**Spec:** `projects/agent-native/slices/init-skill-install/spec.md`
**Branch:** `tml-2968-s1-install-prisma-skills-during-prisma-init` (cut from `origin/main`;
dispatches execute in isolated worktrees; slice PR targets `main` and excludes `projects/`
and `drive/` files).

## Dispatch plan

### Dispatch 1: skill-install runner module

- **Outcome:** `packages/cli/src/init/skill-install.ts` exists and exports `detectRunner(cwd)`
  and `installSkills({ cwd })` per the spec's Chosen design (pinned `SKILLS_CLI_VERSION`,
  agent list, `--yes` on the npx path, never-throws failure shape), with a new
  `packages/cli/src/__tests__/skill-install.vitest.ts` passing locally: command assembly for
  npm/pnpm/yarn/bun, the no-`package.json` fallback to npm, and the
  `{ ok: false, manualCommand }` failure shape.
- **Builds on:** The spec's chosen design.
- **Hands to:** A unit-tested runner interface (`installSkills`, `detectRunner`, exported
  constants) that Init wiring consumes without touching the runner's internals.
- **Focus:** The module and its unit tests only. No `Init.ts` changes; no real network
  execution in tests (execa mocked or injected).

### Dispatch 2: Init wiring and integration tests

- **Outcome:** `prisma init` calls `installSkills` after scaffolding unless `--no-skills`
  (flag in arg spec + help text); success appends skill locations to the summary; failure
  prints the manual-command warning and init exits 0. `Init.vitest.ts` gains integration
  tests with the runner mocked: default path invokes it, `--no-skills` skips it, failure is
  non-fatal.
- **Builds on:** Dispatch 1's runner interface.
- **Hands to:** Feature-complete init behavior, fully covered by mocked tests — the state
  Dispatch 3 verifies end-to-end.
- **Focus:** `Init.ts` and its tests only. Do not modify the runner except to fix an
  interface mismatch surfaced by consumption (report it if so).

### Dispatch 3: end-to-end evidence and externalities

- **Outcome:** The three slice-DoD conditions hold with evidence: (a) a real `prisma init`
  run in a scratch directory (built CLI, live network) produces `.claude/skills/prisma-*/`,
  `.windsurf/skills/prisma-*/`, `.agents/skills/prisma-*/`, and `skills-lock.json` —
  command + output captured; (b) a simulated failure
  (unreachable `skills` version) leaves exit code 0 with the hint printed — output captured;
  (c) the per-ORM-minor tagging ask is filed on prisma/skills via `gh` and its URL recorded
  (as executed: filing was permission-gated → accepted deferral D14, body preserved for the
  operator).
  Evidence lands in a `## Verification` block appended to this plan file.
- **Builds on:** Dispatch 2's feature-complete behavior (and Dispatch 1's `manualCommand`
  shape for the failure capture).
- **Hands to:** Slice at DoD — PR-open evidence for the build workflow to include in the PR
  description.
- **Focus:** Verification and filing only; code changes limited to what the real runs prove
  broken (report, don't silently redesign).

## Sizing

| Dispatch | Size | dispatch-INVEST note                                                                   |
| -------- | ---- | -------------------------------------------------------------------------------------- |
| 1        | M    | One outcome: tested runner. Mechanical scope, no design judgment left (spec fixed it). |
| 2        | M    | One outcome: wired init. Consumer-side only; substrate untouched.                      |
| 3        | S    | Verification + two external filings; binary evidence checklist.                        |

## Handoff completeness

Slice-DoD condition (a) ← D3; (b) ← D2 tests + D3 live capture; (c) ← D3. CI-green +
reviewer-accept inherited via the slice PR.
