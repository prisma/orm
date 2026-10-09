# ADR 269 — One Node.js range for every Prisma 8 tool

**Status:** Accepted
**Date:** 2026-10-09
**Amends:** [ADR 222 — Version support policy](ADR%20222%20-%20Version%20support%20policy.md)

---

## Decision

Every Prisma 8 package declares this `engines.node` range:

```json
"engines": { "node": "^22.18.0 || ^24.11.0 || >=26.0.0" }
```

In prose: Node.js 22.18 or newer on the 22 line, 24.11 or newer on the 24 line, or 26 or newer, each with the npm that ships with that Node.js release (npm 10 on Node.js 22).

The same range applies to every Prisma 8 tool: the `@prisma/orm-*` packages in this repository, the `prisma` CLI, Composer, `create-prisma`, and the projects `create-prisma` generates. A user who meets the requirement of one tool meets the requirement of all of them.

## Why one range

A user meets the Prisma 8 tools one after another: `create-prisma` scaffolds a project, the project installs `@prisma/orm-postgres`, and the user runs the `prisma` CLI. When each tool states a different Node.js requirement, the user finds out which one is strictest only when an install warns or a command fails. One range removes that.

## Why these versions

- **22.18** is the first Node.js 22 release that runs `.ts` files without a flag. Users run `node migration.ts` to emit a migration, so a Node.js version that cannot run `.ts` files cannot use Prisma 8 migrations.
- **24.11** is the first Long Term Support release of Node.js 24.
- **26 or newer** covers current and future releases.

## Enforcement

- `NODE_ENGINES_RANGE` in `scripts/validate-node-engines.mjs` is the source of truth. `pnpm lint:manifests` fails when a publishable package lacks `engines.node`, or when any package under `packages/` declares a different range. The check covers only `packages/`.
- `tsdown` derives each package's build target from `engines.node`, so every package builds for `node22.18.0`, the lowest version in the range.
- The examples under `examples/` are applications. They declare the same range unless a framework they use needs a narrower one; `examples/react-router-demo` declares `^22.22.0 || ^24.11.0 || >=26.0.0` because React Router needs Node.js 22.22 or newer.
- The scaffold READMEs that `prisma orm init` writes, the repository README, and [Supported Versions](../../Supported%20Versions.md) state the range in prose.

The repository's own development toolchain is separate: the root `package.json` and `.tool-versions` choose the Node.js version contributors and CI use, and this ADR does not change them.

## Consequences

- Node.js 22.18 and newer 22.x releases become supported. CI runs the test suites on the Node.js version in `.tool-versions` (a 24.x release); it does not yet run them on Node.js 22 or 26.
- `tsdown` lowers syntax to Node.js 22.18. It does not check built-in APIs: code must not call an API newer than Node.js 22.18, and only a test run on Node.js 22.18 catches one that does.

## Alternatives considered

- **Keep `>=24`.** This excludes users on Node.js 22, which is still a supported Long Term Support line, and it differs from the range `create-prisma` already declares.
- **A range per tool.** Each tool could state only what it needs. Users would then have to meet the strictest requirement across several tools without being told which one it is.
