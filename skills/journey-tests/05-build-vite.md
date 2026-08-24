# Journey 05 — Vite plugin happy path

**Skill under test:** `prisma-next-build`.

**Acceptance criterion:** The build workflow routes to the Vite plugin path and avoids unsupported package names.

## Setup

A fresh Vite + React project that has run `prisma orm init`:

```bash
mkdir my-vite-app && cd my-vite-app
pnpm dlx @prisma/cli orm init
pnpm add vite @vitejs/plugin-react react react-dom
```

The agent runtime has Prisma Next skills registered (project level, as `init` installs them).

## Prompt

> set up automatic contract emission during `vite dev`

## Expected agent behaviour

- [ ] Skill matcher fires on `prisma-next-build` (description contains "vite plugin", "vite.config.ts", "contract emit on save").
- [ ] Agent installs `@internal/vite-plugin-contract-emit` as a devDependency via the project's package manager.
- [ ] Agent edits `vite.config.ts` to register `prismaVitePlugin('prisma.config.ts')` (note: the argument is the *config path*, not the schema path).
- [ ] Agent starts `vite dev` (or instructs the user to) and waits for the initial emit log line.
- [ ] Agent demonstrates the re-emit by editing the contract source (adds a model or a field), observes the re-emit log within ~150ms, and confirms the type-check still passes without restarting the dev server.
- [ ] Agent adds a `prebuild` script to `package.json` (or notes that one exists) running `prisma contract emit` so CI / production `vite build` is covered.

## Success criteria

- [ ] `vite.config.ts` contains `prismaVitePlugin('prisma.config.ts')`.
- [ ] `pnpm dev` (or `pnpm vite`) emits the contract on startup.
- [ ] Editing the contract source triggers a re-emit log line.
- [ ] `package.json` contains a `prebuild` script that runs `prisma contract emit`.
- [ ] Agent did NOT confabulate `@internal/vite` or any other package name that doesn't exist.
- [ ] Agent did NOT point the plugin at `schema.psl` / `prisma/contract.ts` directly (the argument is the config path).
