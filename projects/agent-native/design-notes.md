# Design notes: agent-native

> Synthesized design document for `agent-native`. Read this if you want to understand **what the project's design is**, **what principles it serves**, and **what alternatives were considered and rejected**. This document is not a chronological log of decisions — it captures the settled design, standing independently of the discussions that produced it.
>
> Owned by the Orchestrator. Authored directly. Updated as design settles; not as decisions happen. Cross-link from the project spec; never block on a design-notes update during execution.

## Principles this design serves

- **Meet agents where they look** — knowledge ships into the project (`.claude/skills/`, `.agents/skills/`), not behind a docs URL an agent may never fetch.
- **Delegate, don't rebuild** — skill installation is the `skills` CLI's job; Prisma's CLI only decides when to invoke it.
- **Consent for destruction** — an agent may never destroy data without a relayed, explicit human decision.
- **Document what cannot change** — breaking semantics (`OR: []`, vacuous `every`) get engine-cited documentation, not fixes.
- **Never block the pipeline** — no prompt fires without a TTY; no auxiliary step may fail `init` or `generate`.

## The model

### Distribution

One shared runner (introduced in `prisma init`, reused by the `generate` offer) shells out to a pinned `skills` CLI version, package-manager-adaptively, installing the prisma/skills catalog for `cursor claude-code codex windsurf`. Init installs by default (`--no-skills` opts out, failure non-fatal); generate makes a once-ever, 30-second, TTY-gated offer persisted in the same OS config directory the NPS survey uses, with at most one prompt per run (skills offer preempts NPS for that run).

### Content

prisma/skills is the single content home. New material: configuration routing (per-provider references), generate-after-schema-change (+ Claude Code plugin with a PostToolUse hook), troubleshooting runbooks, API pitfalls with engine-test citations, a performance playbook, CLI disambiguation. Every behavioral claim cites the engine test or source that pins it, so re-verification on version bumps is mechanical.

### Safety

The checkpoint in `packages/migrate/src/utils/ai-safety.ts` stays scoped to purpose-built destruction commands (`db drop`, `db push --force-reset`, `migrate reset`). Env markers inherit into child processes, so the checkpoint fires inside `prisma mcp` tool calls; the audit verifies the consent text survives the MCP transport.

## Alternatives considered

- **Bundle skills inside the `prisma` npm package** — no network step at install time. **Rejected because:** skills would version-lock to the CLI release cadence, bloat the package, and bypass the `skills` CLI's multi-runtime placement logic.
- **`skills@latest` at execution time (prisma-next's choice)** — always newest installer. **Rejected because:** unpinned third-party code execution from the stable ORM CLI is an unacceptable supply-chain surface.
- **Fatal skill-install failure on init (prisma-next's choice)** — guarantees consistent state. **Rejected because:** the stable CLI cannot fail project scaffolding over an auxiliary network step.
- **`@vercel/detect-agent` for agent detection** — maintained external list. **Rejected because:** rationale documented in the comment above `agentMatchers` in `ai-safety.ts` (kept in-house deliberately).
- **Extending the NPS `nps.json` persistence for the skills offer** — one file fewer. **Rejected because:** the NPS acknowledgement is per-remote-timeframe while the skills offer is once-ever; overloading the schema couples two unrelated lifecycles.

## Open questions

- **Init default: unconditional vs detection-gated install** — working position: unconditional with `--no-skills`, matching prisma-next and the user's stated intent; revisit if review surfaces pushback about writing `.claude/`/`.agents/` into agent-free projects.
- **Claude Code plugin placement** — working position: `.claude-plugin/` marketplace manifest inside prisma/skills, keeping one repo in sync with ORM releases.
- **Offer acknowledgement scope** — working position: per-machine; init and docs remain the discovery paths for users who declined once.
- **Draft-doc reconciliation** — working position: `docs/plans/agent-native/` remains the detailed task reference during execution; project-level truth lives here; close-out migrates whatever proves long-lived into `docs/`.

## References

- Project spec: [`./spec.md`](./spec.md)
- Project plan: [`./plan.md`](./plan.md)
- Draft task docs: `docs/plans/agent-native/` (000–010, commit f462cb0a8)
- Research grounding: NPS infrastructure (`packages/cli/src/utils/nps/survey.ts`), prisma-next `skill-install.ts`, engine filter semantics (`query-compiler/.../filters/mod.rs`, connector-test-kit `filters.rs`)
