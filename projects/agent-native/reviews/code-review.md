# Code review — `agent-native`

> Initial scaffold. The reviewer maintains this document across rounds. The orchestrator and implementer read it but do not edit it (orchestrator owns § Subagent IDs and § Orchestrator notes).

## Summary

- **Current verdict:** CodeRabbit R1 — SATISFIED (cross-slice hardening fixes on the three open ORM PRs; no AC changes)
- **Dispatches SATISFIED:** S1: D1, D2, D3 (slice-final) — S2: D1, D2, D3 (slice-final) — S3: D1, D2 (slice-final) — S4: D1 (Half A) — S5: D2 (slice-final; D1 was the probe, no code)
- **AC scoreboard totals:** 9 PASS / 0 FAIL / 0 NOT VERIFIED / 1 ACCEPTED DEFERRAL (AC-3) / 1 OUT OF SCOPE (AC-10, deferred by design)
- **Open findings:** 0
- **Open escalations:** 0 (operator to-do Monday: file the two prepared issues — see `unattended-decisions.md` D14)

## Acceptance criteria scoreboard

> Populated from `projects/agent-native/slices/init-skill-install/spec.md § Slice-specific done conditions`. CI-green + reviewer-accept + project-DoD floor are inherited and not restated. Update on every round.

| AC ID | Description (short)                                                                                                                                                                    | Dispatch                 | Status                                                           | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1  | Real `prisma init` run produces `.claude/skills/prisma-*`, `.windsurf/skills/prisma-*`, `.agents/skills/prisma-*`, `skills-lock.json`; evidence captured                               | D3                       | PASS                                                             | Live capture in `slices/init-skill-install/verification.md § Final captures` (exit 0; 8 skills × 3 dirs = 24 `SKILL.md`; `find -type l` = 0); code claims verified on disk at commit `ca261b483` (`--copy` in `installArgs`, four-line summary in `Init.ts:730`, asserted in `Init.vitest.ts` + 18 snapshots)                                                                                                                                                                                                                                                               |
| AC-2  | Simulated install failure leaves init exit 0 with manual-command hint                                                                                                                  | D2 (tests) + D3 (live)   | PASS                                                             | Tests: mocked failure leaves `Init.parse` resolving normally with `console.warn` carrying the manual command (`packages/cli/src/__tests__/Init.vitest.ts`, commit `1f5058f5e`); runner failure shape unit-verified in `skill-install.vitest.ts` (commits `a84a3e46a`, `ca261b483`). Live: unreachable-registry run exit 0 with `--copy`-bearing manual command (`verification.md § Final captures`)                                                                                                                                                                         |
| AC-3  | Per-ORM-minor tagging ask filed on prisma/skills, URL recorded                                                                                                                         | D3                       | ACCEPTED DEFERRAL — `unattended-decisions.md` D14                | Sandbox correctly refused external issue creation under the operator's identity; prepared title + body preserved in `verification.md § Operator to-do` for the operator to file                                                                                                                                                                                                                                                                                                                                                                                             |
| AC-4  | Live TTY once-ever demo: first `prisma generate` shows the offer, declining writes `skills-offer.json`, second run silent; captured                                                    | S2-D3                    | PASS                                                             | Live pty capture in `slices/generate-skill-offer/verification.md` (decline → `outcome: "declined"` ack; second run silent, exit 0); prompt text and persistence shape match code verified at `9966964c1` (`skills-offer.vitest.ts`)                                                                                                                                                                                                                                                                                                                                         |
| AC-5  | Accept path demonstrated live: skills land via S1 runner                                                                                                                               | S2-D3                    | PASS                                                             | Live capture: accept → 24 `SKILL.md` (8 × `.agents`/`.claude`/`.windsurf`) + `skills-lock.json`, ack `outcome: "accepted"` (`verification.md`); matches S1 `--copy` behavior and the ack→install ordering verified at `9966964c1`                                                                                                                                                                                                                                                                                                                                           |
| AC-6  | Non-TTY / CI-env run shows no prompt (capture)                                                                                                                                         | S2-D3                    | PASS                                                             | Live non-TTY capture: no prompt, generate normal, no acknowledgement written (`verification.md`); matches code — gate short-circuits precede any `writeAcknowledgement`, per the spec's after-prompt-only persistence                                                                                                                                                                                                                                                                                                                                                       |
| AC-7  | Both-directions MCP safety test (marker → consent text, no success; no marker → no consent text), DB-free, CI-runnable                                                                 | S3-D1 (authored + green) | PASS                                                             | `packages/cli/src/__tests__/mcp-safety.vitest.ts` (commit `e05f5a66c`): real server over stdio, curated allowlist env, sqlite scratch project (offline, no generator); marker case demands the consent var name + stop-and-respond wording and forbids the success line; CI-runnability rests on the established built-CLI precondition, made fail-clear by a module-level throw (precedent: `dependent-generator.test.ts`)                                                                                                                                                 |
| AC-8  | `migrate-reset` tool description mentions the AI-agent gate + consent protocol                                                                                                         | S3-D2                    | PASS                                                             | Description paragraph verified on disk in `packages/cli/src/mcp/MCP.ts` (commit `bb4435f42`): names the gate, states the database is NOT reset when blocked, pre-frames the `Command failed with exit code 1: ...` error report, instructs stop → relay consent instructions → proceed only as the user directs; matches the pinned behavior from `e05f5a66c`; `tools/list` capture in `slices/safety-mcp-audit/verification.md`                                                                                                                                            |
| AC-9  | Engines PR open: `TypedSql` active, hidden loses it, list-pinning tests updated                                                                                                        | S4-D1                    | PASS                                                             | prisma-engines PR [#5836](https://github.com/prisma/prisma-engines/pull/5836) OPEN, commit `94c2c1f09a1` verified on disk at `/tmp/prisma-engines-compact-plan-format`: `\| TypedSql` in `active` (declaration-order position between `StrictUndefinedChecks` and `Views`), `hidden` now `{ReactNative}`, exactly the two list-embedding tests updated (one line each, ANSI escapes untouched); no other `TypedSql` reference in `psl/` outside `preview_features.rs`; PR body accurate for a cold reviewer (visibility-only, CLICOLOR_FORCE note, CI as remaining surface) |
| AC-10 | Half B: `typedSql` visible in prisma/prisma via bumped `@prisma/prisma-schema-wasm`; no behavior change for schemas already enabling it                                                | post-weekend             | OUT OF SCOPE — deferred by design past the wasm-publish boundary | Prep note with bump steps and expected snapshot fallout recorded in `slices/typed-sql-unhide/verification.md § Half B`; tracked on TML-2970                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| AC-11 | Skill PR open on prisma/skills: SKILL.md + 5 references, cross-links in `prisma-upgrade-v7` and `prisma-database-setup`, README entry, per-claim citations, branch-ref install capture | S5-D2                    | PASS                                                             | prisma/skills PR [#20](https://github.com/prisma/skills/pull/20) OPEN, commit `8932c0e` verified on disk at `/tmp/prisma-skills`: router table matches the five reference files exactly; both cross-links name `prisma-mongodb-upgrade`; README entry format-consistent + install line; highest-stakes claims (transactions gap ×4 sites, raw-API name mapping, migrations contrast) all cite pinned sources (`a2791c5dd59d…` / v6 docs anchors) and match the D1 fact table; install capture in `slices/mongodb-upgrade-skill/verification.md § Delivery`                  |

Status values: `PASS` / `FAIL` / `NOT VERIFIED — <reason>` / `ACCEPTED DEFERRAL — <link>` / `OUT OF SCOPE`.

## Subagent IDs

> Persistent implementer + reviewer per project; resumed across every round and dispatch.

- **Implementer:** `a10a394da70c31079` — first spawned D1 R1 (2026-07-03). Dedicated worktree: `/home/aqrln.guest/worktrees/prisma/solid-otter/agent-native-s1`, branch `tml-2968-s1-install-prisma-skills-during-prisma-init`.
- **Reviewer:** `a67a4fd8e8636f291` — first spawned D1 R1 (2026-07-03).

## Findings log

_(no findings yet)_

## Round notes

### D1 R1 — SATISFIED

**Scope:** D1 (skill-install runner module). Commit `a84a3e46a`.

**Tasks:** D1 clean — exports and constants match the spec's Chosen design; per-runner argv (`npx --yes` / `pnpm dlx` / `yarn dlx` / `bunx` + `skills@1.5.14 add prisma/skills --agent cursor claude-code codex windsurf --skill '*' -y`) verified on disk; never-throws holds including detection failures (npm fallback for `manualCommand`); 14 tests cover the named cases non-tautologically; gates trusted green (vitest 14/14, tsc, eslint).

**AC delta:** none (all three ACs are D2/D3-owned). AC-2 evidence annotated: failure-shape substrate unit-verified (commit `a84a3e46a`, `packages/cli/src/__tests__/skill-install.vitest.ts`).

**Findings:** none. Transient-ID scan: zero hits.

**For orchestrator:** (1) Yarn 1 (classic) has no `dlx`: a `yarn/1.x` user agent maps to `yarn dlx …`, which fails — non-fatally, but the printed `manualCommand` is equally broken for those users. The spec fixes the mapping, so this is a spec-amendment candidate (e.g. yarn 1 → npx path) for D2/D3 or a later round, not a D1 finding. (2) The duplicated `isBun` check is module-local (not exported); if D2 dedupes, it touches `Init.ts` anyway and can hoist or export then.

### D2 R1 — SATISFIED

**Scope:** D2 (Init wiring + integration tests) plus yarn-1 side-task per amended spec. Commits `1f5058f5e`, `a891e45dc`.

**Tasks:** D2 clean — `--no-skills` in arg spec and help; `installSkills({ cwd: outputDir })` runs after scaffolding on both the default and PPG-new-project paths; success appends exactly the three summary lines; failure prints the `console.warn` manual-command hint and init completes normally; 4 Init integration tests + snapshot updates verified on disk. Side-task clean — `yarn/1.x` UA routes to `npx --yes` (3 new unit tests incl. manual-command shape); unparseable yarn versions default to modern `dlx`. `isBun` move verified: no external importers of the removed `Init.ts` export. Gates trusted green (vitest 43/43, tsc, eslint).

**AC delta:** AC-2 NOT VERIFIED → PASS (tests) for its D2 half (commit `1f5058f5e`, `packages/cli/src/__tests__/Init.vitest.ts`); live capture pending D3. AC-1, AC-3 unchanged (D3-owned).

**Findings:** none. Transient-ID scan: zero hits (snapshot delta checked: 18 hunks, each exactly the three summary lines). Yarn-1-via-lockfile residual treated as OUT OF SCOPE per orchestrator decision D12.

**For orchestrator:** none.

### D3 R1+R2 — SATISFIED (slice-final)

**Scope:** D3 (end-to-end evidence + externalities); R1 I12 halt (skills@1.5.14 symlink no-op falsified the spec's layout assumption; resolved by decision D13) and R2 resolution. Commit `ca261b483`.

**Tasks:** D3 clean against the amended spec — `--copy` inserted before `-y` in `installArgs` with a why-comment naming the upstream symlink no-op; four-artifact `skillsSummary` (`Init.ts:730`); `skillsCliArgs` fixture and all three failure-shape `manualCommand` assertions updated; Init summary test asserts all four artifacts; live captures (default success, failure path, `--no-skills`) recorded in `verification.md`. Gates trusted green (tsc, vitest 43/43, eslint).

**AC delta:** AC-1 NOT VERIFIED → PASS (commit `ca261b483` + `verification.md § Final captures`). AC-2 PASS (tests) → PASS in full (live failure capture added). AC-3 NOT VERIFIED → ACCEPTED DEFERRAL (`unattended-decisions.md` D14; prepared body in `verification.md`).

**Findings:** none. Transient-ID scan on `ca261b483`: zero hits. Snapshot delta verified: exactly 18 × `+  .windsurf/skills/`, zero removals. Untouched mock `manualCommand` literal in the Init failure test accepted — an opaque injected value testing pass-through printing, not command assembly.

**For orchestrator:** Operator Monday to-do stands — file the tagging ask and the upstream symlink bug from `verification.md § Operator to-do`, then record the URLs.

### S2-D1 R1 — SATISFIED

**Scope:** S2-D1 (offer module + shared timeout helper), branch `tml-2971-s2-one-time-skill-offer-on-prisma-generate` stacked on `ca261b483`. Commit `9966964c1`.

**Tasks:** S2-D1 clean — gate chain matches the spec order exactly (ack file → already-installed with `already-installed` ack write → interactive → Deno → CI → git hook → npm hook → container → `daysSinceFirstCommand >= 1`); prompt text, 30s timeout-to-No, and four-outcome `skills-offer.json` persistence as specced; accept path calls S1 `installSkills({ cwd })` with init's warning pattern; `skills_offer_resolved { outcome, cliVersion }` fires only when prompted; `timeout()` extracted verbatim to `utils/prompt-timeout.ts` with `survey.ts` touched for the import swap only (`createSafeReadlineProxy` was already exported). 27 tests verified on disk, non-tautological (real fs, injected prompt/capture/runner, fake-timer timeout with timer-count guard). Gates trusted green (vitest 27/27, jest nps 14/14, tsc, eslint).

**AC delta:** none promoted (AC-4..6 are S2-D3-owned; rows added with substrate evidence).

**Findings:** none. Transient-ID scan on `9966964c1`: zero hits.

**For orchestrator:** For S2-D3 planning, the implementer's observation matters: `loadOrInitializeCommandState` writes `commands.json` without creating the config dir, so the isolated `env-paths` dir used for live captures must be pre-created — otherwise the state loader rejects and the days gate silently suppresses the demo prompt.

### S2-D2 R1 — SATISFIED

**Scope:** S2-D2 (Generate wiring + mutual exclusion). Commit `744539ec0`.

**Tasks:** S2-D2 clean — `skillsOfferHandler` constructor param defaults to `handleSkillsOffer`, mirroring the adjacent `surveyHandler` seam; sole call site sits inside the existing `!hideHints` guard in the non-watch success path, offer first, survey only when `prompted === false` (`Generate.ts:274-281`); watch branch structurally never reaches the block and the new watch test pins it. Four tests replace the two survey tests with no coverage loss (survey-called-when-hints-enabled is subsumed by the ordering assertion `['offer', 'survey']`; not-called-with-`--no-hints` is extended to both handlers) plus two new behaviors (prompted → survey skipped; watch → neither). All four inject both handlers; the module-wide `Watcher` mock is exercised only by the watch test — no other test in the file constructs a `Watcher`. Gates trusted green (jest Generate 42/42, jest nps 14/14, tsc, eslint).

**AC delta:** none promoted (AC-4..6 are S2-D3-owned; reasons updated to "S2-D3 pending").

**Findings:** none. Transient-ID scan on `744539ec0`: zero hits.

**For orchestrator:** none.

### S2-D3 R1 — SATISFIED (slice-final)

**Scope:** S2-D3 (live TTY evidence; no code changes). Worktree verified clean, branch `tml-2971-s2-one-time-skill-offer-on-prisma-generate` unchanged at `744539ec0` (`9966964c1` → `744539ec0` atop S1's `ca261b483`).

**Tasks:** Evidence in `slices/generate-skill-offer/verification.md` cross-checks against the code verified in S2-D1/D2 with no inconsistency: prompt text verbatim from `promptForInstall`; decline/accept acks match the persistence shape and ack→install ordering; second-run silence matches the ack-file gate; accept lands 24 `SKILL.md` + `skills-lock.json` per S1's `--copy`; both environment traps (pre-created `prisma-nodejs` config dir, aged `commands.json`) applied; container/CI gates verified against real implementations. The no-ack-on-gated-out nuance is blessed: the spec ties persistence to prompt resolution (or already-installed), so gated-out runs correctly leave the offer available. The cosmetic install-output-before-summary ordering is expected from `Generate.parse` returning the message for the caller to print.

**AC delta:** AC-4, AC-5, AC-6 NOT VERIFIED → PASS (`verification.md` + commits `9966964c1`/`744539ec0`). Slice 2 at DoD.

**Findings:** none. No new commits — worktree/branch check performed in lieu of the transient-ID scan.

**For orchestrator:** The captures' NPS silence is partly environmental (no active NPS timeframe remotely); mutual exclusion rests on the S2-D2 unit tests, which I judge adequate — no live NPS-collision capture needed.

### S3-D1 R1 — SATISFIED

**Scope:** S3-D1 (probe + pin), new worktree `agent-native-s3`, branch `tml-2969-s3-ai-safety-checkpoint-through-prisma-mcp-audit-pin` from `origin/main` (`9b2e72a04`). Commit `e05f5a66c` (test file only; worktree clean).

**Tasks:** S3-D1 clean — probe verdict ("consent text surfaces today via execa v5's error.message") is empirically confirmed by the green marker-case test against the real server over stdio; the three cases verify on disk: marker case demands the consent var name and the contiguous stop-and-respond wording from `ai-safety.ts` and forbids the success line; control case demands actual success; bypass case pins the documented consent-var loop. Curated allowlist env cross-checked against `agentMatchers` — no allowlisted var (incl. Windows spawn vars, `TERM`, `PRISMA_HIDE_UPDATE_MESSAGE`) is a marker or the consent var. Scratch project is offline sqlite with no generator block; no `MCP.ts` changes; `projectCWD` arg name matches the tool schema. Gates trusted green (vitest 3/3 twice, tsc, eslint).

**AC delta:** AC-7 NOT VERIFIED → PASS (commit `e05f5a66c`, `mcp-safety.vitest.ts`); CI-runnability reading: DB-free by construction, resting on the suite's established built-CLI precondition made fail-clear by the module-level throw. AC-8 row added (S3-D2-owned).

**Findings:** none. Transient-ID scan on `e05f5a66c`: zero hits.

**For orchestrator:** Residual environmental caveat, no action: Devin's marker is a file (`/opt/.devin`) outside the env allowlist's control, so the no-marker case would fail on a Devin VM — inherent to real-subprocess testing and vanishingly unlikely in CI.

### S3-D2 R1 — SATISFIED (slice-final)

**Scope:** S3-D2 (migrate-reset description). Commit `bb4435f42` (worktree clean; `e05f5a66c` → `bb4435f42`).

**Tasks:** S3-D2 clean — the diff is exactly one description paragraph in `MCP.ts` (Zod schema, `runCommand`, behavior untouched); the paragraph matches the pinned behavior verbatim in its claims: blocked invocation → no reset, error report framed `Command failed with exit code 1: ...` carrying the consent protocol, stop → relay → proceed-as-directed instruction is agent-actionable. Untouched-other-descriptions verified against the checkpoint's consumer set: `aiAgentConfirmationCheckpoint` is reached only by `MigrateReset`, `DbPush` (`--force-reset`), `DbDrop`; the other three MCP tools shell out to `migrate status`, `migrate dev`, `studio` — none gated. `tools/list` capture recorded in `slices/safety-mcp-audit/verification.md`. Gates trusted green (mcp-safety 3/3 against the rebuilt bundle, tsc, eslint).

**AC delta:** AC-8 NOT VERIFIED → PASS (commit `bb4435f42` + `verification.md`). Slice 3 at DoD.

**Findings:** none. Transient-ID scan on `bb4435f42`: zero hits.

**For orchestrator:** none. (The update-message-in-tool-output observation is already recorded in `verification.md` / `learnings.md` as a follow-up-ticket candidate.)

### S4-D1 R1 — SATISFIED (Half A)

**Scope:** S4-D1 (typedSql unhide, Half A — cross-repo). prisma-engines checkout `/tmp/prisma-engines-compact-plan-format`, branch `chore/unhide-typed-sql-preview-feature` (clean, pushed, in sync with origin), commit `94c2c1f09a1`, PR [#5836](https://github.com/prisma/prisma-engines/pull/5836) (OPEN).

**Tasks:** S4-D1 clean — `| TypedSql` added to `active` and removed from `hidden` (now `{ReactNative}`) in `preview_features.rs`; the diff touches exactly the two tests embedding the rendered visible-features list, one line each, with pre-existing ANSI escapes identical on both sides (no color-incident churn leaked); `typedSql`'s rendered position between `strictUndefinedChecks` and `views` matches enum declaration order; `rg` confirms no other `TypedSql` reference in `psl/` outside the classification file. PR body verified via `gh pr view`: accurate cold-reviewer story (visibility-only, reactNative stays hidden, GA out of scope, `CLICOLOR_FORCE=1` validation note, CI as the remaining surface). Half B prep note recorded in `slices/typed-sql-unhide/verification.md`. Gates trusted green (1,297 psl tests with `CLICOLOR_FORCE=1`, psl-core all-features, `cargo fmt --check`).

**AC delta:** AC-9 added → PASS (PR #5836 + commit `94c2c1f09a1`). AC-10 added → OUT OF SCOPE (deferred by design past the wasm-publish boundary; prep note in `verification.md § Half B`).

**Findings:** none. Transient-ID scan on `94c2c1f09a1`: zero hits (PR-body project provenance is deliberate, per protocol).

**For orchestrator:** Half B's re-entry trigger is external (engines merge + `@prisma/prisma-schema-wasm` dev publish) — worth a tracked reminder alongside the Monday filings so the slice does not silently stall at the boundary.

### S5-D2 R1 — SATISFIED (slice-final)

**Scope:** S5-D2 (mongodb-upgrade skill authoring — content review, third repo). prisma/skills checkout `/tmp/prisma-skills`, branch `prisma-mongodb-upgrade-skill` (clean, in sync), commit `8932c0e`, PR [#20](https://github.com/prisma/skills/pull/20) (OPEN). S5-D1 was the probe (no code); its fact table in `slices/mongodb-upgrade-skill/verification.md` served as the claims baseline.

**Tasks:** S5-D2 clean — claims-vs-citations spot-check of the highest-stakes content passes: the transactions gap appears in four sites (SKILL.md decision table, `decision-stay-or-migrate`, `client-api-mapping`, cutover checklist item 7) with identical semantics (no façade `db.transaction(...)`, raw driver sessions the only workaround, v6 works on replica sets — each cited); the raw-API mapping matches the fact table (no same-name equivalents; `mongoRaw(...)` lane; "check the installed version" hedge present); the migrations contrast (v6 `db push`-only, cited to the docs anchor, vs Next plan/migrate/verify/sign) matches. Lead is genuinely stay-first (default named and bolded up front, both no-go signals, stay-hygiene in SKILL.md and the reference). Router integrity verified (table ↔ five files on disk; both cross-links; README format-consistent). No overreach: exactly 9 files, `prisma-postgres-setup` omission untouched. Root-level placement matches repo practice. Gates: tree clean; no code to typecheck.

**AC delta:** AC-11 added → PASS (PR #20 + commit `8932c0e` + `verification.md § Delivery` install capture). Slice 5 at DoD pending human merge.

**Findings:** none. Transient-ID scan on `8932c0e`: zero hits — no plan IDs, tickets, or project paths in the skill content.

**For orchestrator:** none new. (The skills-CLI agent-roster growth observation and the AGENTS.md nesting divergence are already recorded in the slice `verification.md`.)

### CodeRabbit R1 — SATISFIED

**Scope:** Cross-slice fix round per `unattended-decisions.md` D16. Commits `65eac77df` (S1 branch), `b7edbaa26` (S2 branch), `20821317a` (S3 branch) — each verified at its branch tip, all pushed.

**Tasks:** All three diffs match their stated fixes exactly, nothing else touched. (1) `defaultExec` gains `timeout: 60_000` + why-comment; a killed child rejects into the existing failure shape. (2) `.windsurf/skills` added as the third already-installed marker with a matching `test.each` case and a non-prisma windsurf entry in the negative test; code + tests now agree with the amended S2 spec § gate 2 (four markers). (3) `@prisma/config` dist precondition in the established fail-clear style; `connect()` moved inside try/finally with a why-comment — SDK `close()` verified at source as `await this._transport?.close()`, a resolved no-op on an unconnected client, so the three passing cases are unaffected. Stacking property confirmed: the S2 branch's copy of `skill-install.ts` deliberately lacks the timeout (S2 stacks on `ca261b483`; it inherits the fix when retargeted after S1 merges) — correctly flagged, not a defect. Gates trusted green (17/17, 28/28, 3/3 ×2; tsc + eslint per branch).

**AC delta:** none (hardening only; existing evidence commits remain valid).

**Findings:** none. Transient-ID scan across all three commits: zero hits.

**For orchestrator:** none.

## Orchestrator notes

- Unattended mode 2026-07-03 → Monday; decisions in `projects/agent-native/unattended-decisions.md`.
