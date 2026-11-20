# Task: Install Prisma Skills During `prisma init`

## Overview

Make `prisma init` install the Prisma skills from [prisma/skills](https://github.com/prisma/skills)
into the freshly scaffolded project, so agents working in that project immediately have
current, version-appropriate Prisma knowledge. Modeled on prisma-next's init skill
distribution, adapted to the stable CLI's constraints.

## Prior art: prisma-next

`packages/1-framework/3-tooling/cli/src/commands/init/skill-install.ts` in
[prisma/prisma-next](https://github.com/prisma/prisma-next):

- Shells out to the upstream `skills` CLI, once per skill source, fully non-interactive:

  ```bash
  pnpm dlx skills@latest add prisma/prisma-next/skills#v<cliVersion> \
    --agent cursor claude-code codex windsurf --skill '*' -y
  ```

- The runner adapts to the detected package manager (`npx` / `pnpm dlx` / `yarn dlx` / `bunx` /
  `deno run -A npm:`).
- Usage skills are pinned to the CLI's own version (`#v<cliVersion>`); upgrade skills track `main`.
- Installs for all four agent runtimes unconditionally; no agent detection, no prompts.
- `--no-skill` opts out; a failed install is fatal (error code 5013).
- Results land in `.claude/skills/<name>/SKILL.md` and `.agents/skills/<name>/SKILL.md`, with a
  `skills-lock.json` at the project root.

## Design

### Behavior

- After the existing scaffolding succeeds (schema, `prisma.config.ts`, `.env`, `.gitignore`),
  run the skill install and append the written paths to the `GeneratedFiles` summary.
- **Default on, opt out via `--no-skills`.** Follows the prisma-next precedent and the goal of
  zero-configuration agent readiness. (Alternative considered: install only when an agent
  environment is detected — see Open questions.)
- Install for the same runtime list as prisma-next (`cursor claude-code codex windsurf`),
  defined as a constant so it can grow.
- **Non-fatal on failure** (deviation from prisma-next): the stable CLI must not fail init over
  a network hiccup in an auxiliary step. On failure, print the exact command to run manually.
- **Pinned `skills` CLI version** (deviation from prisma-next's `skills@latest`): execute
  `skills@<exact-vetted-version>` to keep the supply chain reviewable. Bump via Renovate.
- Skip silently when `--non-interactive` is combined with an environment where `npx` would
  prompt to download, or when offline (detect by the runner's failure, same non-fatal path).

### Version pinning of the skills source

prisma/skills targets a specific ORM minor (currently 7.6.x per SKILL.md metadata). Install
`prisma/skills#v<matching-tag>` when a tag matching the CLI's minor exists, falling back to the
default branch. This requires release automation on prisma/skills (tag per supported ORM minor);
file that ask on the skills repo as part of this task.

## Scope

### Files to modify (prisma/prisma)

1. `packages/cli/src/init/skill-install.ts` (new) — the runner: package-manager detection,
   pinned `skills` version constant, agent-runtime list, command assembly, non-fatal error
   handling. Written to be reused by task 002.
2. `packages/cli/src/Init.ts` — add `--no-skills` to the arg spec and help text; invoke the
   runner after scaffolding; thread results into the summary output.
3. `packages/cli/src/init/generated-files.ts` — summary lines for installed skill paths.
4. `packages/cli/src/__tests__/` — unit tests for the runner (command assembly per package
   manager, opt-out, failure path); init integration test asserting `--no-skills` and the
   default path (with the runner mocked).

## Steps

1. Extract the runner design from prisma-next's `skill-install.ts` (command shape only; the
   code is not directly portable) into `packages/cli/src/init/skill-install.ts`.
2. Wire into `Init.ts` behind `--no-skills`, after scaffolding, before the success message.
3. Add summary output and the "run this manually" failure hint.
4. Tests as above.
5. File the tagging-automation issue on prisma/skills.

## Acceptance criteria

- `prisma init` in a clean directory produces `.claude/skills/prisma-*/SKILL.md` and
  `.agents/skills/prisma-*/SKILL.md` (when the network allows) and lists them in the summary.
- `prisma init --no-skills` writes nothing agent-related and prints no skill output.
- A failing `skills` invocation leaves init successful, with a manual-install hint.
- No user-level (global) paths are ever written.

## Open questions

- **Default-on vs detection-gated.** Unconditional install writes `.claude/` and `.agents/`
  into every new project, including ones never touched by an agent. If that proves contentious,
  the fallback design is: install by default only when an agent environment is detectable
  (markers from `packages/migrate/src/utils/ai-safety.ts`, or presence of `.claude/`, `.cursor/`,
  `AGENTS.md` in the target directory), otherwise print a one-line hint. Decide during review.
- Should `--prompt` / `--vibe` (the AI init path) force-enable the install even if the general
  default becomes detection-gated? (Recommend: yes — that path is agent-driven by definition.)
- Whether to write skills into `.gitignore`-excluded paths or commit them (recommend: commit;
  skills are project documentation, and `skills-lock.json` records provenance).
