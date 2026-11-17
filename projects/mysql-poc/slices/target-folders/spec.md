# Slice 1 — Every target in one folder per database

**Linear:** [TML-3693](https://linear.app/prisma-company/issue/TML-3693) · **Branch:** `tml-3693-every-target-lives-in-one-folder-per-database` · **Project:** [`../../spec.md`](../../spec.md), decision 1

## At a glance

```text
packages/2-sql/**                                  → packages/2-sql-family/**
packages/3-targets/3-targets/postgres              → packages/3-targets/postgres/1-target
packages/3-targets/6-adapters/postgres             → packages/3-targets/postgres/2-adapter
packages/3-targets/7-drivers/postgres              → packages/3-targets/postgres/3-driver
packages/3-targets/6-adapters/postgres-codec-testkit → packages/3-targets/postgres/4-codec-testkit
packages/3-extensions/postgres                     → packages/3-targets/postgres/9-facade
(the same five for sqlite)
packages/3-mongo-target/1-mongo-target             → packages/3-targets/mongo/1-target
packages/3-mongo-target/2-mongo-adapter            → packages/3-targets/mongo/2-adapter
packages/3-mongo-target/3-mongo-driver             → packages/3-targets/mongo/3-driver
packages/3-extensions/mongo                        → packages/3-targets/mongo/9-facade
```

Package names, published names, imports and emitted code do not change. `packages/3-mongo-target/` and the `3-targets/{3-targets,6-adapters,7-drivers}` folders no longer exist.

## Chosen design

- **A move, not a rewrite.** `git mv` each folder so history follows. The only content edits are paths: config, scripts, relative paths that changed depth, docs and READMEs.
- **Depth changes.** The SQL family packages and the Postgres and SQLite target, adapter and driver keep their depth. The facades and the Mongo packages go one level deeper, so their relative paths to the repo root gain one `../`.
- **Registration.** Every package under `3-targets/<db>/` is registered in `architecture.config.json` with the recipe in `docs/onboarding/Repo-Map-and-Layering.md`: `src/core/*.ts` shared, `src/core/migrations/**` migration, `src/exports/control.ts` migration, `src/exports/runtime.ts` runtime, `src/exports/pack.ts` shared, with non-overlapping globs. Each package keeps the domain and layer it has today. Postgres's target currently registers only six named core files; it gets the full recipe. Fix every violation `pnpm lint:deps` then reports, or record it in [`../../coupling.md`](../../coupling.md) if fixing it is more than a move.
- **Layering test.** `packages/3-mongo-target/1-mongo-target/test/layering.test.ts` stops the Mongo target importing its own adapter or driver. Postgres and SQLite targets get the same test.
- **Stale entries.** Remove the `tsconfig.base.json` references to folders that no longer exist and the dead `5-query-builders/pipeline-builder/**` glob; register the real `5-query-builders/query-builder`.
- **Docs.** Rewrite the layout in `.agents/rules/directory-layout.mdc`, `docs/architecture docs/Package-Layering.md`, `docs/onboarding/Repo-Map-and-Layering.md`, the Architecture Overview's package layout section, the MongoDB Family subsystem doc's package layout section and `docs/reference/Package Naming Conventions.md`. A new ADR records the layout and its reasons (from [`../../design-notes.md`](../../design-notes.md) section 1); ADR 140 gets a note pointing to it. Update every other doc, README, skill and script that names an old path. Historical records stay as written: `upgrade-instructions/releases/**`, and `projects/**` other than this project.
- **`pnpm-lock.yaml`** is regenerated with `pnpm install`, never edited.

## Coherence rationale

One reviewer reads this as renames plus a short list of path edits. Splitting Mongo or the `2-sql` rename into their own PRs would change the same config files twice and leave a layout where some targets are moved and some are not, which the project spec forbids.

## Scope

**In:** the moves above, every path that names them, registration, the layering test, the docs and the ADR.

**Out:** any code change beyond paths. Extension packs stay in `3-extensions/`. The `9-public` shells keep their folders; only the source paths in `shells.ts` change.

## Pre-investigated edge cases

| Case | Disposition |
| --- | --- |
| `dependency-cruiser` treats overlapping globs as both groups | Use `src/core/*.ts`, not `src/core/**`, beside `src/core/migrations/**` |
| Package scripts with relative paths, e.g. the Postgres facade's `emit` script `cd ../../../test/integration` | Recompute for the new depth |
| `pnpm-lock.yaml` records importer paths | Regenerate with `pnpm install` |
| Test fixtures and generated `contract.json` files with paths | Run `pnpm fixtures:check`; regenerate only if paths are stored in them |
| Concurrent MongoDB authoring work (prisma/orm#30832, prisma/orm#30846) edits `2-mongo-family/2-authoring` | Not moved here; no conflict beyond config files |
| Destructive git operations | Forbidden without orchestrator approval |

## Done when

`pnpm build`, `pnpm typecheck`, `pnpm lint:deps`, `pnpm lint`, `pnpm lint:publishability`, `pnpm fixtures:check` and the tests of every moved package pass locally (CI runs the rest), `git log --follow` traces a moved file to its old path, and no tracked file outside the historical records names an old path.
