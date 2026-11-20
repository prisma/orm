# agent-native — Plan

**Spec:** `projects/agent-native/spec.md`
**Linear Project:** [Agent-Native Prisma ORM](https://linear.app/prisma-company/project/agent-native-prisma-orm-da6125fbcbac) (anchor issue: TML-2967)

## At a glance

Four slices: a two-slice distribution stack (init install → generate offer) plus two
independent parallel slices (MCP safety audit; typedSql unhide). The prisma/skills content
suite is deliberately **not** sliced here — it is a sibling project in the prisma/skills repo
(PRs cannot land there from this repo), tracked as an external dependency that gates S2's
stable release.

## Composition

### Stack (deliver in order)

1. **Slice `init-skill-install`** — Linear: TML-2968
   - **Outcome:** `prisma init` installs the prisma/skills catalog for cursor, claude-code,
     codex, and windsurf via a pinned `skills` CLI version; `--no-skills` opts out; install
     failure is non-fatal and prints the manual command; results appear in the init summary.
   - **Builds on:** None.
   - **Hands to:** The shared skill-install runner (`packages/cli/src/init/skill-install.ts`:
     package-manager detection, pinned version constant, runtime list, non-fatal error
     handling) for S2 to reuse. Also files the release-tagging ask on prisma/skills.
   - **Focus:** The init path only. No generate wiring, no prompting — init is
     flag-controlled, never interactive about skills.

2. **Slice `generate-skill-offer`** — Linear: TML-2971
   - **Outcome:** A once-ever-per-machine, TTY-gated, 30-second offer to install skills after
     a successful interactive `prisma generate`; accept/decline/timeout all persist; at most
     one prompt per run (offer preempts NPS); telemetry events flow via the PostHog path.
   - **Builds on:** Slice 1's runner.
   - **Hands to:** Project-DoD conditions 1–2 verifiable end-to-end; extracted shared prompt
     utilities (`timeout()` from `nps/survey.ts`) available for any future prompt.
   - **Focus:** Offer machinery, gating, persistence, NPS mutual exclusion, telemetry.
     Stable-release gate (transitional constraint): routing + pitfalls content merged in
     prisma/skills first.

### Parallel group A (independent of stack and group B)

- **Slice `safety-mcp-audit`** — Linear: TML-2969
  - **Outcome:** A test pins that the AI safety checkpoint fires through `prisma mcp`'s
    `migrate-reset` tool with consent instructions intact; the MCP tool description mentions
    the consent protocol.
  - **Builds on:** External: PR #29684 (marker refresh) merged.
  - **Hands to:** Verified checkpoint behavior the skills content (sibling project) can
    document with confidence.
  - **Focus:** Audit and pin only — no checkpoint scope expansion (non-goal per task 003).

### Parallel group B (independent of stack and group A)

- **Slice `typed-sql-unhide`** — Linear: TML-2970
  - **Outcome:** `typedSql` appears in schema autocomplete and valid-preview-feature error
    listings; no behavioral change for schemas already enabling it.
  - **Builds on:** None (includes its upstream prisma-engines PR; the merge unit in this repo
    is the `@prisma/prisma-schema-wasm` bump PR with snapshot updates).
  - **Hands to:** A recommendable, discoverable TypedSQL for the pitfalls/performance content
    in the sibling project.
  - **Focus:** Hidden → active only; GA/stabilization is out of scope.

## Dependencies (external)

- [ ] **PR #29684** (AI safety marker refresh, TML-2972) — in review; gates `safety-mcp-audit`.
- [ ] **prisma/skills content suite** (draft tasks 004–007, 009, 010) — sibling project in the
      prisma/skills repo; needs its own drive-create-project ceremony there. Gates the
      stable-release of `generate-skill-offer` (transitional constraint) and project-DoD
      condition 4.
- [ ] **`prisma-mongodb-upgrade` skill** (draft task 011, TML-2973) — adopted directly into
      this project by operator decision; its PR lands in prisma/skills. Guides MongoDB users
      from v6 to Prisma Next (v7 never ships a MongoDB connector). Independent of the S2
      release gate and of the sibling project's ceremony.
- [ ] **prisma/skills release tagging** per supported ORM minor — ask filed by
      `init-skill-install`; fallback (install from default branch) works without it.
- [ ] **prisma-engines PR** for `typed-sql-unhide` — authored as part of that slice; needs an
      engines reviewer.

## Sequencing rationale

The stack order is forced by the shared runner (S2 consumes S1's module). Everything else is
parallel by design: the safety audit and the typedSql unhide touch disjoint surfaces and
neither reads nor writes the distribution code. The only cross-cutting ordering is a
_release_ gate, not a merge gate: `generate-skill-offer` may merge dark behind its gating
logic, but must not reach a stable release before the sibling content project covers the
top failure modes (spec § Transitional-shape constraints).
