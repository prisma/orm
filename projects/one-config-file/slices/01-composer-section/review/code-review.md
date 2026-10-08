# Code review: slice 1, the `composer` section holds Composer's configuration

Repository: prisma/composer, branch `one-config-file/composer-section`, range `main...HEAD` (11 commits, 125 files). Reviewer lens: principal engineer. Expectations: [`../spec.md`](../spec.md) (slice done conditions), [`../../../spec.md`](../../../spec.md) (cross-cutting requirements 1–7), [`../../../design-notes.md`](../../../design-notes.md), [`../grounding.md`](../grounding.md). All repo paths below are relative to the Composer clone.

## Summary

The slice does what it set out to do. `family/section.ts` now validates Composer's whole configuration, the old loader, the effect pre-flight and `c12` are gone with no surviving references, all ten examples plus `test/integration` and `website` carry a `composer` section, and the CLI refuses the old file and the old field with clear diagnostics. The cli package suite passes (249 pass, 3 skip, 0 fail), as do `check-cli-engine-pin`, `check-family-static-graph`, both control-import guard tests and the Prisma Cloud invariants test.

The weak points are at the edges the slice created. The new programmatic `config` input is trusted blindly, so a caller's mistake fails late, possibly after containers were created. The `dev` watch loop now keeps the startup value in the parent while each rebuild's child re-imports the file from disk, so the "restart after editing" note in the docs is not quite true. The one behaviour no test or QA step executes is the generated stack file importing `prisma.config.ts` and reading `.composer`. The QA deploy stopped at assemble, not at the plan stage the done condition names. The deploying guide contradicts itself on the result shape.

## What looks solid

- **Deletions are complete.** `git grep` finds no `loadAppConfig`, `resolveConfigFile`, `findConfigPathForEntry`, `checkEffectResolution`, `effectResolutionDiagnostic`, `EFFECT_VERSION_CONFLICT`, `CONFIG_FILENAME`, `ConfigLoadRequest` or `c12` import in `packages/`, `scripts/`, `examples/`, `test/` or `website/`. The remaining `configPath` hits outside the ORM resource code are the `CONFIG.LEGACY_FIELD` diagnostic and its tests.
- **Lockfile.** The diff removes `c12` from three importers and adds `@prisma/cli-engine@0.6.2` to the eight examples, `test/integration` and `website` that lacked it. Nothing else moves.
- **Provenance is sound.** I read the engine (`@prisma/cli-engine@0.6.2`, `resolveSectionOverChain`, `provenanceOf`, `loadConfig`). `provenance.files` lists the declaring files nearest first. The section's `merge` returns the child whole, so `files[0]` is the file whose value was used. A section declared only in a parent file yields that parent file, so the legacy check and the stack import both target the parent. That case is tested in `family/__tests__/composer-config.test.ts` lines 27–41 and `engine-cli.test.ts` "a section declared only at the repo root". A relative `--config` is resolved against cwd and passed through `realpath` by the engine, and `process.cwd()` is already physical, so the CLI path never mixes a logical and a physical path.
- **The legacy check reads one directory.** `composerConfigOf` joins the four names onto `path.dirname(declaringFile)` only. A test asserts that an old file in a non-declaring directory is ignored.
- **Descriptors pass by identity.** `validateSection` pushes the original entry objects, and `section.test.ts` "hands every descriptor to the command by reference" asserts `toBe`. The engine freezes only the section's own shallow copy, never the descriptors.
- **The validator never throws.** The `try` around `validateSection` turns a throwing getter or Proxy into `CONFIG.FIELD_INVALID`, and a test exercises it.
- **`DEPS.EXECUTOR_UNLOADABLE` still names the module error.** `operations/shared.ts` lines 117–131 put the import error's message in the summary and keep the error as `cause`. `operations.test.ts` lines 579–644 check both in a real subprocess.
- **The ORM loader tolerates the shared file.** I ran `resolveOrmConfig` from `packages/1-prisma-cloud/1-extensions/target/src/orm-config.ts` against the migrated `examples/orm-demo/prisma.config.ts` and `examples/auth/prisma.config.ts`. Both resolved: the migrations directory, and 0 and 1 extension packs respectively. A full deploy stays in slice 3's QA.
- **The ADR explains the decisions.** ADR-0049 records why the engine's schema-and-`reference()` path was rejected (it does not reject unknown keys, uses `CLI.` codes, and gives `configPath` no message of its own). It also records why the absent-section message cannot check the directory: the engine gives empty provenance when no file declares the section.
- **The fixture's cast is honest.** `family/__tests__/fixtures/composer-section.ts` gives `blindCast` a reason, and the reason is true: its users (`deploy-destroy.test.ts`, `dev-interrupt.test.ts`, `composer-config.test.ts`) substitute the operations and never call a descriptor.

## Findings

### F01: the programmatic `config` input is not checked, so a caller's mistake fails late

- **Location:** `packages/0-framework/3-tooling/cli/src/pipeline.ts` lines 76–86; `packages/0-framework/3-tooling/cli/src/operations/deploy.ts` lines 50–71 (the same shape in `destroy.ts`, `dev.ts` and `log.ts`).
- **Issue:** Before this slice, programmatic callers went through `loadAppConfig`, which ran the shape check and failed early when the file was missing. Now `runPipeline` takes `composerConfig.value` as given and resolves `path` without checking that it exists. Three plausible mistakes now fail late:
  - Passing `prismaConfig` instead of `prismaConfig.composer` surfaces as a `TypeError` from `validateRegistryCoverage` iterating `undefined`.
  - A wrong `path` is found only when the Alchemy child fails to import it. That happens after `executeDeploy` has created containers and run preflight (the stack file is written at `execute-deploy-destroy.ts` line 471).
  - A `path` pointing at a file that inherits the section from a parent file (for example `examples/store/modules/catalog/prisma.config.ts`) makes the child read `prismaConfig.composer` as `undefined`.

  The `CONFIG.LEGACY_FILE` check also runs only in the CLI handler.
- **Suggestion:** At the start of each operation, validate `value` with the same checks the section runs, check that `path` exists, and check that the file sits in a directory with no `prisma-composer.config.*`. `section.ts` imports the engine, which `@prisma/composer` must not depend on. So move the engine-free checks (`validateSection` and `legacyFileError`, which need only the `Diagnostic` type and `node:fs`) into a module the section and the operations both call. Put that module in the operations' `CliStructuredError` shape at the call site.

### F02: after an edit to `prisma.config.ts`, `dev` builds the parent from the old config and the child from the new one

- **Location:** `packages/0-framework/3-tooling/cli/src/operations/execute-dev.ts` lines 255–296; `docs/guides/running-locally.md` lines 51–53; `skills/prisma-composer-core-concepts/SKILL.md` lines 390–391; ADR-0049 Consequences.
- **Issue:** The watch loop reruns `runPipeline` with `input.config`, the value read at start. Each rebuild then spawns a fresh Alchemy child, and its generated stack file re-imports `prisma.config.ts` from disk. After an edit, the parent checks registry coverage and assembles against the old extensions, while the child lowers against the new ones. The docs say an edit "takes effect only after you stop `dev`". In fact it takes partial effect on the next source change. Before this slice the parent reloaded the config on each rebuild, so the two sides agreed.
- **Suggestion:** Add `config.path` to the watch targets. When it changes, emit an event that tells the user to restart `dev`, and skip rebuilds until they do. Keep the doc sentence. Alternatively, reword the docs to describe the actual behaviour. The first option is better because it removes the mismatch instead of documenting it.

### F03: no test or QA step runs the generated stack's `prisma.config.ts` import

- **Location:** `packages/0-framework/3-tooling/cli/src/generate-stack.ts` lines 59–78; `dev/generate-dev-stack.ts` lines 62–82; `test/integration/test/local-dev.integration.ts` lines 103 and 200–225; `wip/slice-01-qa.md` §3.
- **Issue:** The central runtime change is that the child now imports `prisma.config.ts` and reads `prismaConfig.composer`. Unit tests assert only the rendered text. The QA deploy moved `dist/` aside and stopped at `ASSEMBLE.BUILD_FAILED`, before any stack file was written. The spec's done condition asks for a deploy that reaches the plan stage. The local-dev integration test renders its own copy of the dev stack, still in the old shape (`import config from dev-config.ts`, used directly), so it no longer mirrors `renderDevStackFile` and would not catch a regression there.
- **Suggestion:** Run `dev` on an example locally (no network is needed) or a signed-in deploy that reaches the Alchemy plan, and record the output in the PR. Then make `local-dev.integration.ts` call the real `renderDevStackFile` with a `prisma.config.ts` fixture whose `composer` section is `dev-config`'s value. That way the rendered import is executed in CI.

### F04: the adversarial CI shape passes on any import failure

- **Location:** `scripts/check-npm-effect-resolution.mjs` lines 186–210 and 343–350.
- **Issue:** The adversarial check accepts any non-zero exit from `import('alchemy')…` as proof that the broken `effect` was caught. A future Alchemy bump that renames `alchemy/Output`, or a probe typo, would also pass. The healthy shapes run first and import the same subpaths, which limits the risk, but the adversarial assertion does not say what it claims. The probe also leaves out the Prisma Cloud providers, which is what a user's config actually imports.
- **Suggestion:** Require the adversarial output to point into `effect`, for example `/node_modules\/effect\/|from 'effect|effect\/dist/`. Fail with the output when it does not. If the Prisma Cloud tarball is installed in the healthy shapes, add `@prisma/composer-prisma-cloud/control` to the healthy probe, so it matches what `prisma.config.ts` evaluates.

### F05: the deploying guide contradicts itself on the result shape

- **Location:** `docs/guides/deploying.md` lines 373–387 and 402–415.
- **Issue:** This PR rewrote the example to `if (result.ok) … result.value.summary`. Two paragraphs later, the bullet it also edited (adding `DEPS.EXECUTOR_UNLOADABLE`) still says operations resolve to `{ outcome: 'failed', failure }` with `failure.kind` in `invalid-input | unsupported-platform | pipeline | execution`. The code returns `Result` with a `CliStructuredError` that has a dotted `code`, and the skill (lines 363–371) says exactly that. The implementer reported this bullet as wrong and left it. The doc-maintenance rule applies to lines the PR touched.
- **Suggestion:** Rewrite the bullet to `{ ok: false, failure }`, branching on `failure.code` (examples: `ASSEMBLE.BUILD_FAILED`, `DEPLOY.ENGINE_FAILED`, `DEPS.EXECUTOR_UNLOADABLE`), matching the skill.

### F06: two new doc statements are inaccurate

- **Location:** `docs/guides/deploying.md` lines 374–381 and 392–397; `skills/prisma-composer-core-concepts/SKILL.md` lines 364–368; `docs/guides/getting-started.md` lines 114 and 258–261.
- **Issue:**
  - The programmatic example imports `./prisma.config.ts` relative to the script, but passes `path: './prisma.config.ts'`, which the operation resolves against `cwd`. The two agree only when the script runs from its own directory.
  - Getting started says "Only the `prisma-composer` commands read it". Two lines later it says the `orm` section goes in the same file, and ORM commands read that file too.
- **Suggestion:** Write the example as `path: fileURLToPath(new URL('./prisma.config.ts', import.meta.url))` with `import { fileURLToPath } from 'node:url'`, and say in the bullet that `path` must be the file that declares the section. Change the getting-started sentence to "Composer's commands read the `composer` section; your app code never imports the file."

### F07: the removed `ComposerSection` type may still be imported by the host

- **Location:** `packages/0-framework/3-tooling/cli/src/exports/family.ts` line 16 (removed export).
- **Issue:** `@prisma/composer-cli/family` is what the `prisma` host in prisma/prisma-cli mounts. If the host names `ComposerSection` anywhere, the pin bump in slice 3 fails typecheck. I could not check this, because prisma-cli is outside the review boundary and no host is installed in the clone. The removal is documented in the guide, the skill and the ADR.
- **Suggestion:** Before merging, run `git grep ComposerSection` in prisma/prisma-cli. If it has a hit, keep the name as a type alias of `PrismaAppConfig` for this release, or fix the host in slice 3's pin bump.

### F08: a failed second read of the section is reported as a Composer bug with a misleading message

- **Location:** `packages/0-framework/3-tooling/cli/src/family/composer-config.ts` lines 33–39.
- **Issue:** When `resolveSectionOverChain` returns `ok: false` on the handler's second read, `declaringFile` is `undefined`. The handler then throws "no loaded config file declares it". The engine reports a handler throw as an internal error. That can only happen when user code, such as a getter, throws on the second read. The message then misstates the cause, and the report blames Composer.
- **Suggestion:** Branch on `!resolved.ok` first and return a structured `CONFIG.FIELD_INVALID` that names `resolved.file` and carries the cause. Keep the plain `throw` only for the true invariant, an ok result with no declaring file.

### F09: the absent-section headline is wrong when there is no config file at all

- **Location:** `packages/0-framework/3-tooling/cli/src/family/section.ts` lines 65–78.
- **Issue:** With no `prisma.config.ts` anywhere, the user is told "prisma.config.ts has no `composer` section". The ADR notes that the engine passes empty provenance in both the no-file and the no-section case. The fix text is still right.
- **Suggestion:** Word it for both cases, for example "No loaded prisma.config.ts declares a `composer` section." This matches the wording the guide's table already uses.

### F10: examples spell the import differently from the docs

- **Location:** `examples/*/prisma.config.ts`, `test/integration/prisma.config.ts`, `website/prisma.config.ts`.
- **Issue:** The spec's example, the guides, the skill and both ADRs write `import { defineConfig as composer }` and `composer: composer({...})`. The examples write `composer: defineConfig({...})` and `orm: orm.defineConfig({...})`. Agents copy the examples, so two spellings will spread.
- **Suggestion:** Use `defineConfig as composer` in the examples too.

## Deferred

| Item | Why deferred |
| --- | --- |
| `dependency-cruiser.config.mjs` excludes `prisma.config.ts`, so the examples' `/control` imports are no longer cruised. This PR changed only the comment. | Listed as out of scope and as a deferred item in the slice spec. |
| A real deploy of orm-demo proving the ORM loader is harmless inside the Alchemy child. | Slice 3's manual QA. My `resolveOrmConfig` probe on orm-demo and auth passed, which lowers the risk. |
| Package scripts and guides still name the `prisma-composer` binary. The binary and `engine-cli.ts` remain. | Slice 2, by design. |
| A programmatic caller mixing a logical symlinked `cwd` with a physical `config.path` can produce a wrong relative import. On Windows, a config on another drive gives a `./D:/…` specifier. | Both already existed for the entry path through the same `relativeImportSpecifier`. Windows is documented as unsupported. |

## Already addressed

| Item | Where |
| --- | --- |
| (none) | |

## Acceptance-criteria verification

| # | Criterion | Verdict | Evidence |
| --- | --- | --- | --- |
| S1a | `deploy --help` from orm-demo runs against `prisma.config.ts` alone | PASS | QA §1 shows exit 0. `prisma-composer.config.ts` is deleted from orm-demo. |
| S1b | A dry deploy reaches the plan stage against `prisma.config.ts` alone | WEAK (round 2; was FAIL) | The re-run QA §2 still stops at `ASSEMBLE.BUILD_FAILED`. `stack-file-import.test.ts` now runs both generated stack files against a real `prisma.config.ts`, so the child's import is proven, but no run reached the Alchemy plan. |
| S1c | With `prisma-composer.config.ts` restored: `CONFIG.LEGACY_FILE` | PASS | QA §4. `host-adapter.test.ts` "an old prisma-composer.config.ts beside the declaring file…" asserts the code, summary and path, and that the operation is never called. |
| S1d | With `composer: { configPath }`: a section error naming `configPath` | PASS | QA §5. `engine-cli.test.ts` lines 243–271 assert `CLI.CONFIG_SECTION_INVALID` wrapping `CONFIG.LEGACY_FIELD` with `meta.field: 'configPath'`. |
| S2a | `check-family-static-graph` and `check-cli-engine-pin` pass unchanged | PASS | I ran both; both exit 0. The graph shows family, bin and testing are free of alchemy and effect. |
| S2b | Control-import guard tests pass | PASS | I ran the node and nextjs `no-control-import.test.ts` (1 pass each) and the target `invariants.test.ts` (11 pass). |
| S2c | `check-npm-effect-resolution.mjs` passes in its reworked form, with output recorded in the PR | NOT VERIFIED | Needs network and tarballs. Not in the QA transcript. The adversarial assertion is loose (F04). |
| S3 | A search for `prisma-composer.config` over packages, examples, test, website, guides and skills finds only the diagnostics and ADRs | PASS | The hits are `section.ts` and `composer-config.ts` diagnostics, their tests, and the guide and skill text that documents those same diagnostics. |
| CC1 | The section is written like the ORM section: identifying fields checked, descriptors passed through, unknown fields are errors | PASS | `section.ts` lines 92–211. Tests cover identity pass-through, `FIELD_UNKNOWN` as an error, and every field rule. The examples import from `@prisma/cli-engine`, which the spec allows. |
| CC2 | `configPath` fails validation; `prisma-composer.config.{ts,mts,mjs,js}` beside the loaded file fails before anything else; both show the section | PASS | `section.ts` lines 172–174 and 80–90. `composer-config.ts` lines 9–23 run first in each of the four handlers. Tests cover all four extensions. Round 2: the programmatic path now runs the same checks (F01 fixed); on the CLI the old-file check runs after the field checks (F11). |
| CC3 | Nothing reads `prisma-composer.config.ts`: loader, walk-up, c12 and `configPath` handling deleted | PASS | `load-config.ts` is deleted. The greps and the lockfile diff above confirm the rest. |
| CC4 | A broken `effect` tree fails fast with `CLI.CONFIG_UNREADABLE`; the pre-flight is deleted; the pins and the CI proof stay | WEAK | The pre-flight and its callers are gone, and the docs describe the engine diagnostic. The engine behaviour is not exercised in this slice, and the CI script was not run (S2c, F04). Round 2: the adversarial check now requires an effect-shaped failure, with one false-positive path (F12). |
| CC5 | No published package declares the `prisma-composer` binary | NOT VERIFIED | Slice 2's scope. This slice keeps the binary working on purpose. |
| CC6 | Every example, `test/integration` and `website` has a `composer` section and no old file | PASS | Each of the 12 `prisma.config.ts` files has one `composer:`, and `git ls-files` finds no `prisma-composer.config.*`. Switching the scripts to `prisma` is slice 2. |
| CC7 | The control-plane guard tests pass and name `prisma.config.ts` | PASS | I ran them. The node, nextjs and target test comments and ADR-0017 now name `prisma.config.ts`. |

| Verdict | Count |
| --- | --- |
| PASS | 11 |
| FAIL | 0 |
| NOT VERIFIED | 2 |
| WEAK | 2 |

## Round 2 verification

Range: the seven fix commits `91a72eec`..`827588a3`. I ran the cli package suite (255 pass, 3 skip, 0 fail, including the new `stack-file-import.test.ts` with no network), `node --test scripts/lint-casts.test.mjs` (9 pass), and root `pnpm typecheck`, `pnpm lint` and `pnpm lint:casts` (all exit 0; casts 21 at HEAD and at the merge base). I did not run `check-npm-effect-resolution.mjs` (needs network).

### Per-finding verdicts

| Id | Verdict | Evidence |
| --- | --- | --- |
| F01 | FIXED | `833c896e`. `pipeline.ts` `checkConfigSource` runs first in `runPipeline` and `resolveAppIdentity`. `operations.test.ts` "a config the CLI would refuse is refused before any container call" asserts `FIELD_UNKNOWN` with the "pass the `composer` property" fix, `FILE_RETIRED` and `FILE_MISSING`, each with `containerCalls` empty and Alchemy not run. The `log()` test asserts `FIELD_INVALID` on `extensions`. |
| F02 | FIXED | `4db7a4f7`. `execute-dev.ts` watches `configSource.file` and pauses rebuilds. The dev test edits the file, then a build output, and asserts two `config-changed` events and `converges === 1`. Residual edge cases in F13. |
| F03 | PARTIAL | `f3b39486`. `stack-file-import.test.ts` runs both real generators' output in a child against a real `definePrismaConfig` file and asserts the extension ids and state that reach `lower()`; passing the whole export would throw and fail on stderr. Remaining: `local-dev.integration.ts` still hand-renders its stack instead of calling `renderDevStackFile`, and no deploy or `dev` run reached the Alchemy plan (S1b). |
| F04 | PARTIAL | `886f6dba`. The adversarial shape now fails unless the probe blames `effect`. The healthy probe still omits the Prisma Cloud providers, with a stated reason (platform peers). The blame check has a false-positive path (F12). |
| F05 | FIXED | `827588a3`. The `deploying.md` bullet now says `{ ok: false, failure }` and "branch on `code`", matching the skill. |
| F06 | FIXED | `827588a3`. The example builds `file` with `fileURLToPath(new URL(...))` and the bullet explains why; getting-started says "Composer's commands read the `composer` section". |
| F07 | DEFERRED-BY-DECISION | Host check belongs to slice 3's pin bump. ADR-0049 records the removal. |
| F08 | FIXED | `833c896e`. `family/composer-config.ts` and its second resolve are deleted; the validator returns `{ value, file }` (`section.test.ts` "returns extensions and state together with the file that declared them"). |
| F09 | FIXED | `833c896e`. Summary is "No loaded prisma.config.ts declares a `composer` section." (`section.test.ts` line 97, `engine-cli.test.ts` line 239). |
| F10 | FIXED | `1b607959`. All ten examples, `test/integration` and `website` use `defineConfig as composer`, and `defineConfig as orm` where there is an ORM section. |
| D01 | PARTIAL | Shape, old file and missing file are checked (F01). The value/file agreement is recorded in ADR-0049 as uncheckable in-process, which is correct. Not done: the generated stack still does `const config = prismaConfig.composer` with no check, so a `file` that inherits its section from a parent file still fails inside `lower()` with a TypeError rather than a `CONFIG.` code. |
| D02 | FIXED | `833c896e`. The validator returns the file and runs the old-file check; handlers pass `ctx.config`. `host-adapter.test.ts` line 163 asserts `FILE_RETIRED` under the section headline before the operation. |
| D03 | FIXED | `827588a3`. ADR-0044's `CONFIG` list matches the emitted codes and marks three as retired by ADR-0049. |
| D04 | FIXED | `833c896e`. `FIELD_RETIRED` and `FILE_RETIRED` in code, tests, ADRs and guides; `git grep LEGACY_` finds nothing. |
| D05 | FIXED | `ComposerConfigSource { value, file }` in `src/composer-config.ts`, exported from `/control`; `log` documents that it reads only `value`. `StackFileInput.configFile` keeps its own name, which is acceptable for an internal type. |
| D06 | FIXED | Same as F10. |
| D07 | DEFERRED-BY-DECISION | ADR-0049 now names ADR-0028's lost rule. |
| D08 | FIXED | ADR-0049's consequence now says every section's imports run in the child and a failure in any of them fails the deploy. |
| D09 | FIXED | `stack-file-import.test.ts` plus the new operation refusal tests. |

Totals: 14 FIXED, 3 PARTIAL, 0 NOT FIXED, 2 DEFERRED-BY-DECISION.

### The Biome plugin change

I ran the new and the old pattern over one probe file. Both flag the same ten sites: `v as T`, both halves of `v as unknown as T`, a cast as a call argument, a cast inside a `satisfies` object, `(v as T).x`, a cast after an explicit generic call, `as Array<T>`, `(x satisfies U) as T` and a cast in a return. Both exempt `as const`. Neither flags `<T>v`, so that is not a regression. The `.tsx` copy gave the same result. `lint-casts.test.mjs` "positive delta" already proves a real cast raises the count (`delta=+1`); the new test proves renames do not.

### New findings

#### F11: the CLI and the programmatic check refuse the same bad input with different codes

- **Location:** `family/section.ts` `validate`; `pipeline.ts` `checkConfigSource`.
- **Issue:** The validator checks fields first, then the old file, and reports every finding. `checkConfigSource` checks the file exists, then the old file, then fields, and throws only the first finding. A section with a bad field and an old file beside it gives `FIELD_*` on the CLI and `FILE_RETIRED` in code. ADR-0049 says code "gets the same refusals a CLI user would". On the CLI the old file is now reported only after the fields are valid, which is weaker than CC2's "fails before anything else". A symlinked `file` also diverges: the engine gives a real path, while `checkConfigSource` looks for the old file beside the link.
- **Suggestion:** One function in `composer-config.ts`, `checkComposerConfig(raw, file)`, that returns findings in one order (old file first), used by both callers. The operations throw the first finding and keep the rest in `meta`. Call `fs.realpathSync` after the existence check.

#### F12: the effect-blame check blames `effect` for any `a.b is not a function`

- **Location:** `scripts/check-npm-effect-resolution.mjs` `ALCHEMY_BLAME_PROBE`.
- **Issue:** `typeof effect[X]?.[Y] !== 'function'` is true when `effect` has no export `X` at all, so any `foo.bar is not a function`, including one from a minified name or an Alchemy-internal rename, counts as effect's fault. That is the F04 false pass, narrowed to one message shape. The healthy shapes import the same entries first, which limits the impact. The opposite miss fails closed: "Cannot read properties of undefined" from a missing effect namespace is not recognised, so the script fails loudly on a genuine effect break.
- **Suggestion:** Require `typeof effect[X] === 'object'` and `typeof effect[X][Y] !== 'function'`. Also accept `Cannot read properties of undefined (reading 'Y')` when the stack names `node_modules/alchemy/`.

#### F13: the `dev` config pause has three unhandled cases

- **Location:** `operations/execute-dev.ts` lines 258–271; `dev/watch.ts` `startWatch`.
- **Issue:** The flag cannot deadlock, two writes within 300 ms coalesce into one notice, and both watchers close on `stop()` and on a failed start. But:
  - Any write event pauses `dev` for good, including a save that leaves the content unchanged (format-on-save, `touch`, a branch switch that rewrites the file with the same bytes).
  - The config watcher gets no `onError`, so a watch error on it is silent and later edits go undetected. That silently restores F02's mixed-config rebuild.
  - If a bundle's watch target is a directory that contains `prisma.config.ts`, both debounced callbacks fire on one edit. The build callback can run first and converge once with mixed config.
- **Suggestion:** Hash the file at start and on each event, and ignore unchanged content. Pass `onError` so failures surface as `watch-error`. In the build callback, compare the hash before rebuilding instead of relying only on the flag set by the other watcher.

### Verdict

The branch can go to a PR. F11–F13 are low severity and can be fixed in this PR in a short round. Before opening it, either record a run that reaches the Alchemy plan (S1b), or state in the PR that the plan-stage proof moves to slice 3's QA. Record the `check-npm-effect-resolution.mjs` output in the PR (S2c).
