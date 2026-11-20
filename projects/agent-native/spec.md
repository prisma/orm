# agent-native

## Purpose

An AI agent operating Prisma succeeds by default — it works from current, version-matched
knowledge instead of stale training data, cannot destroy user data without a relayed human
decision, and is never silently betrayed by the API's sharp edges. This keeps agent-driven
projects (an ever-growing share of new Prisma adoption) choosing Prisma and staying, rather
than churning after avoidable first-hour failures.

## At a glance

Today an agent scaffolding a Prisma 7 app puts the database URL in the schema, expects `.env`
auto-loading, writes queries against a stale generated client, passes `connection_limit` in a
URL the driver adapter ignores, and — worst — runs
`deleteMany({ where: { id: maybeUndefined } })`, which silently deletes every row.

After this project, the same session looks like:

- `prisma init` leaves `.claude/skills/prisma-*/` and `.agents/skills/prisma-*/` in the
  project — the [prisma/skills](https://github.com/prisma/skills) catalog, installed for the
  four major agent runtimes; existing projects get one polite, TTY-gated, 30-second offer on
  `prisma generate` (never in CI, containers, or hooks).
- The catalog answers the questions agents actually fail on: which URL goes in which slot per
  provider, regenerate-after-schema-change (with a Claude Code hook that automates it),
  troubleshooting runbooks, API pitfalls with engine-test citations, a performance playbook,
  ORM-vs-platform-CLI disambiguation, and the MongoDB upgrade path to Prisma Next (v7 never
  ships a MongoDB connector; v6 users need routing, not a dead-end "upgrade to 7").
- `migrate reset` invoked by an agent halts at the AI safety checkpoint and relays a consent
  request to the human — including when reached through `prisma mcp`.
- `typedSql` — the recommended escape hatch for several pitfalls — is discoverable instead of
  hidden.

Drafted task-level detail: `docs/plans/agent-native/` (000 index + tasks 001–010, commit
f462cb0a8).

## Non-goals

- Building a skills package manager — installation delegates to the `skills` CLI
  ([agentskills.io](https://agentskills.io/)), exactly as prisma-next does.
- Expanding `prisma mcp` functionality; only the safety-checkpoint interplay audit is in scope.
- Changing confusing-but-shipped filter semantics (`OR: []`, vacuous `every`) — breaking;
  documented with engine citations instead.
- Docs-site work (`llms.txt`, agent-readable error pages) — different repo; listed as future
  ideas in the draft index.
- GA/stabilization of `typedSql` — this project only makes it visible (hidden → active).
- Bringing MongoDB support to Prisma 7 — it will never exist; the agent-facing remedy is the
  v6 → Prisma Next upgrade skill (task 011), not a connector.

## Place in the larger world

- **prisma/skills** — the content home; ships 8 skills targeting ORM 7.6.x, installable via
  `npx skills add prisma/skills`. Six of the ten tasks land there. Needs release tagging per
  supported ORM minor (ask filed as part of task 001).
- **prisma/prisma-next** — precedent, not a dependency: its `init` skill distribution
  (`skill-install.ts`) defines the command shape this project adapts (with deviations:
  non-fatal failure, pinned `skills` version).
- **prisma-engines** — `typedSql` classification lives in `psl/psl-core/src/common/preview_features.rs`,
  shipped here via a `@prisma/prisma-schema-wasm` bump.
- **prisma/prisma-cli** (`@prisma/cli`, platform/Compute CLI) — not modified; the
  disambiguation reference (task 010) documents the boundary.
- **Existing in-repo surfaces this project layers on:** the NPS survey machinery
  (`packages/cli/src/utils/nps/survey.ts` — TTY/CI/container gating, 30 s timeout,
  config-dir persistence), `prisma init` (`packages/cli/src/Init.ts`), `prisma generate`
  (`packages/cli/src/Generate.ts`), `prisma mcp` (`packages/cli/src/mcp/MCP.ts`), the AI
  safety checkpoint (`packages/migrate/src/utils/ai-safety.ts`,
  [PR #29684](https://github.com/prisma/prisma/pull/29684) in review), and the PostHog
  capture path (`packages/cli/src/utils/nps/capture.ts`).

## Cross-cutting requirements

- **No interactive prompt fires without a TTY** — every new prompt inherits the full NPS gate
  set (interactive TTY, not CI, not container, not git/npm hook); no slice may regress this.
- **No auxiliary step breaks the primary command** — skill installation failing must never
  fail `init` or `generate`.
- **Pinned third-party execution** — any `npx`-style invocation of the `skills` CLI uses an
  exact vetted version, at every intermediate state, from the first slice that shells out.
- **Citation discipline in skill content** — every behavioral claim in prisma/skills content
  authored under this project cites the engine test or source that pins it.
- **Measurability** — distribution surfaces (init install, generate offer) emit telemetry via
  the existing PostHog path, from the release in which they ship.

## Transitional-shape constraints

- The generate-time offer (task 002) does not ship to a stable release before the
  configuration-routing and API-pitfalls content (tasks 004, 007) is merged in prisma/skills —
  the offer must never install a catalog that cannot answer the top failure modes.
- Every merged prisma/prisma slice leaves `init` and `generate` fully functional with the new
  behavior either complete or dark — no half-wired prompts or dangling flags in a release.
- The prisma/skills catalog remains independently installable (`npx skills add prisma/skills`)
  at every intermediate state; content tasks must not gate on distribution tasks.
- The AI safety checkpoint never has a coverage gap during marker refactoring — detection for
  the currently-supported agents keeps passing tests throughout.

## Project Definition of Done

Team-DoD floor: `drive/calibration/dod.md` does not exist in this repo yet (drive context was
bootstrapped with this project); the standard implicit floor applies — CI green, review
approved, no known regressions. Project-specific conditions:

- [ ] `prisma init` on a clean directory produces skill files for all four agent runtimes;
      `prisma init --no-skills` produces none; a simulated install failure leaves init
      successful with a manual-install hint. Verified by CLI tests and one manual run.
- [ ] The generate offer demonstrably fires once and never again on a machine (accept, decline,
      and timeout paths all persist), and is suppressed in CI/container/non-TTY environments.
- [ ] PR #29684 is merged and a test pins the checkpoint firing through the `prisma mcp`
      `migrate-reset` tool with consent instructions intact.
- [ ] The seven content tasks (004–007, 009–011) are merged in prisma/skills and installable
      (004–007, 009, 010 via the sibling project; 011 tracked here as TML-2973).
- [ ] A schema with an invalid preview feature name lists `typedSql` among valid options
      (autocomplete + error message), via the bumped schema Wasm.
- [ ] Offer/opt-out telemetry events are visible in PostHog from a dogfood run.
- [ ] Close-out per `plan.md`: long-lived docs migrated to `docs/`, references stripped,
      `projects/agent-native/` deleted.

## Open Questions

1. **Init default: unconditional install vs agent-environment detection gating.** Working
   position: unconditional with `--no-skills` (prisma-next precedent, operator's stated
   intent); revisit only on review pushback about writing `.claude/`/`.agents/` into
   agent-free projects.
2. **Claude Code plugin placement.** Working position: `.claude-plugin/` marketplace manifest
   inside prisma/skills, keeping one repo in sync with ORM releases.
3. **Generate-offer acknowledgement scope.** Working position: per-machine (config-dir file);
   init and docs remain the discovery paths for users who declined once.
4. **Canonical home of the drafted task docs.** Working position: `docs/plans/agent-native/`
   stays the detailed task reference during execution; project-level truth lives in
   `projects/agent-native/`; close-out migrates what proves long-lived.

## References

- Linear Project: [Agent-Native Prisma ORM](https://linear.app/prisma-company/project/agent-native-prisma-orm-da6125fbcbac) (Terminal)
- Plan: [`./plan.md`](./plan.md); design notes: [`./design-notes.md`](./design-notes.md)
- Draft spec & task docs: `docs/plans/agent-native/000-agent-native-index.md` + tasks 001–010
- [prisma/skills](https://github.com/prisma/skills) ·
  [prisma/prisma-next](https://github.com/prisma/prisma-next) ·
  [prisma/prisma-cli](https://github.com/prisma/prisma-cli)
- [PR #29684](https://github.com/prisma/prisma/pull/29684) — AI safety marker refresh (in review)
- Engine-verified filter semantics: prisma-engines `query-compiler/core/src/query_graph_builder/extractors/filters/mod.rs`;
  connector-test-kit `filters.rs` (`empty_and`/`empty_or`/`empty_not`), `extended_relation_filters.rs`, `self_relation.rs`
