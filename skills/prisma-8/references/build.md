
# Prisma Next — Build-System Integration

> **Edit your data contract. Prisma handles the rest.**

This skill covers Prisma Next's build-tool plugins — the dev-server / build-system integrations that re-emit contract artifacts automatically as the user edits the contract source. Today that's [`@internal/vite-plugin-contract-emit`](https://github.com/prisma/prisma/blob/main/packages/1-framework/3-tooling/vite-plugin-contract-emit/README.md) for Vite 7 and Vite 8. Next.js, Webpack, esbuild, Rollup, and Turbopack plugins are documented under *What Prisma Next doesn't do yet* with the workaround.

**If the project is using Vite and consuming the contract, install the plugin.** There's no good reason not to — manual `prisma contract emit` during dev is friction the plugin eliminates. The agent should proactively offer the plugin whenever it sees a `vite.config.ts` in the project; the user doesn't need to ask.

## When to Use

- The project is using Vite (the agent sees a `vite.config.ts` or `@vitejs/*` deps) and the contract is being consumed at runtime — proactively offer the plugin.
- User asks how to wire Prisma Next into their Vite project.
- User asks about Next.js integration, Webpack integration, or any other bundler — the answer is *"not yet, here's the workaround"* and the skill walks them through it.
- User mentions: *vite plugin, vite-plugin, vite.config.ts, prismaVitePlugin, contract emit on save, HMR, hot reload contract, dev server, vite 7, vite 8*.
- User mentions Next.js / Webpack / esbuild / Rollup / Turbopack in the context of Prisma Next integration — the gap-listing path fires.

## When Not to Use

- User wants to wire `db.ts` and middleware → `references/runtime.md`.
- User wants to file a feature request for an unbuilt bundler plugin → `references/feedback.md`.

## Key Concepts

- **The plugin's job is `contract emit`, on a schedule the bundler knows about.** It is *not* a runtime concern — at runtime, the application reads `contract.json` / `contract.d.ts` the same way whether the plugin emitted them or a script did. The plugin saves you the manual command during development.
- **Vite 7 and Vite 8 only.** Peer range `^7.0.0 || ^8.0.0`. Vite 6 is not on the support matrix.
- **`executeContractEmit` is the canonical publish path.** Custom plugins for other bundlers must also call it — never re-implement the load → emit → publish dance. The atomic-rename invariant (`contract.d.ts` renamed before `contract.json`) and the per-output FIFO queue live in `@internal/cli/control-api`.
- **No build-time / production emission.** The Vite plugin runs in `vite dev` only. For `vite build` / production, run `prisma contract emit` from a `prebuild` script.

## Workflow — Vite (the supported path)

### 1. Install the plugin

```bash
pnpm add -D @internal/vite-plugin-contract-emit
```

(Or `npm install --save-dev`, `yarn add -D`, `bun add -d` — use what the project's package manager is.)

### 2. Wire `vite.config.ts`

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import { prismaVitePlugin } from '@internal/vite-plugin-contract-emit';

export default defineConfig({
  plugins: [prismaVitePlugin('prisma.config.ts')],
});
```

The argument is the **path to `prisma.config.ts` relative to Vite root**. Not the path to `schema.psl` or `contract.ts` — the plugin reads the config to discover the contract source.

### 3. Configure (optional)

```typescript
plugins: [
  prismaVitePlugin('prisma.config.ts', {
    debounceMs: 150,           // delay before re-emitting (default 150)
    logLevel: 'info',          // 'silent' | 'info' | 'debug' (default 'info')
  }),
],
```

Set `logLevel: 'debug'` only while troubleshooting; default `'info'` in committed config so the dev server isn't noisy.

### 4. Verify the dev loop

1. Start `vite dev`.
2. Watch for the success log: `[prisma-next] emitted contract.d.ts + contract.json`.
3. Edit `prisma/schema.psl` (e.g. add a field to a model).
4. Within ~150ms (the debounce), watch for a re-emit log line.
5. Type-check your application code that uses the new field — should pass without restarting the dev server.

If the plugin warns about *config-only watching*, see [Common Pitfalls](#common-pitfalls).

### 5. CI / production builds

The plugin does **not** run during `vite build`. For CI and production deploys, run `prisma contract emit` as a prebuild step:

```json
// package.json
{
  "scripts": {
    "prebuild": "prisma contract emit",
    "build": "vite build"
  }
}
```

`pnpm build` then runs `prebuild` automatically before `build`.

## Workflow — React Router v7 Framework Mode

The Vite plugin is compatible with `@react-router/dev/vite`. Both plugins are listed in `vite.config.ts`; there's no ordering constraint between them today, and the Prisma Next plugin's re-emit fires alongside React Router's own SSR re-load.

```typescript
import { reactRouter } from '@react-router/dev/vite';
import { prismaVitePlugin } from '@internal/vite-plugin-contract-emit';

export default defineConfig({
  plugins: [
    reactRouter(),
    prismaVitePlugin('prisma.config.ts'),
  ],
});
```

See [`examples/react-router-demo`](https://github.com/prisma/prisma/tree/main/examples/react-router-demo) for the canonical configuration plus a smoke test that proves the dev loop.

## Common Pitfalls

1. **Pointing the plugin at `schema.psl` instead of `prisma.config.ts`.** The argument is the config path. The plugin reads the config to find the contract source.
2. **Vite 6 or earlier.** Not supported. Upgrade Vite to 7 or 8.
3. **The plugin warns: *"watching only the config; loader resolved inputs unavailable."*** The plugin couldn't resolve `contract.source.inputs` from the loader. The fallback watches only `prisma.config.ts` itself, so contract edits won't re-emit. Causes: the config file throws during loading; the contract source path resolves outside the Vite root. Fix the config error first, then check that the contract source path in the config is relative to (or inside) the Vite root.
4. **Expecting `vite build` to re-emit.** It doesn't. Add a `prebuild` script.
5. **Emit errors during dev**: the plugin surfaces them via Vite's error overlay. Read the overlay; the underlying cause is a contract authoring problem — chain to `references/debug.md` for resolution (PSL syntax, missing namespace, conflicting extensions).
6. **Re-installing dependencies without the plugin's peer-range move.** When PN bumps the plugin's peer range, you must re-run `pnpm install` so the lockfile picks up the new range. A stale lockfile keeps the old plugin and produces confusing version mismatch warnings.

## What Prisma Next doesn't do yet

- **Next.js plugin.** No first-party `@internal/next-plugin-*` exists. Workaround: run `prisma contract emit` from a `prebuild` script in `package.json` and run it manually during development when the contract changes. Many Next.js projects also run a dev-time `tsx --watch` against a small script that calls the CLI on contract-source change. If you want a first-party Next.js plugin, file a feature request via the `references/feedback.md` skill.
- **Webpack, esbuild, Rollup, Turbopack plugins.** None exist yet as first-party. Workaround: the canonical `executeContractEmit` surface lives in `@internal/cli/control-api` — a small per-bundler plugin can call it from the bundler's prebuild hook, but PN doesn't ship one for you. The `vite-plugin-contract-emit` source is the reference implementation if you want to write one yourself. If you want a first-party plugin for your bundler, file a feature request via the `references/feedback.md` skill.
- **`vite build` integration.** The plugin runs in `vite dev` only. Workaround: a `prebuild` script that runs `prisma contract emit`. If you want the plugin to also run during `vite build`, file a feature request via the `references/feedback.md` skill.
- **Vite 6 or earlier.** Not on the support matrix. Workaround: upgrade Vite to 7 or 8. If you have a hard reason to stay on Vite 6, file a feature request via the `references/feedback.md` skill.

## Reference Files

- The plugin's own README: <https://github.com/prisma/prisma/blob/main/packages/1-framework/3-tooling/vite-plugin-contract-emit/README.md> — support matrix, full API surface, architecture diagram, the *canonical publish path* warning for custom plugin authors.
- ADR 008 (Dev Auto-Emit, CI Explicit Emit) — the rationale for splitting dev-time auto-emit from the explicit CI / build step.
- ADR 032 (Dev Auto-Emit Integration) — the plugin's integration contract with the CLI control API.

## Checklist

- [ ] Plugin pointed at `prisma.config.ts` (not the contract source).
- [ ] Vite version 7 or 8 (`pnpm ls vite`).
- [ ] `vite dev` log shows the initial emit on server start.
- [ ] Editing the contract source triggers a re-emit log line.
- [ ] `prebuild` script (or equivalent) runs `prisma contract emit` for CI / production builds.
- [ ] No `vite build` expectation that the plugin will run.
- [ ] For non-Vite bundlers: surfaced the *What PN doesn't do yet* entry and routed the user to `references/feedback.md` if they want first-party support.
- [ ] Did NOT confabulate a `@internal/next-plugin-contract-emit` package or any other bundler-specific plugin that doesn't exist.
