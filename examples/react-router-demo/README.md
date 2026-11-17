# react-router-demo

A minimal React Router v7 Framework Mode example that proves Prisma 8's Vite plugin re-emits contract artifacts on save, inside a real framework.

## What this demonstrates

- `@internal/vite-plugin-contract-emit` auto-emits `contract.json` + `contract.d.ts` on dev-server startup and on every contract edit.
- A React Router `loader` and `action` on `/` exercise the Prisma 8 runtime against Postgres via the emitted contract.
- Editing `prisma/contract.prisma` (or `prisma/contract.ts`) while `pnpm dev` is running re-emits the artifacts — no manual `prisma contract emit`.

## Prerequisites

- Node ≥ 24
- A Postgres instance reachable via `DATABASE_URL`

## Quickstart

```bash
cp .env.example .env   # edit DATABASE_URL
pnpm install
pnpm db:init           # creates the prisma_contract.marker table + your model tables
pnpm dev
```

Open <http://localhost:5173>. Create a user via the form; the list revalidates after the action.

## Switching authoring surfaces

The same `prisma.config.ts` supports both PSL and TypeScript contract authoring, selected at dev-server startup by one env var:

```bash
# PSL (default) — watches prisma/contract.prisma
pnpm dev

# TypeScript — re-emits when prisma/contract.ts (or anything else imported by
# prisma.config.ts) changes
PRISMA_CONTRACT_SOURCE=ts pnpm dev
```

The TypeScript surface does not declare an explicit watch path. Instead,
`prisma.config.ts` imports `./prisma/contract.ts`, which puts that file in
the config's module graph; the Vite plugin walks that graph and adds every
non-`node_modules` file to its watch set, so editing any of them triggers a
re-emit.

Re-toggling mid-session requires restarting the dev server; the config is read once at startup.

## Proving auto-emit by hand

1. `pnpm dev`
2. Load <http://localhost:5173> and submit the form once to confirm the runtime works.
3. Edit `prisma/contract.prisma` — add a nullable column to `model User`, e.g. `nickname String?`.
4. Save. The dev server emits a new `src/prisma/contract.json` and `src/prisma/contract.d.ts` without any command.
5. Reload the page. The app still serves; types in your editor pick up the new field.

For the TypeScript path, start with `PRISMA_CONTRACT_SOURCE=ts pnpm dev` and edit `prisma/contract.ts` instead.

## HMR runtime cache

This example keeps a small module-local runtime cache in `app/lib/db.server.ts`. When Vite re-executes that module after a contract re-emit, the `import.meta.hot.dispose()` handler closes the old pool and clears the cached client so the next request rebuilds the runtime from the fresh `contract.json`.

That is enough for this validation app, but it is still example-local and depends on Vite's module invalidation path. A future hash-keyed dev helper could make stale-runtime avoidance explicit and reusable across frameworks.

## Scripts

| Script | Purpose |
|---|---|
| `pnpm dev` | Start Vite dev server with React Router and auto-emit |
| `pnpm build` | Production build |
| `pnpm start` | Serve the production build |
| `pnpm emit` | Explicit contract emit (normally unnecessary in dev) |
| `pnpm db:init` | Create the `prisma_contract.marker` table and your model tables |
| `pnpm test` | Run the smoke test |
| `pnpm typecheck` | `react-router typegen` + `tsc --noEmit` |
| `pnpm lint` | Biome |
