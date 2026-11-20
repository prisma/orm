# Slice: init-skill-install

_(Parent project `projects/agent-native/`. Outcome: every `prisma init` project can start with
the Prisma skills installed for the major agent runtimes, with a clean opt-out.)_

## At a glance

`prisma init` gains a final scaffolding step that installs the
[prisma/skills](https://github.com/prisma/skills) catalog into the new project via the
upstream `skills` CLI, for cursor / claude-code / codex / windsurf, behind a `--no-skills`
opt-out. Introduces the shared install runner that slice `generate-skill-offer` reuses.

## Chosen design

New module `packages/cli/src/init/skill-install.ts`:

- Constants: `SKILLS_CLI_VERSION` (exact pinned version of the `skills` npm package, never
  `latest`), `SKILL_AGENTS = ['cursor', 'claude-code', 'codex', 'windsurf']`,
  `SKILLS_SOURCE = 'prisma/skills'`.
- `detectRunner(cwd)`: package-manager detection via `npm_config_user_agent`, falling back to
  lockfile sniffing in `cwd`, defaulting to npm. Maps to `npx --yes` / `pnpm dlx` /
  `yarn dlx` / `bunx` (bun detected via a runtime check). Yarn 1 (classic) has no `dlx` —
  a `yarn/1.x` user agent routes to the `npx --yes` path instead (yarn-1 setups ship npm).
  `--yes` on the npx path is load-bearing (see edge cases).
- `installSkills({ cwd })`: assembles and executes (via `execa`, streaming output)

  ```
  <runner> skills@<SKILLS_CLI_VERSION> add prisma/skills \
    --agent cursor claude-code codex windsurf --skill '*' --copy -y
  ```

  `--copy` is load-bearing: with multiple `--agent` values, skills@1.5.14 writes only the
  universal `.agents/skills/` tree and never creates the per-agent symlinks it promises
  (upstream bug, verified 2026-07-03); `--copy` materializes real `.claude/skills/` and
  `.windsurf/skills/` copies so Claude Code and Windsurf find skills where they actually
  look — matching prisma-next's dual-location outcome.

  Returns `{ ok: true }` or `{ ok: false, manualCommand }`. **Never throws** — any failure
  (network, non-zero exit, missing runner) resolves to the failure shape.

`packages/cli/src/Init.ts` wiring:

- `--no-skills` boolean flag added to the arg spec and the `help` text.
- After file scaffolding (and after the PPG flow, when taken), unless `--no-skills`: call
  `installSkills`. On success, append the installed skill locations
  (`.claude/skills/`, `.windsurf/skills/`, `.agents/skills/`, `skills-lock.json`) to the
  summary output; on failure, print a warning with `manualCommand` and continue — init
  still succeeds.

Install source is the prisma/skills default branch for now; `#v<tag>` pinning activates once
the skills repo tags releases (ask prepared as part of this slice — a GitHub issue on
prisma/skills requesting per-ORM-minor tags).

## Coherence rationale

One reviewable unit: a single new module plus its two consumers (Init wiring, summary output)
and tests. Nothing else changes behavior; `generate`-side reuse is deliberately a separate
slice.

## Scope

**In:** `packages/cli/src/init/skill-install.ts` (new);
`packages/cli/src/Init.ts` (flag, help text, invocation, summary);
`packages/cli/src/__tests__/skill-install.vitest.ts` (new — command assembly per package
manager, failure shape) and `packages/cli/src/__tests__/Init.vitest.ts` (integration with the
runner mocked: default path, `--no-skills`, failure is non-fatal); the tagging-ask issue on
prisma/skills.

**Out:** the `generate` offer (slice `generate-skill-offer`); any TTY/CI gating (init's
install is flag-controlled by design); user-level/global agent config; parsing or vendoring
the `skills` CLI's internals; `.gitignore` handling for skill files (they are meant to be
committed).

## Pre-investigated edge cases

| Edge case                                                                                                                 | Disposition                                                                                                                    | Notes                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bare `npx skills@x` prompts "Ok to proceed?" on first use and would hang a non-TTY init                                   | Always pass `--yes` to npx (distinct from `-y` to `skills`)                                                                    | Known npx footgun; pnpm dlx / yarn dlx / bunx do not prompt                                                                                                 |
| `prisma init` in a directory with no `package.json` / lockfile (global CLI invocation)                                    | `npm_config_user_agent` absent → lockfile sniff finds nothing → default npm/npx path                                           | Must not crash detection; unit-test this case                                                                                                               |
| Yarn 1 (classic) has no `dlx`; a `yarn/1.x` UA would assemble a broken `yarn dlx` command                                 | Parse yarn major from the UA; yarn 1 → `npx --yes` path                                                                        | Surfaced by reviewer D1 R1 (2026-07-03); spec amended per I12, fix carried into D2 as a framed side-commit                                                  |
| Yarn 1 project detected via `yarn.lock` with no UA (e.g. globally-installed CLI) still routes to `yarn dlx`               | Accepted residual — a lockfile cannot distinguish classic from berry; failure degrades gracefully (non-fatal + manual command) | Surfaced by implementer D2 R1; routing all lockfile-yarn to npx would punish berry users, and `.yarnrc.yml` sniffing is scope growth for a shrinking cohort |
| skills@1.5.14 multi-agent install silently skips the per-agent symlinks it promises (only `.agents/skills/` materializes) | Pass `--copy` so `.claude/skills/` and `.windsurf/skills/` are real copies                                                     | Falsified spec assumption, I12 halt D3 R1 (2026-07-03); upstream bug report prepared for the operator to file on vercel-labs/skills                         |

## Slice-specific done conditions

- [ ] A real (non-mocked) `prisma init` run in a scratch directory produces
      `.claude/skills/prisma-*/SKILL.md`, `.windsurf/skills/prisma-*/SKILL.md`,
      `.agents/skills/prisma-*/SKILL.md`, and `skills-lock.json`; evidence (command +
      output) attached to the PR description.
- [ ] A simulated install failure (runner pointed at an unreachable version) leaves init
      exit-code 0 with the manual-command hint printed.
- [ ] The tagging ask is prepared verbatim and filed on prisma/skills — filing was
      permission-gated unattended, so it stands as an accepted deferral
      (`unattended-decisions.md` D14; body in `verification.md § Operator to-do`) until the
      operator files it and records the URL.

## Open Questions

1. Exact `SKILLS_CLI_VERSION` to pin. Working position: latest `skills` release at
   implementation time, recorded in the module with a Renovate-friendly literal.

## References

- Parent project: `projects/agent-native/spec.md`
- Linear issue: [TML-2968](https://linear.app/prisma-company/issue/TML-2968/s1-install-prisma-skills-during-prisma-init)
- Task draft: `docs/plans/agent-native/001-init-skill-install.md`
- Prior art: prisma-next `packages/1-framework/3-tooling/cli/src/commands/init/skill-install.ts`
  (deviations here: non-fatal failure, pinned `skills` version, no deno runner)
