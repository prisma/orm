# Slice 1 grounding: the `composer` section holds Composer's configuration

Read from a clone of prisma/composer `main` at `edaf7b27` (five commits after the spec's `58e858b`; the extra commits touch only the engine-failure cause in the alchemy child). Engine read from the installed `@prisma/cli-engine@0.6.2` in that clone's `node_modules`. All paths below are relative to the prisma/composer root unless they say otherwise. `CLI` below means `packages/0-framework/3-tooling/cli/src`.

## Surprises first

1. **The alchemy child imports the config file itself.** `CLI/generate-stack.ts:62,74` and `CLI/dev/generate-dev-stack.ts:65,74` write `import config from "<relative path to prisma-composer.config.ts>"` into `.prisma-composer/alchemy.run.ts`, and pass it to `lower(app, config, …)`. The child re-evaluates the config from scratch (comment at `CLI/operations/execute-deploy-destroy.ts:302-305`; preflight payloads exist only because of this). After the slice the generated file must import `prisma.config.ts` and read `.composer` from its default export. The handler must therefore still know the path of the file that declared the section, so `configPath` does not disappear from the pipeline; it changes meaning from "the Composer config file" to "the `prisma.config.ts` that declared the section". Because the engine merges the section over a chain of files (see item 3), a section split across two files would need the generated file to import each key from its declaring file (`provenance.keys`), or the validator must refuse a split section.
2. **The public programmatic operations lose their config source.** `deploy`, `destroy`, `dev`, `log` on `@prisma/composer/control` (`CLI/exports/control.ts`; guide `docs/guides/deploying.md:316-330`: `deploy({ entry: 'module.ts', stage: 'pr-42' })`) take no config today and rely on the walk-up. `@prisma/composer` must stay engine-free (`scripts/check-cli-engine-pin.mjs` scans its packed dist), so it cannot call the engine's `loadConfig`. Either the operations gain a required `config` (plus the declaring file path for the stack import) input, or they keep a private loader, which contradicts "one loader". This is a public API change the spec does not mention, and `test/integration/test/control.deploy.test.ts` exercises exactly the no-config call.
3. **The engine discovers `prisma.config.ts` from the cwd and walks up to the repository boundary, merging the chain.** `engine-BLU1DuVo.js:1791 discoveryDirs`, `:1907 loadConfig`. The old loader walked up from the entry file. `prisma deploy apps/x/module.ts` run from a repo root now reads the root's file, not `apps/x`'s. Ancestor files are collected automatically: in `examples/store`, running any `prisma` command that needs config inside `modules/catalog` will also evaluate `examples/store/prisma.config.ts` once it carries the `composer` section, which loads Alchemy.
4. **A project that has only the old file never reaches the handler.** Eight of the ten examples, `test/integration` and `website` have `prisma-composer.config.ts` and no `prisma.config.ts`. After migration-by-hand is skipped, the engine finds no section, the validator gets `undefined`, and the engine fails with `CLI.CONFIG_SECTION_INVALID "The 'composer' section is missing: no config file was found"` (`engine-BLU1DuVo.js:3490`) before any handler runs. The handler-side legacy-file check in the design only fires when a `prisma.config.ts` with a valid section exists next to the old file. The most common legacy case needs the absence diagnostic from the validator to mention `prisma-composer.config.ts`, and the validator has no directory to look in when no file was found (`provenance.files` is empty).
5. **Section failures are headlined by the engine, not by Composer's code.** When a validator returns `ok: false`, the engine's error is `CLI.CONFIG_SECTION_INVALID` and Composer's diagnostics ride along as secondary diagnostics (`engine-BLU1DuVo.js:3450`, `needsErrored(sectionInvalidError(...), validation.diagnostics)`). So the legacy-field refusal renders as `CLI.CONFIG_SECTION_INVALID` with `CONFIG.LEGACY_FIELD` (or whatever code) underneath; only the handler-side legacy-file check can put a `CONFIG.` code in the headline, as the spec's example shows.
6. **Examples import `definePrismaConfig` from `@prisma/cli-engine`, not `prisma/config`.** `examples/auth/prisma.config.ts:1`, `examples/orm-demo/prisma.config.ts:1`, both `examples/store/modules/*/prisma.config.ts:1`. No example depends on the `prisma` package, and `test/integration` depends on `prisma@7.9.0`, whose `prisma/config` is Prisma 7's. The spec's "At a glance" import cannot work inside this repo; migrated files must use `@prisma/cli-engine`, and the eight examples without it must add `@prisma/cli-engine@0.6.2` to their dependencies (the child and the engine both resolve it from the app).
7. **The effect pre-flight has a second caller the design notes misname.** The design says "its two callers, as does the standalone binary's start-up use". On `main` the bin does not call it (`CLI/bin.ts`, `CLI/cli.ts`). The two callers are `load-config.ts:295` (`configSource`) and `CLI/operations/shared.ts:132` (`executorLoadFailure`, which turns a failed executor import into `DEPS.EFFECT_VERSION_CONFLICT`). `operations.test.ts:640-679` asserts that conversion through a real breaker preload.
8. **`check-npm-effect-resolution.mjs` healthy shapes also depend on the old flow.** They run `prisma-composer deploy app.ts` with no config and treat reaching the executor as proof Alchemy loads (`:287-312`). With a required section, the engine refuses before the handler, so the executor never loads and the healthy shapes stop proving anything. Both healthy and adversarial shapes need a direct `import('alchemy')`-style probe, not only the adversarial one. The adversarial override is `effect@4.0.0-beta.93` (`:328`); the design verified the import failure with `rc.118`, so the chosen version must be re-verified.
9. **Unknown fields need a custom validator.** Schema-declared sections (`defineConfigSection({ name, schema })`) are arktype types; nothing in the engine rejects undeclared keys (no `onUndeclaredKey`/`"+"` in the dist). To make unknown fields errors, and to give `configPath` its own migration message and keep the duplicate-extension-id check, the section needs a custom `validate` (it can call `validateSectionWithSchema` inside).
10. **User-facing messages outside the loader name the old file.** `CLI/validate-coverage.ts:12,28` (imports `CONFIG_FILENAME` from `load-config.ts`), `packages/0-framework/3-tooling/assemble/src/assemble-services.ts:34`, `packages/0-framework/1-core/core/src/control/deploy.ts:446`. Tests assert them: `assemble-services.test.ts:148`, `core/src/__tests__/lowering.test.ts:665`.
11. **`c12` is declared in three manifests, not one.** `CLI/../package.json`, `packages/9-public/composer/package.json` and `packages/9-public/composer-cli/package.json`. `load-config.ts:27` is its only importer. All three declarations can go.
12. **Dependency-cruiser stops seeing the config imports.** `dependency-cruiser.config.mjs:216-232` excludes `prisma\.config` (twice) while its comment says `prisma-composer.config.ts` files "MUST be cruised". After the move, control-plane imports in configs are no longer cruised unless that exclusion changes.
13. **The standalone binary is close to free.** `engine-cli.ts` already runs the engine loader over `prisma.config.ts` and mounts a pass-through `orm` section. Keeping it working means updating `commands/destroy.ts:77` and `commands/log.ts:80` like deploy and dev, and nothing else in the bin.
14. **The ORM loader will evaluate the shared file inside the alchemy child.** `packages/1-prisma-cloud/1-extensions/target/src/orm-config.ts:51` loads the postgres resource's `prisma.config.ts` with `@prisma/orm-toolchain/config-loader` (c12, ignores other sections). In orm-demo and auth that is the same root file that will hold the `composer` section, so evaluating it now also imports `@prisma/composer-prisma-cloud/control` (Alchemy) through c12/jiti in a process that already loaded it. Worth one real deploy of orm-demo to confirm no double-load problem.

## 1. Call sites and how the pipelines get config today

### Definitions

- `CLI/load-config.ts`: `CONFIG_FILENAMES` (:37), `CONFIG_FILENAME` (:44), `CONFIG_FILENAME_PATTERN` (:46), `LoadedAppConfig { path, config }` (:48), `findConfigPathForEntry` (:55), `missingConfigError` (:68), `configShapeDiagnostics` (:108), `validateConfigShape` (:183), private `evaluateConfig` (:198, c12 with rc/global/package.json off, same-file check), `ConfigLoadRequest { entryPath, configPath?, cwd? }` (:252), private `configSource` (:291, runs `effectResolutionDiagnostic(cwd)` first, then walk-up or explicit path), `resolveConfigFile` (:349), `loadAppConfigDiagnostics` (:377), `loadAppConfig` (:392).
- `CLI/check-effect-resolution.ts`: `findAlchemyPackageDir` (:17), `resolveEffectVersionFrom` (~:32), `requiredEffectVersion` (:64), `effectMismatchError` (:93), `effectResolutionDiagnostic` (:124), `checkEffectResolution` (:140, throws).

### Callers (production code)

| Site | What it does with the result |
|---|---|
| `CLI/pipeline.ts:17` imports `loadAppConfig, resolveConfigFile` | |
| `CLI/pipeline.ts:43-55` `loadConfigStep(entryPath, cwd, deps)` | `resolveConfigFile({ entryPath, configPath: deps.configPath, cwd })` picks the file (effect check, then walk-up or explicit path); then `deps.config ?? (await loadAppConfig(configPath, !explicit)).config`. Returns `{ configPath, config }`. |
| `CLI/pipeline.ts:79-94` `resolveAppIdentity` | calls `loadConfigStep`, returns `{ configPath, config, name }` (used by `log`). |
| `CLI/pipeline.ts:103-149` `runPipeline` | calls `loadConfigStep` (:111), then entry load, `Load`, `validateRegistryCoverage(graph, config)` (:127), `assembleServices(graph, config, cwd, …)` (:140). Returns `{ configPath, config, entryModule, graph, name, assembled }`. |
| `CLI/validate-coverage.ts:12,28` | imports `CONFIG_FILENAME` only for a fix message. |
| `CLI/operations/shared.ts:11,132` | `executorLoadFailure` calls `checkEffectResolution(cwd)`; on throw returns the `DEPS.EFFECT_VERSION_CONFLICT` error with the import error as cause, else `DEPS.EXECUTOR_UNLOADABLE`. Called from `operations/deploy.ts:63`, `destroy.ts:47`, `dev.ts:70`, `log.ts:78` when the lazy `import()` of the executor fails. |
| `CLI/operations/shared.ts:38-40` `OperationDeps.config?`, `.configPath?` | the injection seam for deploy/destroy/dev. |
| `CLI/operations/log.ts:35` `LogDeps.config?`, `.identity?`, `.configPath?` | same for log. |

`loadAppConfigDiagnostics` has no production caller (only `load-config.test.ts`); it was written for a family shape that never used it.

### How each pipeline gets its config today

- **deploy / destroy** (`CLI/operations/execute-deploy-destroy.ts`): `:311-315` builds `PipelineDeps { runAssembler, config: deps.config, configPath: deps.configPath }` and calls `runPipeline` (:328). `:467-473` passes `pipeline.configPath` to `writeStackFile`, which writes the relative import of the config into `.prisma-composer/alchemy.run.ts`.
- **dev** (`CLI/operations/execute-dev.ts`): `:65-69` same `PipelineDeps`, `runPipeline` (:70). `:131-137` `writeDevStackFile({ configPath: pipeline.configPath, … })`. The watch loop re-runs the pipeline with `watchDeps` (:259-263) and rewrites the stack file with `rePipeline.configPath` (:274-279), so the config is re-evaluated on every rebuild today.
- **log** (`CLI/operations/execute-log.ts:151-156`): `deps.identity ?? resolveAppIdentity(entry, name, cwd, { config: deps.config, configPath: deps.configPath })`, then `resolveLocalTargets(identity.config)`.
- **Family handlers** pass the section's field straight through: `commands/deploy.ts:68-73` `operationDeps({ alchemy, configPath: ctx.config.configPath, workspaceId, client: ctx.api })` (helper at `family/converge.ts:70-82`); `commands/dev.ts:211` `{ alchemy: coalescedConverge(alchemy), configPath: ctx.config.configPath }`; `commands/destroy.ts:77` and `commands/log.ts:80` the same (standalone bin only).
- **`composerSection`** is referenced at `family/family.ts:32,67` (`configSection`), `commands/deploy.ts:11,55`, `commands/dev.ts:24,199`, `commands/destroy.ts:13,51`, `commands/log.ts:17,57`, and exported publicly from `CLI/exports/family.ts:17` (so `@prisma/composer-cli/family` exposes `composerSection` and `ComposerSection`).

Unrelated `configPath` hits (the ORM config path of a postgres resource, leave alone): `packages/1-prisma-cloud/1-extensions/target/src/orm-config.ts`, `orm-migration-resource.ts`, `descriptors/orm-postgres.ts:60`, and their tests.

## 2. How a family command receives its section

Command side (`family/commands/deploy.ts:55,70`):

```ts
needs: { config: composerSection, credentials: 'child' },
handler: async (args, ctx) => { … configPath: ctx.config.configPath … }
```

The handler reads the validated value as `ctx.config`. The handler does not receive provenance. It does receive the chain:

```ts
// report-B_8n69OY.d.ts:1179-1199
interface CommandContext<TConfig = undefined, TCode extends number = never> {
  readonly config: TConfig;                               // validated section value
  readonly configFiles: ReadonlyArray<LoadedConfigFile>;  // chain, nearest first; empty when no file
  readonly configPath: string | undefined;                // the --config flag as written
  …
}
interface LoadedConfigFile { readonly path: string; readonly sections: Readonly<Record<string, unknown>>; }
```

Provenance reaches only the validator, as its second argument. So "the directory of the loaded prisma.config.ts" is available to the handler as `path.dirname(ctx.configFiles[0].path)`, or the validator can copy `provenance.files[0]` / `provenance.keys` into the value it returns. A schema-declared section whose value is a plain object gets `baseDir` (directory of the nearest declaring file) added automatically; a whole-section `reference` does not.

Engine signatures (`node_modules/@prisma/cli-engine/dist/report-B_8n69OY.d.ts`):

```ts
interface SectionProvenance {                     // :759
  readonly files: readonly string[];              // declaring files, nearest first
  readonly keys: Readonly<Record<string, string>>; // declaring file per top-level key
}
declare function resolveSectionPath(provenance: SectionProvenance, key: string, path: string): string; // :803, throws on unknown key
declare const configSchema: typeof configScope.type;       // :830, arktype + `path` keyword
type ConfigSchema<T = unknown> = Type<T, typeof configScope.t>;
type ConfigSchemaValue<S extends ConfigSchema> = S["infer"] & { readonly baseDir?: string };
declare function reference<S extends ConfigSchema>(schema: S): S; // :867, command gets the file's own object; no path/default inside
declare function validateSectionWithSchema<S extends ConfigSchema>(name: string, schema: S, raw: unknown, provenance: SectionProvenance): SectionValidation<ConfigSchemaValue<S>>; // :870, never throws
interface ConfigSection<T> {                      // :884
  readonly name: string;
  readonly validate: (raw: unknown | undefined, provenance: SectionProvenance) => SectionValidation<T>;
  readonly merge?: (parent: unknown, child: unknown) => unknown; // default: per top-level key, nearer wins
}
type SectionValidation<T> =                       // :902; diagnostics on ok are warnings to stderr
  | { readonly ok: true; readonly value: T; readonly diagnostics: readonly Diagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };
declare function defineConfigSection<S extends ConfigSchema>(spec: { name: string; schema: S; merge?: SectionMerge }): ConfigSection<ConfigSchemaValue<S>>; // :919
declare function defineConfigSection<T>(spec: { name: string; validate: SectionValidator<T>; merge?: SectionMerge }): ConfigSection<T>; // :924
interface NeedsSpec<TConfig> { readonly config?: ConfigSection<TConfig>; … }  // :1440
declare function definePrismaConfig<T extends Record<string, unknown>>(config: T): T & { readonly $prismaConfig: number }; // index.d.ts:81
declare function loadConfig(cwd: string, configPath?: string, cliVersion?: string): Promise<LoadedConfig>; // index.d.ts:105
```

Engine flow (`engine-BLU1DuVo.js:3430-3462`): `checkConfiguration` calls `runtime.loadConfig(--config)`, fails first on file-level diagnostics (unreadable file: `CLI.CONFIG_UNREADABLE`, exit 2, `:1696,:1709`) and on unknown top-level keys (`CLI.CONFIG_UNKNOWN_SECTION`, `:3407`), then `resolveSectionOverChain` and `section.validate(value, provenance)`. A throwing validator is settled as a bug. `ok: false` becomes `CLI.CONFIG_SECTION_INVALID` with the validator's diagnostics attached (`:3480-3496`); the missing-section form says "no config file was found" or "no loaded config file declares it".

The ORM section's pattern (this repo, `packages/1-framework/3-tooling/config-loader/src/orm-section.ts:74-90`): `configSchema({ family: reference(configSchema({ kind: "'family'", …, emission: 'object' })), target: reference(…), 'extensions?': [reference(configSchema({ kind: "'extension'", … })), '[]'], … })`.

Current Composer section (`family/section.ts`): custom `validate`; absent section is `{ ok: true, value: {} }` (:56); non-object and unreadable (Proxy) sections fail with `CONFIG.FIELD_INVALID` (:58-92); `configPath` must be a non-empty string (:94-108) and is resolved with `resolveSectionPath` inside try/catch (:116-134); unknown fields are `CONFIG.FIELD_UNKNOWN` warnings (:136-153); `defineConfigSection<ComposerSection>({ name: 'composer', validate })` (:156). Its header (:4-13) states the reason the design notes call wrong.

## 3. Types and `configShapeDiagnostics`

`packages/0-framework/1-core/core/src/control/app-config.ts`:

- `ExtensionDescriptor` (:46-113): `id: string`, `nodes: Record<string, NodeDescriptor>`, optional `provisions` (ReadonlyMap), `application`, `providers()`, `preflight()`, `teardown()`, `container`, `reporter`, `localTarget()`.
- `StateDescriptor` (:119-124): `extension: string`, `create(container): AlchemyStateLayer`.
- `PrismaAppConfig` (:326-329): `{ readonly extensions: ExtensionDescriptor[]; readonly state: StateDescriptor }` (mutable array type).
- `defineConfig(config: PrismaAppConfig): PrismaAppConfig` (:332), identity. Published as `@prisma/composer/config` via `packages/9-public/composer/src/exports/config.ts` (`export * from '@internal/core/config'`), which also exports `deserializeContainers`, `containerEnv`, `DEV_DIR` etc. that the generated dev stack imports.
- Header comments at :1 and :331, and `core/src/exports/app-config.ts:1`, name `prisma-composer.config.ts`.

`configShapeDiagnostics(loaded, configPath)` (`CLI/load-config.ts:108-180`) checks, collecting rather than throwing:

| Check | Code | Message |
|---|---|---|
| export not an object, or no keys | `CONFIG.EXPORT_INVALID` | `"<path>" exported no config.`; fix names `defineConfig({ extensions: [...], state: ... })` from `'@prisma/composer/config'`; `where.path` |
| `extensions` not an array | `CONFIG.FIELD_INVALID` | `<basename>: \`extensions\` must be an array.`; `meta.field` |
| `extensions[i]` not an object | `CONFIG.FIELD_INVALID` | `` `extensions[i]` must be an extension descriptor object `` |
| `extensions[i].id` not a non-empty string | `CONFIG.FIELD_INVALID` | `` `extensions[i].id` must be a non-empty string (the extension package name) `` |
| duplicate `id` | `CONFIG.EXTENSION_DUPLICATE` | `<basename>: extension "<id>" is listed more than once in \`extensions\`.` |
| `extensions[i].nodes` not an object | `CONFIG.FIELD_INVALID` | `` `extensions[i].nodes` must be an object (the node-ID → control registry) `` |
| `state` not an object with string `extension` and function `create` | `CONFIG.FIELD_INVALID` | `` `state` must be a state descriptor (e.g. prismaState()) `` |

All `FIELD_INVALID` errors carry fix `"See defineConfig() in '@prisma/composer/config'."`. Other codes in the file: `CONFIG.FILE_MISSING` (:71, :331), `CONFIG.EVALUATION_FAILED` (:221), `CONFIG.PATH_MISMATCH` (:238), `CONFIG.PATH_NOT_ABSOLUTE` (:316). The pre-flight's code is `DEPS.EFFECT_VERSION_CONFLICT`. `isRecord` treats arrays as records, so `extensions[i]` as an array passes the object check today.

## 4. Tests that reference the old file, the loader, `configPath`, the pre-flight or `CONFIG.` codes

In `packages/0-framework/3-tooling/cli/src`:

- `__tests__/load-config.test.ts` (348 lines): walk-up finds, nests, nearest wins, spelling precedence, missing-config names every spelling; `resolveConfigFile` explicit path, `FILE_MISSING`, `PATH_NOT_ABSOLUTE`, walk not explicit; real c12 load, throwing module is `EVALUATION_FAILED`; `validateConfigShape` errors per field. Delete with the loader; port the shape cases to the section validator's tests.
- `__tests__/check-effect-resolution.test.ts` (190 lines): alchemy dir walk, effect resolution from a package, pin reading, mismatch message, `checkEffectResolution` on healthy and broken trees. Delete.
- `family/__tests__/section.test.ts` (149 lines): absence ok, `configPath` resolution against declaring file, missing provenance key fails, non-object fails, unknown field warns, diagnostics carry nextActions, validator never throws (fuzz), unreadable Proxy fails, name is `composer`. Rewrite for the new shape.
- `family/__tests__/engine-cli.test.ts` (272 lines): standalone CLI composition; `:199-265` a `configPath` reaches `ctx.config` resolved against the declaring file, root-declared `configPath` from a subdirectory, non-string `configPath` refused. Rewrite those three.
- `family/__tests__/host-adapter.test.ts` (153 lines): `runComposerCli` with a real host; `:100-125` `--config` to a missing file is `CLI.CONFIG_NOT_FOUND`; `:128-152` writes `export default { $prismaConfig: 1, composer: { configPath: "custom" } }` and asserts `double.calls.deps.dev[0]?.configPath` is resolved. The second needs a real section.
- `family/__tests__/runtime.test.ts` (294 lines): `:268-292` the runtime passes `loadConfig` through and forwards the `--config` path; uses `{ composer: { configPath: 'x.ts' } }` only as opaque data.
- `family/__tests__/deploy-destroy.test.ts` (405 lines, `:76-80`) and `dev-interrupt.test.ts` (`:26-29`): `createTestCli({ commandFamilies, commands, config: {} })` with the control double. An empty config currently validates; with required fields these harnesses need a fake `composer` section.
- `family/__tests__/converge-settlement.test.ts`: uses its own probe family; no Composer section.
- `family/__tests__/translate-error.test.ts:44-72`: translates `CONFIG.FIELD_INVALID` with `where.path: '/app/prisma-composer.config.ts'` and `CONFIG.FILE_MISSING`; only fixture strings.
- `__tests__/generate-stack.test.ts` (187 lines, :12-178): asserts `import config from "../prisma-composer.config.ts";` and relative-path cases for the rendered stack file. Rewrite for the new import.
- `dev/__tests__/generate-dev-stack.test.ts` (:9-52): same for the dev stack file.
- `operations/__tests__/operations.test.ts` (1775 lines): `makeAppDir` writes a `prisma-composer.config.ts` as a discovery target (:154-166) while tests inject `deps.config`; `:409-426` missing config is `CONFIG.FILE_MISSING` naming the spellings; `:640-679` a preloaded breaker makes the executor import fail and asserts `DEPS.EFFECT_VERSION_CONFLICT` with the import error as cause; `:681-695` `executorLoadFailure` gives `DEPS.EXECUTOR_UNLOADABLE`; `:933` a fake identity `{ configPath: 'c', config, name }`.
- `__tests__/deployment-summary.test.ts:58,68`: stack-file snippets containing `import config from '../prisma-composer.config.ts'` as parse fixtures.
- `__tests__/fixtures/run-load-entry.ts:4`: comment only.

Elsewhere:

- `packages/0-framework/3-tooling/assemble/src/__tests__/assemble-services.test.ts:148`: `ASSEMBLE.EXTENSION_MISSING` fix contains `prisma-composer.config.ts`.
- `packages/0-framework/1-core/core/src/__tests__/lowering.test.ts:665`: `LowerError` message contains `prisma-composer.config.ts`.
- `packages/0-framework/2-authoring/node/src/__tests__/no-control-import.test.ts` and `…/nextjs/…/no-control-import.test.ts`: ADR-0017 guard; nothing reachable from the authoring entry imports a `/control` entry. Name the old file only in the header comment (:7).
- `packages/1-prisma-cloud/1-extensions/target/src/__tests__/invariants.test.ts:194-197`: the same guard for the Prisma Cloud target; comment names the old file.
- `packages/0-framework/0-foundation/foundation/src/cli-structured-error.test.ts`: uses `CONFIG.FILE_NOT_FOUND` as an arbitrary code. Unaffected.
- `test/integration/test/cli.extension-config.test.ts`: spawns `prisma-composer deploy <fixture entry>` from `test/integration` with a fake service token; asserts the real `/control` entries resolve and the run fails at "no built entry". Needs a `prisma.config.ts` in `test/integration`.
- `test/integration/test/control.deploy.test.ts`: `deploy({ entry, cwd })` from `@prisma/composer/control` fails with `ASSEMBLE.BUILD_FAILED`; relies on walk-up discovery (see surprise 2).
- `test/integration/test/cli.engine-shell.test.ts`: the binary names itself, lists four commands, grammar errors exit 2, signed-out deploy refused before evaluation. Unaffected by the config shape.
- `test/integration/test/local-dev*.ts`: drive `prisma-composer dev` against `test/integration` and `examples/store`; `local-dev.integration.ts:103,201` uses its own `fixtures/local-dev/dev-config.ts` and renders its own stack import.
- `test/integration/test/fixtures/extension-config/service.ts:8`, `fixtures/local-dev/module.ts:5`, `dev-config.ts:3`: comments naming the old file and the walk-up.

## 5. Config files in the repo

`prisma-composer.config.ts` (all default-export `defineConfig({ extensions, state: prismaState() })` from `@prisma/composer/config`, with a header comment naming the file):

| File | extensions | Sibling `prisma.config.ts` |
|---|---|---|
| `examples/auth/` | `prismaCloud(), nodeBuild()` | yes: `definePrismaConfig` from `@prisma/cli-engine`, `orm` with `contract`, `db.connection`, `extensions: [authPack]` |
| `examples/bucket/` | `prismaCloud(), nodeBuild()` | no |
| `examples/cron/` | `prismaCloud(), nodeBuild()` | no |
| `examples/email/` | `prismaCloud(), nodeBuild()` | no |
| `examples/env-param/` | `prismaCloud(), nodeBuild()` | no |
| `examples/orm-demo/` | `prismaCloud(), nodeBuild()` | yes: `definePrismaConfig` from `@prisma/cli-engine`, `orm` with `contract`, `db.connection` |
| `examples/storage/` | `prismaCloud(), nodeBuild()` | no |
| `examples/store/` | `prismaCloud(), nodeBuild(), nextjsBuild()` | no at the root; `modules/catalog/prisma.config.ts` and `modules/orders/prisma.config.ts` hold ORM-only sections loaded by path by the postgres resources |
| `examples/storefront-auth/` | `prismaCloud(), nodeBuild(), nextjsBuild()` | no |
| `examples/streams/` | `prismaCloud(), nodeBuild()` | no |
| `test/integration/` | `prismaCloud(), nodeBuild()` | no |
| `website/` | `prismaCloud(), nodeBuild()` | no |

Other `prisma.config.ts` files (ORM-only, not Composer projects): `packages/1-prisma-cloud/1-extensions/target/src/__tests__/fixtures/{gadget,packed,widget}-contract/source/prisma.config.ts`, `packages/1-prisma-cloud/2-shared-modules/auth/src/pack/prisma.config.ts`.

tsconfig `include` lists `prisma-composer.config.ts` in `examples/{auth,bucket,email,orm-demo,storage,streams}/tsconfig.json` and `website/tsconfig.json`.

Package scripts: every example except `bucket` (no deploy script), plus `website`, has `deploy` and `destroy` scripts running `bun node_modules/.bin/prisma-composer deploy|destroy module.ts …`; `env-param` also has `destroy:stage`. `scripts/destroy-guard.sh:20` and `.github/workflows/deploy-docs.yml:80` run the binary too. The spec puts the script changes in slice 2; slice 1 leaves them on the standalone binary, which keeps working.

Dependencies of note: only `examples/auth` and `examples/orm-demo` declare `@prisma/cli-engine` (0.6.2). No example declares `prisma`. `test/integration` declares `prisma@7.9.0`.

## 6. Dependencies

- `c12` declared in `packages/0-framework/3-tooling/cli/package.json` (`^3.3.4`), `packages/9-public/composer/package.json` (`^3.3.4`), `packages/9-public/composer-cli/package.json` (`^3.3.4`). Imported only by `CLI/load-config.ts:27`. The engine carries its own exact `c12@3.3.4`.
- `@prisma/cli-engine` in the cli package: dependency `0.6.2` of `@internal/cli`; peer `0.6.2` and dev `0.6.2` of `@prisma/composer-cli`; also a dependency of `packages/1-prisma-cloud/1-extensions/target` (0.6.2). Imported in `CLI/family/{family,section,converge,workspace,target,translate-error,engine-cli,runtime}.ts` and `family/commands/*.ts`, plus family tests (`@prisma/cli-engine/testing`'s `createTestCli`, `mintTestJwt`). Nothing outside `family/` imports it, which keeps `@prisma/composer` engine-free.

## 7. ADR conventions

- Files: `docs/design/90-decisions/ADR-NNNN-<kebab-case-decision>.md`, four-digit number, slug states the decision.
- Highest number: `ADR-0048-prisma-cloud-resources-come-from-the-upstream-alchemy-provider.md`. The new ADR is `ADR-0049`.
- Index: `docs/design/90-decisions/README.md` § Index, one bullet per ADR: `- [ADR-NNNN](file.md) — <one-paragraph summary>.` Supersession is an italic suffix on the old entry, e.g. `*(Superseded in part by ADR-0047: …)*`. ADR-0017's entry is line 41 and names `prisma-composer.config.ts`.
- Template: `docs/design/99-process/templates/adr.md`. Sections Decision (with a code snippet directly under it), Reasoning, Consequences, Alternatives considered, Related. No Status section; no tickets, dates or project history in the body.
- ADR-0045 headings: `# ADR-0045: Deploy state lives behind the platform state API; deploys hold a server-side lease` / `## Decision` / `## Reasoning` / `## Consequences` / `## Alternatives considered` / `## Related`. (ADR-0048 adds topic subsections between Decision and Consequences and ends with `## References`.)
- ADR-0017 (161 lines) names `prisma-composer.config.ts` at :5, :10 (code-block comment), :43; headings Decision, Reasoning, Consequences, Alternatives considered, Related.
- Related ADRs a reader would expect touched: ADR-0043 (programmatic `@prisma/composer/control` surface, see surprise 2) and ADR-0003 ("there is no deploy config file"). The spec limits design-doc changes to the new ADR and ADR-0017.

## 8. Testing conventions in the cli package

- Runner: `bun test` (`packages/0-framework/3-tooling/cli/package.json` `"test": "bun test"`); `import { describe, expect, test } from 'bun:test'`. Tests live in `src/**/__tests__/*.test.ts` with fixtures in `__tests__/fixtures/`. CI runs `pnpm turbo run test`, `pnpm --dir test/integration exec bun test`, `pnpm test:scripts` (`node --test scripts/*.test.mjs scripts/*.test.ts`), and `node-compat.test.ts` under Node.
- Family against the engine: `createTestCli` from `@prisma/cli-engine/testing`, seeded with `config: { <section>: … }` or a `loadConfig` override, mounting `createComposerFamily({ operations: createControlDouble(...).operations })` (`deploy-destroy.test.ts:70-83`, `dev-interrupt.test.ts:26`). The double (`CLI/testing/control-double.ts`, public as `@prisma/composer-cli/testing`) records each call's input and its deps (`calls.deps.deploy[i].configPath`). A real-disk run goes through `runComposerCli(argv, fakeHost(dir), { version, operations })` with a real `prisma.config.ts` written to a temp dir (`host-adapter.test.ts:128-152`). `engine-cli.test.ts` builds probe commands on `composerSection` with `createCli` and a stub `loadConfig`.
- `scripts/check-family-static-graph.mjs`: packs `@prisma/composer-cli`, walks the static import graph of `dist/family.mjs`, `dist/bin.mjs` and `dist/testing.mjs`; fails on any `alchemy`, `effect` or `@effect/*` specifier and on any static `@prisma/composer/...` import; requires the `@prisma/cli-engine` specifier in family and bin (proof it stayed external) and the `createControlDouble` definition in testing; testing may contain no dynamic import. The new section validator is in this graph, so it must import nothing heavy.
- `scripts/check-cli-engine-pin.mjs`: composer-cli's engine peer, dev dependency and `@internal/cli`'s dependency are the same exact version; the engine survives as a bare import in composer-cli's packed dist, including `dist/bin.mjs` by name (fails if `bin.mjs` is missing from the tarball, `:193`); `@prisma/composer`'s packed dist has no engine import or inlined copy and its manifest declares no engine.
- No script greps for `prisma-composer` as a check. Mentions exist in comments of `check-npm-effect-resolution.mjs`, `check-family-static-graph.mjs:3`, `check-floor-imports.mjs:12`, `check-publish-deps.mjs:240`, `check-skill-packaging.mjs:2` (skill name), `set-version.ts:63`, `cold-start-canary.ts:214,251`, `ci-cleanup-utils.ts` (state project name), and `.github/workflows/ci.yml:235`.

## 9. Public packages

`packages/9-public/composer-cli/package.json`: `bin: { "prisma-composer": "./dist/bin.mjs" }`; exports `./family`, `./testing`, `./package.json`; deps `@prisma/composer` (workspace), `alchemy@2.0.0-beta.78`, `c12`, `cross-spawn`, `effect@4.0.0-rc.115`, `esbuild`; peer `@prisma/cli-engine@0.6.2`. `tsdown.config.ts`: config 1 entries `family: src/exports/family.ts`, `testing: src/exports/testing.ts`, external `esbuild`, `@prisma/cli-engine`, inline `@internal/*`; config 2 entry `bin: ../../0-framework/3-tooling/cli/dist/bin.mjs`, no d.ts, same externals. `src/exports/family.ts` re-exports `@internal/cli/family`, which includes `createComposerCli`, `runComposerCli`, `BINARY_NAME`, `createComposerFamily`, `realOperations`, `composerSection`, `ComposerSection`, `toEngineError`.

`packages/9-public/composer/package.json`: exports `.`, `./config`, `./control`, `./deploy`, `./local-target`, `./report`, `./testing`, `./casts`, `./assertions`, `./arktype`, `./service-rpc`, `./node`, `./node/control`, `./nextjs`, `./nextjs/control`, `./package.json`; no bin; deps include `alchemy`, `effect@4.0.0-rc.115` and companions pinned exactly, and `c12`. `tsdown.config.ts` maps each export to `src/exports/<name>.ts`; external `esbuild` and `/^@prisma\/cli-engine(\/|$)/` so an accidental engine import stays visible. `./control` is `export * from '@internal/cli/control'`, i.e. the programmatic operations plus the loader they call today.

`@internal/cli` (`CLI/../tsdown.config.ts`): entries `index`, `bin` (`src/bin.ts`), `report`, `control`, `family`, `testing`. `CLI/exports/index.ts` exports `cli`, `shippedVersion`, stack-file renderers, `loadEntry`, alchemy helpers.

`scripts/check-npm-effect-resolution.mjs`:

- Packs `@prisma/composer`, `@prisma/composer-cli`, `@prisma/composer-prisma-cloud` with `pnpm pack`, then installs into scratch apps with real npm.
- Healthy shapes: `composer-and-cli` (current npm), `composer-and-cli-npm10` (`npx --yes npm@10`), `composer-cli-and-prisma-cloud`. Each asserts: install finishes within 5 minutes; `npm ls effect --all` shows exactly one `effect`, equal to `@prisma/composer`'s exact pin; `effect` resolved from alchemy's position is the pin; `node_modules/.bin/prisma-composer --help` lists `deploy <entry>`, `destroy <entry>`, `dev <entry>`, `log <entry>` and shows no module crash; `prisma-composer deploy app.ts` with a fake `PRISMA_SERVICE_TOKEN` does not print the pre-flight marker `alchemy resolves effect@` and shows no `is not a function` / `Cannot find module`.
- Adversarial shape: all three tarballs with npm `overrides: { effect: '4.0.0-beta.93' }`. An `ERESOLVE`-style install refusal passes; otherwise asserts alchemy resolves a non-pinned `effect`, `prisma-composer deploy app.ts` exits non-zero with the marker `alchemy resolves effect@` and no `is not a function`, and `prisma-composer --help` still exits 0.
- Invokes the binary with `spawnSync(join(appDir, 'node_modules', '.bin', 'prisma-composer'), args, { cwd: appDir })`. No `prisma.config.ts` is written into the scratch apps.
