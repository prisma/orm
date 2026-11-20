# Agent-Native Prisma ORM — Spec and Task Index

## Vision

AI agents are now a primary operator of Prisma: they scaffold projects, edit schemas, run
migrations, and debug production incidents. "Agent-native" means an agent operating Prisma
succeeds by default:

1. **Knowledge where agents look.** Prisma-authored skills are installed into the project
   (`.claude/skills/`, `.agents/skills/`) so agents work from current, version-matched
   documentation instead of stale training data.
2. **Safe defaults.** Destructive actions are gated behind explicit user consent when an AI
   agent is detected (the AI safety checkpoint).
3. **Documented sharp edges.** API behaviors that confuse humans and agents alike (empty
   logical operators, vacuous `every`, silently dropped `undefined`) are documented in skills
   with exact, engine-verified semantics — and fixed in the product where feasible.
4. **Machine-friendly surfaces.** The CLI never hangs waiting for input in non-interactive
   contexts, and agent-facing entry points (`prisma mcp`, skills, the platform CLI) are
   discoverable and mutually consistent.

## Current state (verified 2026-07-02)

- **[prisma/skills](https://github.com/prisma/skills)** exists with 8 skills in the
  [Agent Skills](https://agentskills.io/) format (`<skill>/SKILL.md` + `references/`),
  installable via `npx skills add prisma/skills [--skill <name>]`. Skills target ORM 7.6.x:
  `prisma-cli`, `prisma-upgrade-v7`, `prisma-client-api`, `prisma-driver-adapter-implementation`,
  `prisma-database-setup`, `prisma-postgres`, `prisma-compute`, plus an unlisted
  `prisma-postgres-setup`.
- **[prisma/prisma-next](https://github.com/prisma/prisma-next)** already ships init-time skill
  distribution (`packages/1-framework/3-tooling/cli/src/commands/init/skill-install.ts`): init
  shells out to the upstream `skills` CLI once per skill source, non-interactively
  (`--agent cursor claude-code codex windsurf --skill '*' -y`), pins the usage skills to the
  CLI's own version (`#v<cliVersion>`), and supports `--no-skill`.
- **`prisma mcp`** exists (`packages/cli/src/mcp/MCP.ts`): a stdio MCP server exposing
  `migrate-status`, `migrate-dev`, `migrate-reset`, and `Prisma-Studio` tools by shelling back
  into the CLI.
- **AI safety checkpoint** (`packages/migrate/src/utils/ai-safety.ts`) blocks `db drop`,
  `db push --force-reset`, and `migrate reset` when an agent is detected. Marker modernization
  is in review ([PR #29684](https://github.com/prisma/prisma/pull/29684)).
- **NPS survey infrastructure** (`packages/cli/src/utils/nps/survey.ts`) provides exactly the
  machinery a one-time interactive offer needs: TTY detection, CI/container/git-hook gating,
  a 30-second prompt timeout, and once-per-timeframe persistence in the OS config directory.
- **`prisma init`** (`packages/cli/src/Init.ts`) scaffolds schema, `prisma.config.ts`, `.env`,
  and `.gitignore`; it has an AI path (`--prompt`/`--vibe`) and a `--non-interactive` flag, but
  no skill installation.
- **[prisma/prisma-cli](https://github.com/prisma/prisma-cli)** (`@prisma/cli`, binary
  `prisma-cli`) is the separate Prisma Platform / Compute CLI (`auth`, `project`, `branch`,
  `app deploy`, ...). Agents routinely conflate it with the ORM CLI.

## Goals

- Every `prisma init` project can start with Prisma skills installed for the major agent
  runtimes, with a clean opt-out.
- Existing projects get exactly one polite, interactive, time-limited offer to install skills
  on `prisma generate` — never in CI, containers, hooks, or non-TTY contexts.
- The skills catalog covers the highest-frequency failure modes: configuration/URL routing,
  stale generated clients, version and binary-target mismatches, pooling/SSL differences
  between Prisma 6 and 7, API pitfalls, and performance work.
- Confusing product behavior is fixed where cheap (unhide `typedSql`) and documented with
  engine-verified semantics where changing it would be breaking.

## Non-goals

- Building our own skills package manager (we delegate to the `skills` CLI, as prisma-next does).
- Expanding `prisma mcp` functionality (only a safety-interaction audit is in scope here).
- Changing filter semantics such as `OR: []` (breaking; we document instead).
- Docs-site work such as `llms.txt` (tracked outside this repo; listed under Future ideas).

## Task summary

| ID  | Task                                                                                         | Lands in                       | Priority | Status                | Dependencies |
| --- | -------------------------------------------------------------------------------------------- | ------------------------------ | -------- | --------------------- | ------------ |
| 001 | [Install skills during `prisma init`](./001-init-skill-install.md)                           | prisma/prisma                  | High     | Planned               | None         |
| 002 | [One-time skill offer on `prisma generate`](./002-generate-skill-offer.md)                   | prisma/prisma                  | High     | Planned               | 001          |
| 003 | [AI safety checkpoint: land and follow up](./003-ai-safety-checkpoint.md)                    | prisma/prisma                  | High     | In review (PR #29684) | None         |
| 004 | [Skill: connection & configuration routing](./004-skill-connection-config.md)                | prisma/skills                  | High     | Planned               | None         |
| 005 | [Skill + plugin: generate after schema changes](./005-skill-generate-after-schema-change.md) | prisma/skills                  | High     | Planned               | None         |
| 006 | [Skill: troubleshooting suite](./006-skill-troubleshooting.md)                               | prisma/skills                  | Medium   | Planned               | None         |
| 007 | [Skill: API pitfalls & preview-feature guidance](./007-skill-api-pitfalls.md)                | prisma/skills                  | High     | Planned               | None         |
| 008 | [Move `typedSql` out of hidden preview](./008-unhide-typed-sql.md)                           | prisma-engines + prisma/prisma | Medium   | Planned               | None         |
| 009 | [Skill: performance investigation](./009-skill-performance.md)                               | prisma/skills                  | Medium   | Planned               | None         |
| 010 | [Skill: ORM CLI vs platform CLI routing](./010-skill-platform-cli-routing.md)                | prisma/skills                  | Low      | Planned               | None         |
| 011 | [Skill: MongoDB upgrade path (v6 → Prisma Next)](./011-skill-mongodb-upgrade.md)             | prisma/skills                  | Medium   | Planned               | None         |

## Execution phases

### Phase 0: In flight

- Land PR #29684 (task 003). Independent of everything else.

### Phase 1: Content (parallel, no ORM release required)

- Tasks 004, 005, 006, 007, 009, 010, 011 land in prisma/skills and are immediately useful via
  `npx skills add prisma/skills`. They can be authored in parallel by different people.
- Content quality gates distribution: the generate-time offer (002) should not ship before the
  catalog covers at least tasks 004 and 007.

### Phase 2: Distribution (rides a CLI minor release)

- Task 001 first — it introduces the shared skill-install runner (package-manager detection,
  pinned `skills` CLI version, agent-runtime list).
- Task 002 reuses that runner plus the NPS gating/persistence patterns.

### Phase 3: Product changes

- Task 008 (engines change + Wasm bump).
- Future ideas below as they are promoted to tasks.

## Success metrics

- Acceptance rate of the generate-time offer and `--no-skills` opt-out rate on init
  (telemetry via the existing PostHog capture path, task 002).
- Skill install counts (`skills` CLI / repo traffic).
- Reduction in GitHub issues matching the covered failure modes (stale client, pool exhaustion,
  binary targets, destroyed dev databases).

## Risks and mitigations

- **Prompt fatigue.** The generate offer fires at most once ever per machine, only on a TTY,
  outside CI/containers/hooks, with a timeout, and never in the same run as the NPS survey.
- **Writing into user repos unasked.** Init installs skills by default but prints exactly what
  it wrote, supports `--no-skills`, and never touches user-level (global) agent config.
- **Supply chain.** The `skills` CLI is executed via `npx`; we pin an exact, vetted version
  rather than `@latest` (deviating from prisma-next deliberately).
- **Skill staleness.** prisma/skills targets a specific ORM minor; task 001 defines a
  version-pinning strategy (install `prisma/skills#v<matching-tag>` with fallback to default
  branch) and the release-automation ask on the skills repo.
- **Agents answering the human's prompt.** In agent-driven terminals `generate` usually has no
  TTY, so the offer is naturally suppressed; the init path is flag-controlled, not prompted.

## Future ideas (not yet tasks)

- **Structured CLI output for agents**: a `--json` mode for diagnostics-heavy commands
  (`migrate status`, `validate`, version info) so agents stop scraping human-formatted text.
- **Agent eval harness**: scripted scenarios (broken URL, stale client, missing index) measuring
  agent task success with and without skills installed; would give the skills catalog a
  regression suite.
- **MCP surface review**: align `prisma mcp` tool descriptions with the skills catalog and
  document the consent protocol (see task 003's interplay note).
- **Docs site `llms.txt`** and agent-readable error pages behind `pris.ly` short links.
- **Skills release automation**: tag prisma/skills per supported ORM minor so installs can pin.
