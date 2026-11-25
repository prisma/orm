# Manual QA report: the committed API lists

Runner: Opus subagent, 2026-11-24. Branch `tml-3932-api-lists` at `4e8a595ee7`. Script: `projects/public-api-check/manual-qa.md`. Logs of each run are in the worktree's gitignored `wip/qa/`.

Result: all 10 steps pass. No findings. Two observations at the end, neither a defect.

## Setup

### 1. Clean tree and matching lists: pass

`git status --short` printed nothing. `pnpm build` was fully cached (105 of 105). `pnpm api:check`:

```
api:check: all 22 lists match the build
```

## Scenarios

### 2. A new export in source: pass

`@prisma/orm-extension-middleware-cache` is a shell build whose generated `src-gen/index.ts` is `export * from '@internal/middleware-cache'`, so the source is `packages/3-extensions/middleware-cache/src`. Added `export function qaCacheProbe(label: string): string` to `cache-store.ts` and to the value export line in `src/exports/index.ts`. `pnpm build` (exit 0, 5 tasks rebuilt), then `pnpm api:check` (exit 1):

```
api:check: these API lists do not match the build:

packages/9-public/@prisma/orm-extension-middleware-cache/api.txt
  + .: function qaCacheProbe(label: string): string

Run `pnpm build`, then `pnpm api:update`, and commit the changed api.txt files. Do not edit or hand-merge an api.txt.
The lists this run generated are in each package's dist-api/api.txt; in CI they are uploaded as the workflow artifact "api-lists", which can be downloaded from the run.
```

It names the package's `api.txt`, shows the new line with its import path (`.`), and says to run `pnpm api:update`.

### 3. Update: pass

`pnpm api:update`:

```
api:update: 1 of 22 lists changed
  packages/9-public/@prisma/orm-extension-middleware-cache/api.txt
```

`git status` showed only the two source files and that one `api.txt`. Its diff is the single added line `+.: function qaCacheProbe(label: string): string`. `pnpm api:check` then printed `all 22 lists match the build`. Reverted with `git checkout --`.

### 4. A changed signature: pass

In `cache-store.ts`, changed `InMemoryCacheStoreOptions.ttlMs?: number` to `ttlMs: number`. Build (exit 0), check (exit 1):

```
packages/9-public/@prisma/orm-extension-middleware-cache/api.txt
  - .: interface InMemoryCacheStoreOptions, readonly optional property ttlMs?: number
  + .: interface InMemoryCacheStoreOptions, readonly required property ttlMs: number
```

Old and new wording are both readable. Reverted.

### 5. A type-only export turned into a value export: pass

`packages/3-extensions/paradedb/src/exports/pack.ts` has `export type { ParadeDbProximityChain, ProximityWithinOptions } from '../core/proximity-chain'`, and `ParadeDbProximityChain` is a class. Changed it to `export { ParadeDbProximityChain, type ProximityWithinOptions } from ...`. Build (exit 0), check (exit 1):

```
packages/9-public/@prisma/orm-extension-paradedb/api.txt
  - ./pack: export type class ParadeDbProximityChain implements Expression<{ codecId: 'pg/text@1'; nullable: false; }>
  + ./pack: class ParadeDbProximityChain implements Expression<{ codecId: 'pg/text@1'; nullable: false; }>
```

Reverted.

### 6. A merge conflict in a list: pass

- `git switch -c qa-scratch-a 4e8a595ee7`; added `export function qaAlpha(): number` to `cache-store.ts` and its export line; `pnpm build`; `pnpm api:update` (1 list changed); committed (`c8a26a3f86`).
- `git switch -c qa-scratch-b 4e8a595ee7`; added `export function qaBeta(): number` to `cache-middleware.ts` and its export line; build; update; committed (`ed321b50cb`).
- `git merge --no-edit qa-scratch-a` on `qa-scratch-b`: source files merged cleanly, the list conflicted:

```
CONFLICT (content): Merge conflict in packages/9-public/@prisma/orm-extension-middleware-cache/api.txt
<<<<<<< HEAD
.: function qaBeta(): number
=======
.: function qaAlpha(): number
>>>>>>> qa-scratch-a
```

- Following the note: `pnpm build` (exit 0, during the unfinished merge), then `pnpm api:update` (`1 of 22 lists changed`). The file had no conflict markers left and held both lines, `qaAlpha` then `qaBeta`. `pnpm api:check`: `all 22 lists match the build`. `git add` of the list and `git commit --no-edit` finished the merge (`5b9496802d`).
- Returned to `tml-3932-api-lists` and deleted both scratch branches with `git branch -D`. Nothing was pushed.

### 7. A missing build: pass

Rebuilt first so the build matched the head again. Moved `packages/9-public/@prisma/orm-extension-middleware-cache/dist` to `wip/qa/moved/dist`. `pnpm api:check` (exit 1):

```
api:check: could not list the API of every package:

packages/9-public/@prisma/orm-extension-middleware-cache: 1 declaration file(s) missing, such as dist/index.d.mts. Run `pnpm build` first.
```

Moved it back; `pnpm api:check` passed.

### 8. Reading the list: pass

Five lines of `packages/9-public/@prisma/orm-postgres/api.txt`, each checked against `dist/*.d.mts`:

| Kind | Line | Evidence in the build |
| --- | --- | --- |
| Function | `./config: function defineConfig(options: PostgresConfigOptions): PrismaConfig<'sql', 'postgres'>` | `dist/config.d.mts` declares it with that signature and exports `defineConfig`. `./config` maps to that file in `package.json`. |
| Interface member | `./config: interface PostgresConfigOptions, readonly optional property db?: { readonly connection?: string; }` | Same file: `readonly db?: { readonly connection?: string; }`, interface exported as `type PostgresConfigOptions`. |
| Forward | `./adapter/adapter: everything from @prisma/orm-target-postgres/adapter/adapter` | `dist/adapter__adapter.d.mts` is exactly `export * from "@prisma/orm-target-postgres/adapter/adapter"`. |
| Type-only export | `./contract-builder: export type Bit from @prisma/orm-target-postgres/target/codec-types` | `dist/contract-builder.d.mts` imports `Bit` from that path and exports `type Bit`. That path is a published export of `@prisma/orm-target-postgres`, whose list has `./target/codec-types: type Bit<N extends number> = ...`. |
| Not exported | `(not exported) const ENUM_TYPE_HANDLE_BRAND = "__prismaEnumTypeHandle__"` | `dist/contract-builder.d.mts` line 212 declares it without exporting it; line 216 uses it as a key in an exported type. It is in no export list. |

Each line says what is importable and nothing more.

### 9. The contributor note: pass

Read `docs/onboarding/Common-Tasks-Playbook.md`, "Update a Package's API List", and followed it without other knowledge:

- "run `pnpm build` and then `pnpm api:update`, and commit the changed lists": worked in steps 2, 3 and 6.
- "After a merge conflict in one, rebuild and run `pnpm api:update` in place of merging it": worked in step 6.
- Its references are correct: CI's `Lint` job runs `pnpm build` then `pnpm api:check` (`.github/workflows/ci.yml`); on failure it uploads `packages/9-public/@prisma/*/dist-api/api.txt` as the artifact `api-lists`; `dist-api/` exists in each package; the scripts are in `scripts/public-api/`; ADR 242 and `docs/glossary.md` use the word "entrypoint".

Nothing needed was missing. See observation 1 for one implicit step.

## Cleanup

### 10. Revert and confirm: pass

All source changes had already been reverted with `git checkout --`. `pnpm build` (fully cached, 105 of 105), `pnpm api:check`: `all 22 lists match the build`. `git status --short` printed nothing. Branch `tml-3932-api-lists` at `4e8a595ee712cc93e5075471ab3edef6dfe69c48`; no `qa-*` branches remain. Nothing was left running.

## Findings

None.

## Observations (not defects)

1. After a merge conflict, the note says to rebuild and run `pnpm api:update` but not to `git add` the list and finish the merge. Any contributor resolving a conflict does that anyway, and git's own message says so. No change suggested.
2. The list marks a type-only export of a class as `export type class …` (step 5) but prints an own interface exported with `type`, such as `PostgresConfigOptions`, as plain `interface …`. That is consistent with what is importable, because an interface is never a value either way.
