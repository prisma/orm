# Task: Skill — ORM CLI vs Platform CLI Routing

## Overview

Two CLIs share the Prisma name: the ORM CLI (`prisma` from the `prisma` package: `generate`,
`migrate`, `studio`, `mcp`, ...) and the Prisma Platform CLI (`prisma-cli` from `@prisma/cli`:
`auth`, `project`, `branch`, `app build/run/deploy`, ...). The platform's docs even suggest
aliasing the latter to `prisma` in package scripts, so agents cannot rely on the binary name
alone. The existing `prisma-compute` skill in prisma/skills covers the platform CLI's
workflows; this task adds the **disambiguation layer** both skills need.

## Content outline

- A decision table: task → CLI. Schema, client, migrations, local studio → ORM CLI. Deploying
  apps, platform projects/branches/environment variables, Compute workloads → `prisma-cli`.
- How to detect which CLI a `prisma` invocation actually reaches in a given project (check
  `package.json` scripts for the alias, `npx prisma -v` output shape, which package is
  installed).
- Verify-before-acting instruction (mirroring the `prisma-compute` skill's existing stance):
  the platform CLI is in beta and its surface moves; run `--help` on the specific group before
  composing commands from memory.
- Explicit "not interchangeable" warnings for the collision-prone commands (`init`, `dev`)
  that exist in both worlds with different meanings.

## Scope

- prisma/skills: a shared reference (e.g. `references/cli-routing.md`) linked from **both**
  `prisma-cli` and `prisma-compute` SKILL.md files, rather than a new top-level skill.
- Small: mostly a table and detection recipes.

## Acceptance criteria

- An agent in a project using both packages picks the right binary for "deploy this app" and
  "create a migration" without trial and error.
- Both SKILL.md files link the shared reference.
