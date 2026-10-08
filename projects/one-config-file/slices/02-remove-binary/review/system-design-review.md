# System design review: slice 2, the `prisma-composer` binary is removed

Branch `one-config-file/remove-binary` against `one-config-file/composer-section` (prisma/composer, ten commits, 6f9f3a59 to e2d298ae). Read against the slice spec, its grounding, the project spec and design notes. No builds or tests were run.

## Verdict

The deletion boundary is coherent. The family is `deploy` and `dev` over `ComposerOperations`, `/control` keeps all four operations with their own entry test, and nothing in `packages/` still names the old command. The static-graph and engine-pin checks shrank cleanly with the second tsdown config. The allowlist-by-path-and-count design in the lint script is right.

The weak joint is the examples. They are a surface users and agents copy from (the skill sends readers to `examples/`), and they now carry repo-internal paths, a destroy grammar the project says is not a concept, and a dependency users never install. Two taught-model gaps sit in the guides: the credential split between `prisma deploy` and the `destroy` operation, and `bun` versus plain `prisma`. D01, D03 and D04 should be settled before merge. The rest are small.

## Findings

### D01: Examples teach repo-internal paths and bring back the retired destroy grammar (should fix)

Location: examples/orm-demo/package.json lines 9-10, the same `deploy`/`destroy` scripts in the other nine examples and examples/env-param/package.json line 13 (`destroy:stage`), website/package.json lines 13-14.

Issue: Every example now runs `bun ../../node_modules/.bin/prisma deploy` and `bun ../../scripts/composer-destroy.ts module.ts --production`. The first path depends on `node-linker=hoisted` and the repository depth. The second calls a script that is not published. Its flags, `--production` and `--stage <name>`, copy the deleted command's grammar. The project spec's Deferred section and design-notes § "Rejected: mounting destroy in the host" say `--production` is not a concept in Composer's model or the consolidation plan. The guides teach a different shape, a `destroy({ target: { kind: ... } })` script. A reader of an example learns the deleted grammar and a path that does not exist in their project. The slice spec's At a glance shows `node_modules/.bin/prisma`. The hoisted-linker deviation is explained in commit 8406e817 but not recorded in the spec.

Suggestion: Keep `scripts/composer-destroy.ts` for CI only (`destroy-guard.sh` and the action), and remove the `destroy` scripts from the examples. Point each example README at the guide's destroy script, or give each example a small `destroy.ts` in exactly the documented shape. For deploy and dev, find a form that does not hard-code the hoisting depth. Try having Bun resolve the bin through the `PATH` that `pnpm run` sets up; this needs verifying. If none works, keep the path and record the deviation in the slice spec.

### D02: Examples declare `@prisma/composer-cli`, which users never install, and repeat the host version 14 times (should fix)

Location: the `@prisma/composer-cli` devDependency in all ten example manifests, website/package.json line 23 and test/integration/package.json line 13; the root package.json lines 37 and 48-50; `"prisma": "8.0.0-rc.19"` in 14 manifests.

Issue: docs/guides/getting-started.md line 67 installs only `prisma`, and the host brings the family. The examples still list the family package. It probably serves as the build edge: `turbo run build --filter <example>...` has to build `composer-cli/dist`, which the overridden host loads. That reason appears nowhere. The root devDependency exists only to place the override's link where the hoisted host resolves it (commit 6f9f3a59). Both are workspace mechanics that are invisible in the examples yet shape them. Slice 3 bumps the host pin, and that bump has to touch 14 files that must agree.

Suggestion: Put the host version in a pnpm catalog (pnpm 10.27 supports catalogs), so the slice 3 bump is one line. Make the build edge explicit: either a turbo `dependsOn` on `@prisma/composer-cli#build` for the examples, or keep the devDependency and write a one-line comment next to the override in the root manifest (or in `CONTRIBUTING.md`) that says why each piece exists.

### D03: The `destroy` operation cannot use the sign-in that `prisma deploy` uses, and getting-started hides this (should fix)

Location: docs/guides/getting-started.md lines 56-58, 346-351 and 393-398; docs/guides/deploying.md lines 18-31; skills/prisma-composer-core-concepts/SKILL.md lines 537-540.

Issue: The guide tells a newcomer to sign in with `prisma auth login`, deploy a stage, and then tear it down with the `destroy` operation. That operation reads `PRISMA_SERVICE_TOKEN` and `PRISMA_WORKSPACE_ID` from the environment and ignores the stored session. deploying.md says so, but getting-started does not, and the skill's list of known gaps does not include it. The first teardown a newcomer attempts therefore fails, or sends them to the Console for two values the guide just told them they no longer need. This follows from the project's non-goal (no new commands), so it is a real gap and not a defect of this slice. It should be named where the reader meets it.

Suggestion: Add the gap as a third item in the skill's "Name the gap" list. At getting-started line 396, say that the script needs a service token and the workspace ID. Record it under the project spec's Deferred section as part of the teardown command-grammar project.

### D04: Guides run `prisma` under Node while the examples and CI insist on Bun (should fix)

Location: docs/guides/getting-started.md lines 290, 349 and 393; .github/actions/deploy-verify-destroy/action.yml lines 46-51; the slice spec's "Scripts keep the bun prefix".

Issue: The action's comment and the spec justify the `bun` prefix: Load imports service modules that use Bun APIs, and those throw under Node. The getting-started app uses `Bun.serve`, but the guide runs `pnpm prisma dev` and `pnpm prisma deploy`, which run under Node because of the bin's shebang. One of the two is wrong. Either the guide fails at Load, or the examples carry a prefix they do not need. The old guide had the same mismatch, but this slice rewrote both sets of lines and restated the reason.

Suggestion: Check which is true with the getting-started app, then make the guides, the skill and the examples agree. If Bun is required, the guides need the Bun form and the skill must say so.

### D05: The npm-resolution check asserts the family's exact command list (fix)

Location: scripts/check-npm-effect-resolution.mjs lines 226-255 (`importFamily`, `assertFamilyImports`), used by both the healthy and adversarial shapes.

Issue: The check exists to prove that npm resolves one `effect` that Alchemy can import, and that the family still loads when Alchemy cannot. It now fails unless the family lists exactly `["deploy","dev"]`. The deferred command-grammar work adds commands to this family, and that change would break a dependency-resolution check for an unrelated reason. The family's own test in `family/__tests__/family.test.ts` already covers which commands it has.

Suggestion: Assert that the import succeeds and that the command set includes `deploy`, the command whose dependency graph `effect` affects. Leave the full list to the family test.

### D06: The destroy script restates the operation's types by hand (should fix)

Location: scripts/composer-destroy.ts lines 20-47; scripts/composer-destroy.test.ts lines 11-29.

Issue: `DestroyTarget`, the input shape, `DestroyEvent` and the failure shape are written out again structurally. The test runs against a fake `destroy`. If `DestroyInput` changes (for example, the target becomes a stage-name union), nothing fails before the e2e deploy workflow runs. Apart from that, the script is at the right level. It only parses arguments, loads the section and renders results, and it leaves validation to the operation, which already refuses a section the CLI would refuse (see the new `exports/__tests__/control.test.ts`).

Suggestion: Import the types with a type-only import from `@prisma/composer/control`, which is erased at run time, so the script still resolves the value from the app. Add `@prisma/composer` to the root devDependencies if that is needed for the import to resolve. If `scripts/` is not typechecked, add a `satisfies` assertion in a cli package test instead.

### D07: The retired-name lint misses runtime messages, and its name is inaccurate (should fix)

Location: scripts/lint-retired-cli-name.mjs lines 22-30 (`CHECKED_PATHS`), 42-52 (`EXCLUDED_DIRECTORIES`), 56-60 (`COMMAND_PATTERNS`); package.json line 15; .github/workflows/ci.yml lines 30-31.

Issue: The slice rewrote user-facing error text in `dev-emulators/src/client.ts`, `local-target/preflight.ts` and the generated stack-file headers. Users read those at run time, but no check covers `packages/`, so they can regress unnoticed. `generated` is excluded under every checked tree, which is wider than the one case it documents (`website/src/generated`). The first command pattern matches any word after the old name, prose included, so the check is really about the name rather than the command. The script's name says the CLI is retired. The CLI is `prisma` and it is not retired; the binary name and the config-file name are.

Suggestion: Add `packages/*/*/*/src` with test folders excluded, and allowlist the legacy-file finding text in `composer-config.ts` by count. Exclude `website/src/generated` by exact path. Rename the script to `lint-retired-composer-names` (or `lint-retired-binary-name`) and rename the CI step to match. Send the regex details to the code-review pass.

### D08: The `@prisma/composer/control` name now faces users while it also means "config-only" (note)

Location: docs/guides/deploying.md lines 168-195 and 387-395; docs/guides/running-locally.md lines 69-100; packages/0-framework/3-tooling/cli/src/exports/control.ts lines 1-15.

Issue: The guides now tell users to import `@prisma/composer/control` from their own scripts. `@prisma/composer/node/control` and `@prisma/composer-prisma-cloud/control` sit in the same config file, and ADR-0017 allows importing those only from `prisma.config.ts`. The `exports/control.ts` doc comment explains the difference, but a user never reads it. Two import paths that end in `/control` now follow opposite rules.

Suggestion: Add one sentence under "Driving deploys from code" that states the difference. Record the naming under the project's Deferred section, beside the teardown commands.

### D09: The cli package's `.` entry has no consumers left, and the destroy and log deps variants now serve only tests (low)

Location: packages/0-framework/3-tooling/cli/src/exports/index.ts; tsdown.config.ts line 10; package.json lines 7 and 44; operations/destroy.ts lines 38-41 and the matching lines in operations/log.ts.

Issue: `git grep` finds no importer of `@internal/cli` or of `exports/index.ts`. Its last reasons to exist, `cli` and `shippedVersion`, left with the binary. Its doc comment ("for tests and any programmatic use") describes nothing. The `WithDeps` variants of `destroy` and `log` now exist only for unit tests, yet their comment still says they carry "the CLI's RunDeps".

Suggestion: Delete the `.` entry, its tsdown entry and the `types` field, or state which consumer it serves. Send the stale comment to the code-review pass. Keeping the `WithDeps` seam for tests is fine.

### D10: The control double's name describes the wrong thing (low)

Location: packages/0-framework/3-tooling/cli/src/testing/control-double.ts lines 1-17 and 141; exports/testing.ts.

Issue: `createControlDouble`, published through `@prisma/composer/testing`, is typed as `ComposerOperations`. It is a double of what the family calls, which hosts use to test mounting, not a double of `/control`, which still exports four operations. The updated comment says this, but the name does not. Users who now write destroy and log scripts get no double for them. That is acceptable, but it should be a deliberate choice.

Suggestion: Keep the double's scope and say in the doc comment that the double does not cover `destroy` and `log`. Consider renaming it to `createFamilyOperationsDouble` together with the `ComposerOperations` name if the published surface gets another breaking change before GA.

### D11: Project artifacts contradict the code (low)

Location: projects/one-config-file/design-notes.md line 52; slices/02-remove-binary/spec.md At a glance and "check-npm-effect-resolution" paragraph.

Issue: The design notes say `destroy` and `log` "remain as operations in `ComposerOperations`". The slice removed them, correctly. The spec shows `node_modules/.bin/prisma` and says the adversarial shape "stays as slice 1 left it". The adversarial shape had to change because it ran the removed binary's `--help`.

Suggestion: Correct the design notes. Record both deviations in the slice spec's done notes.

### D12: Breaking changes to the published `./family` and `./testing` surfaces (note)

Location: packages/0-framework/3-tooling/cli/src/exports/family.ts (removed `BINARY_NAME`, `createComposerCli`, `runComposerCli`, `ComposerCliSpec`); control-double fixtures and calls (removed the `destroy` and `log` fields).

Issue: The host (prisma-cli) imports `./family` and tests against `./testing`. Under 0.x, 0.26.0 is the right bump for these removals. The spec's done condition (`prisma deploy --help` through the override) checks that the published host does not import a removed name. Nothing in this repository can check prisma-cli's test suite against the removed double fields.

Suggestion: List the removed exports in the release notes for 0.26.0. Put a check in slice 3's host pin bump that prisma-cli's family tests still build against the new double.

## Routed to the code-review pass

- The stale "the CLI's RunDeps" comment in operations/destroy.ts and operations/log.ts.
- The retired-name regex details: prose matches, and the empty-file branch at lines 114-121 of the lint script.
- composer-destroy.ts hard-codes `prisma.config.ts` in the working directory. That is fine while the script stays repo-private, but it should be noted in the script's doc comment.
- family.ts lines 8-9: an over-long reflowed comment line.
