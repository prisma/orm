# Slice 1: `orm init` on a Prisma 7 Postgres project

_Parent project: `projects/orm-init-prisma7-detection/`. Outcome: a Prisma 7 Postgres project run through `prisma orm init`, by flag or by answering two questions, ends up set up for Prisma 8 beside Prisma 7 with `schema.prisma` as the contract source, and `prisma db sign` then succeeds against its database._

## At a glance

```bash
prisma orm init --from-prisma7-schema prisma/schema.prisma --confirm my-app
```

Writes `prisma.config.ts`, `src/prisma/db.ts`, `prisma-8.md`, `.env.example`; merges `tsconfig.json`, `.gitignore`, `.gitattributes`, `package.json`; renames `prisma.config.ts` to `prisma7.config.ts`; installs `@prisma/orm-postgres`, `dotenv`, `prisma@latest`, `@prisma/prisma7`; emits `src/prisma/contract.json` and `contract.d.ts`. The interactive run reaches the same state through one yes/no question and one consent prompt.

## Chosen design

### Detection (`commands/init/prisma7-detect.ts`, new)

One function reads the project and returns what init would otherwise ask for:

- **Schema path.** The flag value when given. Else the `schema` field of the Prisma 7 config when one evaluates. Else `prisma/schema.prisma`. The path may be a file or a directory of `.prisma` files.
- **Prisma 7 config.** `prisma.config.{ts,mts,cts,js,mjs,cjs}` in the working directory, or `prisma7.config.*` when only that exists (a project that already did the guide's section 1). Evaluated through a new `@internal/config-loader` export that returns the raw default export of a config module using the same c12 evaluation `loadConfig` uses. The export is a Prisma 7 config when it is an object without the `$prismaConfig` marker. Only `schema` is read from it. An evaluation failure is a warning, not an error; detection continues with the default path.
- **Provider.** The `provider` value of the `datasource` block, found by scanning the schema text (all files when a directory). No `datasource` block means the path is not a Prisma 7 schema.
- **Prisma 7 CLI.** `prisma` in `package.json` `devDependencies` or `dependencies` with a major below 8, read from `node_modules/prisma/package.json` when installed, else from the declared range. `@prisma/prisma7` already declared means section 1 is done.

### Inputs (`orm/init-inputs.ts`)

- New flag `--from-prisma7-schema <path>`. Given together with `--schema-path` or `--authoring` is `CLI.INIT_FLAG_CONFLICT` (new), naming both flags.
- Without the flag, when neither `--authoring` nor `--schema-path` was given and detection finds a Prisma 7 config or a schema with a `datasource` block, the interactive run asks `<path> is a Prisma 7 schema. Use it as the Prisma 8 contract source?` (default yes). No, or a non-interactive session, runs init as today. This question comes before the target and authoring questions, which it replaces.
- The provider picks among the known targets (`postgresql`, `mongodb`). A provider with no known target is `CLI.INIT_PRISMA7_PROVIDER_UNSUPPORTED` listing both; a `--target` that disagrees with the provider is `CLI.INIT_PRISMA7_TARGET_MISMATCH`; a path with no `datasource` block is `CLI.INIT_PRISMA7_SCHEMA_INVALID`. With the flag, all exit 2 before anything is asked, installed, or written; without it, the Prisma 7 question is not asked when the target cannot be resolved. `--target` can name the database only when the provider is not a string literal.
- Before any consent question, init installs the target package and `dotenv`, loads the package's `/config` entrypoint from the project, and runs its `prisma7Schema` without writing (design notes D10). A refused schema is `CLI.INIT_PRISMA7_SCHEMA_REFUSED` with the source's diagnostics and the command that removes the two packages. A package without `prisma7Schema` turns a run entered through the question into a fresh init and refuses a run given the flag with `CLI.INIT_PRISMA7_SOURCE_UNAVAILABLE`.
- When a Prisma 7 CLI is declared and `@prisma/prisma7` is not, init asks the existing token consent: `Prisma 7 is installed as \`prisma\`. Keep it as @prisma/prisma7 (binary prisma7) and move \`prisma\` to Prisma 8?` Declined is `errorInitUserAborted`. `--confirm <dir>` answers it non-interactively, as for re-init.
- `ResolvedInitInputs` gains the contract source (`starter` with authoring and schema path, or `prisma7-schema` with the schema path) and the side-by-side plan (`null`, or the config file to rename and the scripts to rewrite). Re-init consent applies to init's own files only; the Prisma 7 schema is never in the replace list.

### Scaffold (`orm/init-scaffold.ts`, `commands/init/templates/*`)

- No starter schema. `prisma.config.ts` imports `prisma7Schema` beside `defineConfig` from the target's `/config` entrypoint and writes `contract: prisma7Schema('<schema path>', { output: 'src/prisma/contract.json' })`. Everything else in the template is unchanged.
- `db.ts` goes to `src/prisma/db.ts`. Gitattributes lines and stale-artifact cleanup use `src/prisma/`.
- `prisma-8.md` says the contract source is the Prisma 7 schema and shows the transition loop instead of a starter schema sample.
- **Side-by-side edits**, only after consent, planned before any write like the rest of the scaffold: rename the Prisma 7 config to `prisma7.config.<same extension>` and replace its `prisma/config` import specifier with `@prisma/prisma7/config` (warn when the specifier is not found; rename anyway); in `package.json` scripts, replace the `prisma` binary with `prisma7` in every command that invokes it (scripts init adds keep `prisma`). Both are reported as files written, and the rename is reported as such.
- **Installs.** The existing dependency install adds `@prisma/prisma7@7` as a development dependency and `@prisma/client@7` as a dependency when `@prisma/client` is declared below the Prisma 7 CLI's version, alongside `prisma@latest`, so the package manager moves `prisma` to 8 and keeps client and CLI at the same Prisma 7 version. `--skip-install` lists them as next steps instead.

### Output and next steps (`commands/init/output.ts`, `orm/init-blocks.ts`)

- `authoring` gains the value `prisma7`. `schemaPath` is the Prisma 7 schema path. A new `prisma7` block records the renamed config, the rewritten scripts, and the Prisma 7 packages installed; `null` on a normal run.
- Next steps on the Prisma 7 path, in order: set `DATABASE_URL`; `prisma db sign`; move routes one at a time to the client in `src/prisma/db.ts`; after each `prisma7 migrate dev`, run `prisma contract emit` then `prisma db sign`; when `@prisma/client` moved, `prisma7 generate`. There is no cutover step. The typed `nextActions` carry the same steps.

### Docs

`packages/1-framework/3-tooling/cli/README.md` gains an `orm init` section covering the flag, the two questions, what is written and renamed, the `git init` boundary, and the next steps. `docs/reference/error-reference.md` gains the new codes (`pnpm check:error-reference`).

## Coherence rationale

One PR: a reviewer follows one path (detect, ask, scaffold, install, emit, report) through files that already exist for the normal path, with the fixture project as the single worked example. The side-by-side edits are the only new kind of write and sit in one planned block.

## Scope

**In:** everything above, unit tests per module, CLI-harness tests through `createTestCli` with the fake emit, a checked-in Prisma 7 fixture project under `test/fixture-app/fixtures/prisma7-project/`, and the end-to-end test that runs real emit and `db sign` against a dev database once `prisma7Schema` is on `main`.

**Deliberately out:** Mongo (slice 2), reading anything but `schema` from the Prisma 7 config, the connection expression, `contract convert`, any change to `"type": "module"` or tsconfig handling, the `prisma/config` import (orphan slice).

## Pre-investigated edge cases

| Case | Disposition |
|---|---|
| `prisma.config.ts` evaluates and carries the `$prismaConfig` marker | It is a Prisma 8 config; no Prisma 7 config exists. Detection still runs on the schema path. |
| Both `prisma.config.ts` (Prisma 7) and `prisma7.config.ts` exist | Warn, treat `prisma7.config.ts` as the Prisma 7 config, and stop with `CLI.INIT_PRISMA7_CONFIG_COLLISION`: init cannot rename onto an existing file. |
| Prisma 7 config imports from `@prisma/prisma7/config` already but is still named `prisma.config.ts` | Rename only. |
| `prisma` declared at major 8 or `@prisma/prisma7` declared | No consent prompt, no side-by-side edits. |
| `--skip-install` | Side-by-side file edits still happen under consent; package changes are listed as next steps. |
| `src/prisma/db.ts` or `prisma.config.ts` written by an earlier init exist | Normal re-init consent. The Prisma 7 schema never appears in the list. |
| Schema directory with the `datasource` block in one file | Provider found across files. |
| Prisma 7 config is `.mts`/`.cts`/`.js` | Renamed with the same extension. |
| F14: gates must mirror CI | Run `pnpm lint` in the CLI package as well as typecheck and tests. |
| F13: refusal tests must discriminate | Each refusal test asserts the code and that no file was written. |

## Slice definition of done

Inherits `drive/calibration/dod.md`. Slice-specific:

- [ ] The fixture project run non-interactively and interactively matches § At a glance; `prisma/` is byte-identical afterwards.
- [ ] Every refusal and the declined consent write nothing.
- [ ] With PR #30287 merged: real `contract emit` then `prisma db sign` succeeds with zero findings against a dev database built from the fixture's Prisma 7 migration SQL.
- [ ] CLI README and error reference updated.

## Open questions

None.

## References

- Project spec and `design-notes.md` (D3 for the side-by-side ruling, D4, D5).
- `packages/1-framework/3-tooling/config-loader/src/load.ts` (marker check, c12 evaluation).
- `packages/1-framework/3-tooling/cli/src/orm/init-inputs.ts`, `init-scaffold.ts`, `init.ts`, `init-packages.ts`, `commands/init/hygiene-package-scripts.ts`, `commands/init/templates/code-templates.ts`, `commands/init/output.ts`, `orm/init-blocks.ts`.
- Tests: `packages/1-framework/3-tooling/cli/test/orm/init-*.test.ts`, `test/utils/test-project-dir.ts`.
- `prisma7Schema` signature: `packages/3-extensions/postgres/src/config/prisma7-schema.ts` on branch `bot/prisma7-contract-source` (PR #30287); example project `examples/prisma7-adoption/` on the same branch.
- Fixture corpus with Prisma 7 migration SQL: `packages/2-sql/2-authoring/contract-prisma7/test/fixtures/` on the same branch.
