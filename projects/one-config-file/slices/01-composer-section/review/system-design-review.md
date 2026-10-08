# System design review: slice 1, the `composer` section

Branch `one-config-file/composer-section` in prisma/composer, reviewed as `main...HEAD` (11 commits, 591fdc10 at the tip). Paths are repo-relative to prisma/composer. Reviewed against the slice spec, the project spec and design notes, ADR-0049 and the amendments to ADR-0017, ADR-0043 and ADR-0044.

## Summary

The shape is right. The private loader, its walk-up discovery, c12 and the effect pre-flight are gone rather than bypassed. The `composer` section now holds the whole configuration, the section merge takes the nearest file whole, and every command reads its config from the engine. The package boundary holds: `ComposerConfig` and the operations import nothing from `@prisma/cli-engine`, and `packages/9-public/composer/tsdown.config.ts` keeps the engine external so `check-cli-engine-pin.mjs` would catch a stray import.

The main weakness is the programmatic `config: { value, path }` input. The engine path validates the section and refuses the old file. The programmatic path does neither, and nothing checks that `value` is the `composer` export of the file at `path`, which is what the Alchemy child imports. Two smaller structural points: the handler re-derives provenance that the validator already had, and ADR-0044's closed code registry was not updated for the new codes.

## What changed, conceptually

| Concept | Before | After |
| --- | --- | --- |
| Where the config lives | `prisma-composer.config.ts`, found by walking up from the entry, loaded with c12 | `composer` section of `prisma.config.ts`, loaded by the engine |
| Section value | `{ configPath }` pointer | `PrismaAppConfig`: identifying fields checked, descriptors passed by reference |
| Section merge | engine default, key by key | nearest declaring file, whole (family/section.ts:255) |
| Operation input | discovered from `entry`; `deps.config`/`deps.configPath` overrides | required `config: ComposerConfig` = `{ value, path }` |
| Old setup | n/a | `CONFIG.SECTION_MISSING`, `CONFIG.LEGACY_FIELD` (validator), `CONFIG.LEGACY_FILE` (handler) |
| Broken `effect` tree | `DEPS.EFFECT_VERSION_CONFLICT` pre-flight | engine's `CLI.CONFIG_UNREADABLE`; executor import failure is `DEPS.EXECUTOR_UNLOADABLE` |
| Stack file in the Alchemy child | imports the old file's default export | imports `prisma.config.ts` and reads `.composer` |

## Findings

### D01: The programmatic `config` input is unvalidated, and `value` and `path` can disagree

Location: packages/0-framework/3-tooling/cli/src/pipeline.ts:26-31, 80-85; packages/0-framework/3-tooling/cli/src/generate-stack.ts:74-77; packages/0-framework/3-tooling/cli/src/dev/generate-dev-stack.ts:78-81; docs/guides/deploying.md:392-397.

Issue: `ComposerConfig` carries the config twice. The in-process pipeline uses `value` for coverage and assembly. The Alchemy child imports the file at `path` and uses its `.composer` export for `lower()`. On `main`, a programmatic `deploy` ran the loader, so its config was shape-checked. Now a host can pass any `value`: it gets no shape check, no `CONFIG.LEGACY_FILE` refusal, and no check that `value` is the file's section. The guide says "`value` must be that file's `composer` export", but nothing enforces it. If the host passes the path of an old `prisma-composer.config.ts`, or a file whose section comes from a parent file, the child reads `undefined` and fails inside `lower()` with an unstructured error. ADR-0049 says the operations "take the same value", but only the CLI path makes that true.

Suggestion: Move the shape check and the legacy-file check into one module that does not import the engine, for example `src/composer-config.ts` at package level, returning `CliStructuredError`s. The operations run it at the start of `runPipeline`. `family/section.ts` maps the results to engine `Diagnostic`s. This restores the guarantee programmatic callers had on `main`, and it keeps one definition of "a valid section" instead of two. The child should also check that `prismaConfig.composer` is defined and throw a named `CONFIG.` error if it is not, so a mismatch fails with a diagnostic rather than a TypeError. Record the value/path invariant in ADR-0049 § Consequences.

### D02: The handler re-derives provenance the validator already had; the legacy check depends on each handler remembering it

Location: packages/0-framework/3-tooling/cli/src/family/composer-config.ts:25-43; family/commands/deploy.ts:59, destroy.ts:57, dev.ts:203, log.ts:60; ADR-0049 line 33.

Issue: The validator receives `provenance.files[0]` and discards it. `composerConfigOf` then runs `resolveSectionOverChain` a second time to recover the same path, and throws a plain `Error` if the two reads disagree. The engine documents the intended pattern on `resolveSectionPath`: the validator resolves paths from provenance and returns them in its validated value. Separately, `CONFIG.LEGACY_FILE` runs only because each of four handlers calls `composerConfigOf`. A fifth command that needs the section and forgets the call would silently ignore an old file, which is exactly what principle 3 of the design notes forbids. ADR-0049 records the re-resolve as the mechanism but not why the validator-returns-path option was rejected.

Suggestion: Make the section's value type `ComposerConfig` itself: the validator returns `{ value, path: provenance.files[0] }` and runs the legacy-file check there, so `LEGACY_FILE` is reported under the same `CLI.CONFIG_SECTION_INVALID` headline as the other two refusals. That removes `composerConfigOf`, the second resolve, the unreachable throw, and the per-handler call. Handlers pass `ctx.config` straight through. If the engine forbids file-system reads in validators, say so in ADR-0049 and keep the handler check, renamed to something like `refuseLegacyFile` so the name says it can fail.

### D03: ADR-0044's closed `CONFIG` registry was not updated

Location: docs/design/90-decisions/ADR-0044-errors-are-structural-envelopes-with-dotted-namespace-codes.md:81-83.

Issue: ADR-0044 says "Adding a subcode is an edit to this list." The branch edited the `DEPS` line and the namespace-owner table, but not the `CONFIG` line. `SECTION_MISSING`, `LEGACY_FIELD`, `LEGACY_FILE` and `FIELD_UNKNOWN` are missing. `FILE_MISSING`, `EXPORT_INVALID`, `PATH_MISMATCH` and `EVALUATION_FAILED` are listed but no production code emits them after the loader's deletion.

Suggestion: Rewrite the `CONFIG` line to the codes the code emits, and mark the four retired codes as retired by ADR-0049, the same way the `DEPS` line does.

### D04: `LEGACY_FIELD` and `LEGACY_FILE` break the subcode word order

Location: packages/0-framework/3-tooling/cli/src/family/section.ts:70, 82, 180; family/composer-config.ts; docs/guides/deploying.md (diagnostics table).

Issue: Every other `CONFIG` subcode is subject then state: `FIELD_INVALID`, `FIELD_UNKNOWN`, `SECTION_MISSING`, `EXTENSION_DUPLICATE`, `DESCRIPTOR_MISSING`. The two new ones reverse it. Users and hosts branch on these strings, so they are part of the public surface, and they are cheapest to fix before the GA release.

Suggestion: `CONFIG.FIELD_RETIRED` and `CONFIG.FILE_RETIRED`, or `FIELD_LEGACY` and `FILE_LEGACY`. Apply the change to the code, the ADRs, the guide and the tests together.

### D05: `ComposerConfig` names the wrong thing, and the path has three names

Location: packages/0-framework/3-tooling/cli/src/pipeline.ts:26-34; exports/control.ts:34; generate-stack.ts `StackFileInput.configFile`.

Issue: The configuration a user writes is `PrismaAppConfig`, returned by `defineConfig` from `@prisma/composer/config`. The published type called `ComposerConfig` is not that configuration. It is the configuration plus the file it came from. A reader of `@prisma/composer/control` will expect `ComposerConfig` to be what `composer({...})` returns. The file is called `path` on `ComposerConfig`, `configFile` on `PipelineResult` and `StackFileInput`, and the engine's `ctx.configPath` means something else again (the `--config` flag). The type is part of the operations' public input but lives in `pipeline.ts`, an internal module. `log` also requires `path` and never reads it.

Suggestion: Rename it to something like `ComposerConfigSource`, or name the fields for what they are, for example `{ section, file }`. Use one word for the declaring file everywhere, for example `configFile`. Move the type next to the other operation-surface types in `operations/shared.ts`. Either document that `log` ignores `path`, or keep the uniform input deliberately and say so in the doc comment.

### D06: The examples do not use the import form that the docs and diagnostics tell users to write

Location: examples/*/prisma.config.ts (all ten, for example examples/bucket/prisma.config.ts:9,14 and examples/orm-demo/prisma.config.ts:2,5,16,23); test/integration/prisma.config.ts; website/prisma.config.ts; family/section.ts:14-15.

Issue: This is a real inconsistency, not a matter of style. The slice spec's own grounding example (examples/orm-demo) uses `defineConfig as composer` and `defineConfig as orm`. So do ADR-0017, ADR-0049, the guides, the skill, and the `SECTION_FIX` text every refusal prints. The examples use bare `defineConfig`, and orm-demo falls back to a namespace import (`orm.defineConfig`) because two families' `defineConfig` collide in one file. Users copy the examples more than any other source. They will see three forms, and the error message will tell them to write a fourth.

Suggestion: Use `import { defineConfig as composer }` and `composer({...})` in every example, the integration fixture and the website. Use `defineConfig as orm` where there is an ORM section. The example header comments that name `prisma-composer deploy` belong to slice 2.

### D07: `prisma.config.ts` is no longer checked by `examples-import-public-only`

Location: dependency-cruiser.config.mjs:180-186, 216-232; ADR-0049 line 49.

Issue: The old config file was deliberately left in the cruise ("MUST be cruised"), so the rule that examples, the website and tests import only the 9-public packages (ADR-0028) covered the one file that imports `/control` entries. `prisma\.config` was already excluded on `main`, and it is listed twice. Moving the Composer config into that file removes the coverage. An example config could now import `@internal/*` without any check noticing. The spec defers this, and ADR-0049 records that the imports "are not cruised". Neither says which rule is lost.

Suggestion: Keep the deferral if necessary, but name the lost rule (ADR-0028's examples-import-public-only) in the ADR-0049 consequence and in the project's deferred list. The likely fix is to stop excluding the file and exclude only the module that dependency-cruiser cannot resolve, `@prisma/cli-engine` or `prisma/config`. Remove the duplicate pattern.

### D08: The Alchemy child now evaluates every family's config, not only Composer's

Location: generate-stack.ts:74-77; dev/generate-dev-stack.ts:78-81; ADR-0049 line 42.

Issue: Importing the declaring `prisma.config.ts` in the child is the right shape. With one config file and descriptors that contain functions, no other file could supply the section. But ADR-0049 says the file "is evaluated again in the child, as the old config file was". That understates the change. The old file imported only Composer's `/control` entries. The shared file also imports the ORM config module, the engine's `definePrismaConfig` (the examples import it from the `@prisma/cli-engine` root, the whole engine barrel), and any section a user adds later. Each of those now runs in the deploy child with the child's environment. The spec defers the real orm-demo deploy to slice 3.

Suggestion: Make the consequence accurate: every section's imports run in the child, and a failure in one of them fails the deploy. Add the orm-demo deploy to the slice 3 QA list by name.

### D09: No test runs the config import that the generated stack file performs

Location: packages/0-framework/3-tooling/cli/src/__tests__/generate-stack.test.ts; dev/__tests__/generate-dev-stack.test.ts; test/integration/test/control.deploy.test.ts.

Issue: The engine-level behaviour is tested through the engine. `engine-cli.test.ts` covers the missing section, `configPath`, the whole-section merge and the case where only the repository root declares the section, using `createTestCli`. `host-adapter.test.ts` covers `LEGACY_FILE` and the `{ value, path }` handoff through the real Runtime and a real file on disk. That coverage is good. The new behaviour in the child is only string-matched: `prismaConfig.composer` on a real frozen `definePrismaConfig` export is never evaluated. The integration deploy test fails at the missing built entry before the stack file is written. The programmatic path has no test with a bad `value`, because nothing validates it (D01).

Suggestion: Add one integration test that writes the stack file for `test/integration` and imports its config binding, or evaluates the same two lines against `test/integration/prisma.config.ts`, and asserts that the extension ids match. After D01, add operation tests for an invalid `value`, a legacy file beside `path`, and a `path` whose file has no `composer` export.

## ADR reasoning check

- ADR-0049 handles the alternatives well. The schema-declared section is rejected for concrete reasons (unknown keys are not rejected, the codes would be `CLI.` rather than `CONFIG.`, and `configPath` could not get its own message). The per-key merge is rejected because the child imports exactly one file. The pre-flight retirement cites the checked versions. Missing: the validator-returns-path option (D02), the value/path invariant (D01), and the lost dependency-cruiser rule (D07).
- The ADR-0017 amendment is correct: the firewall argument is independent of the file name. The ADR-0043 amendment is correct. The ADR-0044 amendment is incomplete (D03).
- The dependency direction is correct. `family/` (engine-aware, published through `@prisma/composer-cli`) depends on `pipeline.ts` and `operations/` (engine-free, published through `@prisma/composer`), never the reverse.

## Routed to the code-review pass

- `family/section.ts` constants: `CONFIGURATION_HOME` is a vague name for a message. `SECTION_FIX`, `MOVE_TO_SECTION_FIX` and the `LEGACY_FIELD` fix text say the same thing three slightly different ways.
- `family/section.ts` header comment is two sentences. The spec asked for one.
- `ComposerConfig.path`'s doc comment says relative paths resolve against the operation's cwd, but `resolveAppIdentity` never resolves it. Check that the `log` and `dev` watch paths get an absolute path.
- `scripts/check-npm-effect-resolution.mjs`: check that the adversarial assertion fails for the import error it expects and not for any throw.
- Generated-file banners still say "Generated by `prisma-composer deploy`". That is slice 2 scope; confirm it is on its list.
