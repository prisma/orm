# Task: Skill + Claude Code Plugin — `prisma generate` After Schema Changes

## Overview

The most common agent failure loop in Prisma projects: edit `schema.prisma`, then write client
code against models/fields the generated client does not have yet, then misdiagnose the type
errors. Fix it twice over: a skill that teaches the rule, and a Claude Code plugin whose hook
makes it automatic.

## Part 1: Skill (prisma/skills)

Content:

- The invariant: after any change to `schema.prisma` (or schema folder files), run
  `prisma generate` before touching client code. TypeScript errors like "Property 'newModel'
  does not exist on type 'PrismaClient'" almost always mean a stale generated client, not a
  schema mistake.
- When a migration is also needed (`migrate dev` regenerates; plain `generate` does not touch
  the database) — a decision table for schema-edit → which command.
- Watch-mode alternatives (`prisma generate --watch`, `prisma dev`) and their trade-offs.
- Where the client is generated (custom `output`, the Prisma 7 default `../generated/prisma`)
  and why stale imports of an old output path produce the same symptoms.

## Part 2: Claude Code plugin

A plugin (skills + hooks bundle) so the rule needs no recall at all:

- **Hook**: `PostToolUse` matching `Edit|Write`; the hook command checks whether the touched
  file matches `**/*.prisma` (and the project has a `prisma.config.ts` or `prisma/` directory)
  and, if so, runs `prisma generate --no-hints`, surfacing errors back to the agent.
  Debounce/short-circuit when generate is already running (watch mode, `prisma dev`).
- **Bundled skills**: this skill plus the pitfalls skill (task 007) so plugin users get the
  knowledge and the automation together.

### Distribution decision (open)

prisma/skills is an Agent Skills catalog, not a Claude Code plugin marketplace (no
`.claude-plugin/` manifest today). Options:

1. Add a `.claude-plugin/marketplace.json` to prisma/skills so it serves both ecosystems from
   one repo (skills stay `npx skills add`-able; Claude Code users add the marketplace).
2. A separate `prisma/claude-plugin` repo.

Recommend option 1 — one repo to keep in sync with ORM releases. Confirm with the skills repo
maintainers; the hook must remain useful when only the skills (not the plugin) are installed.

## Scope

- prisma/skills: new `prisma-generate-workflow` skill (name per repo conventions) +
  marketplace manifest and hook script if option 1 is chosen.
- No prisma/prisma changes.

## Acceptance criteria

- Skill: an agent that edited the schema regenerates before writing queries, and picks
  `migrate dev` vs `generate` correctly per the decision table.
- Plugin: editing a `.prisma` file in a Claude Code session triggers a generate run whose
  failure output reaches the agent; non-Prisma projects are untouched (matcher guards).
