# Unattended decisions — agent-native

Operator instruction (2026-07-03 ~15:40 UTC): "work unattended and record any decisions you
make. I'll check on you on Monday." Decisions the orchestrator made without the operator are
logged here, newest last.

## 2026-07-03

- **D1 — Decision-log location.** `drive-check-health` names `wip/unattended-decisions.md` as
  the unattended-decisions surface, but the orchestrator file-write boundary is
  `projects/<project>/` and this repo has no `wip/` convention. Logging here
  (`projects/agent-native/unattended-decisions.md`) instead.
- **D2 — Proceed-to-build policy.** The operator's "work unattended" is taken as standing
  authorization to proceed from recommended-next-pick into `drive-build-workflow` without
  per-slice confirmation (the policy gate in `drive-check-health` § Step 5). Halt points
  remain: scope shifts (promote/demote/spec amendment) and project close-out.
- **D3 — TML-2972 closed.** PR prisma/prisma#29684 merged 2026-07-03 13:48 UTC (approved);
  marked TML-2972 Done and treat S3 (TML-2969) as unblocked. Not a judgment call, but recorded
  since the operator last saw it "in review".
- **D4 — Slice branch discipline.** Slice work happens on branches cut from `origin/main`
  (Linear-derived names, e.g. `tml-2968-...`), implemented by dispatched subagents in isolated
  worktrees, so this session's checkout stays on `agent-native-spec` where the project
  workspace lives. Slice PRs target `main` and do not include `projects/` or `drive/` files.
- **D5 — S2 stacking.** If S1's PR is still unmerged when S2 becomes the next pick, S2 is
  authored stacked on S1's branch (PR base = S1's branch, retargeted to `main` after S1
  merges). Weekend review latency makes waiting-for-merge equivalent to halting; stacking is
  reversible.
- **D6 — "Delivered" over the weekend = PR open.** Slice PRs cannot merge without human
  review; `slice-completed` (result "merged") is only emitted on actual merge. The weekend
  goal is: every unblocked slice at DoD with a PR open. Per-slice-merge health checks convert
  to per-PR-open checks (recorded cadence deviation).
- **D7 — Workspace commit cadence.** `projects/agent-native/` updates (trace, rollups, this
  log) are batch-committed to `agent-native-spec` and pushed at checkpoints (slice PR opened,
  session end), so the operator can follow progress from PR #29688 without waiting for
  Monday.
- **D8 — S1 installs from the prisma/skills default branch.** The task draft sketched runtime
  tag-resolution (`#v<matching-tag>` with fallback); no such tags exist yet, so the runtime
  check would always take the fallback while adding a network probe to init. S1 ships
  default-branch installs and files the tagging ask; pinning activates in a follow-up once
  tags exist. Recorded in the slice spec's Chosen design.
- **D9 — PR-open is treated as pre-authorized.** `drive-build-workflow` unattended default is
  "hold the branch local at slice DoD" unless PR-open was granted. The operator invoked
  `/drive-deliver-workflow` — whose slice step explicitly auto-opens the PR at DoD with no
  extra operator gate — and then said "work unattended". Reading both together as a standing
  grant; slice PRs will be opened at DoD (see D6). If this reading is wrong, closing the PRs
  on Monday is cheap and nothing merges without review regardless.
- **D10 — Validation gates inferred without operator confirmation.** No gates were declared in
  the plan and none can be confirmed unattended. Inferred: D1 — packages/cli typecheck +
  the new `skill-install.vitest.ts` green; D2 — packages/cli typecheck + `Init.vitest.ts`
  (incl. new cases) green; D3 — evidence-based (real init run, failure simulation), no code
  gates beyond re-running D1+D2 gates if code changed; slice-final — packages/cli lint +
  the package's test suite for touched files. Exact script names discovered by the
  implementer from `packages/cli/package.json` and recorded in their report.
- **D11 — Yarn 1 routed to npx (slice spec amended in place).** The D1 reviewer surfaced
  that Yarn 1 (classic) has no `dlx`, so the spec's runner mapping would assemble a broken
  `yarn dlx` command (and an equally broken manual-command hint) for `yarn/1.x` user agents.
  Interactively this would be a `drive-discussion` stop; unattended, the defensible fix is
  narrow and conventional: parse the yarn major from the user agent and route yarn 1 to the
  existing `npx --yes` path (yarn-1 setups ship npm). Slice spec amended (edge-case table +
  chosen design), fix carried into dispatch D2 as an explicitly framed separate commit.
  Verify by: the yarn-1 unit test added in D2 and the amended spec section.
- **D12 — Yarn-1-via-lockfile left as accepted residual.** After D2, one gap remains: a yarn
  classic project detected through `yarn.lock` (no user agent — e.g. a globally installed
  CLI run directly) still assembles `yarn dlx`, which fails on classic. A lockfile cannot
  distinguish classic from berry; routing all lockfile-yarn to npx would degrade berry users
  whose `yarn dlx` works, and sniffing `.yarnrc.yml` is scope growth for a shrinking cohort.
  The failure path is non-fatal with a printed manual command, so the cost of being wrong is
  one failed optional step. Recorded in the slice spec's edge-case table; revisit only if
  real-world reports surface.
- **D13 — I12 halt resolved: `--copy` added to the skills install (option b).** The D3 live
  run falsified a spec assumption: skills@1.5.14 with multiple `--agent` values writes only
  the universal `.agents/skills/` tree — the per-agent symlinks its own output promises are
  never created (upstream bug), so our init summary advertised a `.claude/skills/` that did
  not exist. Interactively this was a drive-discussion stop; unattended, intent decides:
  the project spec names `.claude/skills/` as a place agents look, and prisma-next
  deliberately materializes both locations — so listing `.agents/` only (option a) would
  risk non-functioning skills for Claude Code users, defeating the slice's purpose. Chose
  `--copy` (option b): verifiably produces `.claude/skills/`, `.windsurf/skills/`, and
  `.agents/skills/` as real copies; costs harmless duplication. Slice spec amended; D3
  continues in round 2 with the fix + re-captured evidence. An upstream bug report for the
  symlink no-op is being prepared for the operator to file on vercel-labs/skills.
  Verify by: R2's live-run capture and the amended spec §§ Chosen design / edge cases.
- **D14 — AC-3 (tagging ask) accepted as a deferral: external filing is permission-gated.**
  The sandbox correctly refused `gh issue create` on prisma/skills under the operator's
  identity without the operator's own approval. The prepared title + body are preserved
  verbatim in `projects/agent-native/slices/init-skill-install/verification.md` — filing it
  on Monday is one paste. The slice proceeds to DoD with AC-3 recorded as ACCEPTED DEFERRAL
  rather than stalling three finished dispatches on an external write only the operator can
  authorize. Needs your attention Monday: file the tagging ask (and the upstream symlink
  bug, same file).
- **D15 — Session-limit stall handling.** The first S2-D3 invocation was cut short by an
  account session limit (reset 20:50 Berlin) before any work started. Policy adopted: retry
  the identical dispatch once (the persistent implementer reconciles any partial work from
  its transcript and scratch dirs); if the retry also bounces on the limit, pause the loop
  and resume after the reset rather than burning invocations. No trace events re-emitted —
  the S2-D3 round was already open and no work occurred.
- **D16 — CodeRabbit response round (operator-directed, 2026-07-06).** Nine inline comments
  triaged across the open PRs. Accepted and fixed: execa timeout in the S1 runner; two
  test-robustness fixes on S3 (config-dist precondition, connect-inside-try); `.windsurf`
  added to S2's already-installed markers (code + spec — CodeRabbit flagged the spec, the
  code had to follow); living-document consistency fixes in the S1 plan/spec (windsurf
  layout, tagging-ask deferral wording) and one markdown language tag in
  `docs/plans/agent-native/001-*.md` (a one-line docs/ edit made directly under the
  orchestrator escape hatch rather than dispatching — logged here as the boundary
  exception). Declined with replies: two suggestions to rewrite issued dispatch briefs —
  briefs are point-in-time records whose sha256 content hashes are recorded in
  `trace.jsonl` (`brief-issued` events); rewriting them would falsify the trace, and the
  living artifacts already carry the corrected content.
- **D17 — Operator review round on skills#20 + engines#5836 (2026-07-06, operator present).**
  Operator ground truth supersedes the S5 probe's roadmap reading: MongoDB in Prisma Next is
  **Early Access, past POC**, GA planned after Postgres, and the product intent is to
  encourage migration/early feedback. S5 slice spec amended (Chosen design § Operator
  correction); skill reframed accordingly (plus: agent self-checks instead of user
  questions, internal filenames removed from user-facing prose, driver accessibility stated
  affirmatively). Engines style suggestion applied. Retro-note: the S1 retro's "probe
  empirically" rule worked, but a probe of _documents_ (ROADMAP.md) is still a document
  read — staleness of the source is part of the probe. Resolved 2026-07-06: after connector
  re-authorization, the ticket was filed as TML-2975 in the SQLite & MongoDB transactions
  project and linked from the PR thread.
