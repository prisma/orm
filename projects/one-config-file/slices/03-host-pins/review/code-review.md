# Slice 3 code review: host pins and public docs

Reviewed 2026-10-01 by the principal-engineer pass of a Drive code review.

- prisma/prisma-cli `one-config-file/composer-0-26`, `main...HEAD` (4 commits, `467ddc2`..`2621f1c`).
- prisma/web `one-config-file/composer-section-docs`, `main...HEAD` (4 commits, `9f83e72c8`..`483aaea9e`, including the skill-name fix).
- Acceptance criteria: [`../spec.md`](../spec.md) "Slice-specific done conditions", parent [`../../../spec.md`](../../../spec.md) requirement 9 and the Definition of Done items this slice owns. Evidence: [`../qa.md`](../qa.md), [`../grounding.md`](../grounding.md).
- Out of scope by design: the pkg.pr.new pins (become `0.26.0` before PR open) and `pnpm bump-version`.

## Summary

The host change is small and correct. The pins move in both manifests, the composer-cli engine-pin exception is gone, the `bin.test.ts` tests now run on every platform against Composer's real validator, and the shipped skill matches Composer's own skill nearly word for word. Package tests, lint and typecheck pass. `check:conformance` did not complete: its sandbox installs time out on the preview tarballs, so the engine-pin check without the exception is still unproven and must be rerun once the pins are `0.26.0` (F07).

The web change is accurate about what Composer 0.26.0 does, but three pages now show a `prisma.config.ts` that imports `prisma/config` without telling the reader to install `prisma` locally, and the getting-started page tells agent users to run `prisma init` (which writes its own `prisma.config.ts`) and then to write the file from scratch. Both make a reader's first `prisma dev` fail or silently drop their `skills` section. The docs also describe behaviour no released `prisma` has yet, so the web PR must merge only after the host release.

The QA transcript proves every diagnostic case from the built binary. The `dev` happy path needed `alchemy` added as a direct dependency, a Composer defect that predates this project; the "dev works" criterion is WEAK until Composer resolves its own `alchemy` bin.

## What looks solid

- Validation order. `needs.ts` validates the command's section before the handler runs, so `COMPOSE.ENTRY_UNLOADABLE` (non-Windows) or `DEV.PLATFORM_UNSUPPORTED` (Windows) in the valid-section test can only be reached after Composer's validator accepted the fixture. The test is not passing on a different config error.
- No side effects in the valid-section test. `executeDev` runs `runPipeline` (which imports the entry) before any container or emulator step, so a missing `src/service.ts` stops it before Docker or ports are touched.
- Fixture dependencies. `composer-valid.config.ts` imports `@prisma/composer/config` and `@prisma/composer/node/control`; both are in the installed package's `exports`, and `@prisma/composer` is a devDependency of `packages/cli`, where the test runs. Using `nodeBuild()` plus a hand-written state descriptor instead of the Prisma Cloud entry is the spec's allowed fallback, and avoids adding `@prisma/composer-prisma-cloud` to the host.
- Windows `where.path`. The engine realpaths `--config` with `node:path`, Composer builds `where.path` with `node:path`, and the test uses `node:path` `join`, so the separators agree on Windows.
- Conformance. Without the exception, `familyPinFindings` compares composer-cli's installed peer (`0.6.2`) with the shell's engine pin (`0.6.2`), and the separate copy count in the sandbox still catches two engines. The orm-toolchain exception correctly stays (its `8.0.0-rc.13` still peers `0.6.1`).
- `manifest-pins.test.ts` is unchanged and still requires `packages/prisma` `dependencies` to equal `packages/cli`'s; both carry the same composer-cli specifier.
- The skill. `skills/prisma-platform-core-concepts/SKILL.md` lines 74-108 use the same example, the same three `CONFIG.` codes and the same `CLI.CONFIG_SECTION_INVALID` wrapping as `prisma-composer-core-concepts` in `@prisma/composer` 0.26.0. QA steps 3 and 4 show the binary emitting exactly `CONFIG.FILE_RETIRED` and `CONFIG.FIELD_RETIRED` under that headline. `check:skill-packaging` passes.
- Web accuracy. The merge claim on `cli/configuration.mdx` matches the family's section (`merge: (_parent, child) => child`). The `CLI.CONFIG_UNREADABLE` example matches QA step 5's module error. The new anchor `#when-prismaconfigts-fails-on-an-effect-version-conflict` resolves (`lint:links` 0 errors). Every web commit carries `Linear: TML-3340`. No page names `prisma-composer.config.ts` any more.

## Findings

### F01 — Pages that show the `composer` section do not install `prisma` (correctness, prisma/web)

Where: `apps/docs/content/docs/(index)/index.mdx` line 168; `apps/docs/content/docs/(index)/prisma-compute/deploy.mdx` line 109; `apps/docs/content/docs/composer/porting-an-app.mdx` lines 64-82.

Issue: The config now imports `definePrismaConfig` from `prisma/config`. `cli/configuration.mdx` line 13 says that import resolves from the project's `node_modules`, so `prisma` must be a local dependency. Getting started now installs it (line 41), but the agent prompt's step 1, the "Bring an app you already have" step 1 and the porting guide list only `@prisma/composer` and `@prisma/composer-prisma-cloud`. A reader or agent who follows them and runs `npx prisma@latest dev module.ts` gets `CLI.CONFIG_UNREADABLE` for a missing `prisma/config`.

Suggestion: Add `prisma` as a dev dependency in each of those install steps, in the same words getting started uses.

### F02 — Getting started overwrites the config `prisma init` wrote (correctness, prisma/web)

Where: `apps/docs/content/docs/composer/getting-started.mdx` lines 13-22 and 200-216.

Issue: The "Working with a coding agent" note tells readers to run `npx prisma@latest init` after step 1. `init` writes `prisma.config.ts` with a `skills` section (`packages/cli/src/commands/init.ts` lines 565-570 in prisma-cli). Step 4 then shows the whole file with only a `composer` section, so a reader who copies it drops `skills`, which the `postinstall` hook `init` added relies on.

Suggestion: In step 4, say that if `prisma init` already created `prisma.config.ts`, add the `composer` key to its `definePrismaConfig` call; or show the `skills` key in the example.

### F03 — The docs must not publish before the host release (correctness, prisma/web)

Where: the whole web PR; `apps/docs/content/docs/guides/frameworks/solid-start.mdx` line 399.

Issue: `prisma@latest` is `8.0.0-rc.19`, which mounts composer-cli `0.25.0`. That release rejects a `composer` section with `extensions` and `state` and still reads `prisma-composer.config.ts`. Every page in this PR is wrong for readers until a `prisma` release pinning `0.26.0` is on `latest`. Separately, `solid-start.mdx` prints `@prisma/composer 0.25.0`; `lint:versions` passes today but fails once `0.26.0` is `latest`.

Suggestion: State in the web PR description that it merges only after `prisma@latest` pins Composer 0.26.0, and update the `solid-start.mdx` version line in the same PR (or right after, when `lint:versions` asks).

### F04 — Stale `effect`-pinning instructions remain on the touched pages (correctness, prisma/web)

Where: `apps/docs/content/docs/(index)/index.mdx` line 168; `apps/docs/content/docs/(index)/prisma-compute/deploy.mdx` lines 32 and 109.

Issue: Getting started (line 46) and deploying now say a plain Composer app does not pin `effect`; an override is only for a dependency that pins another version. The agent prompt still tells every agent to add an `effect` override, and the Compute deploy page tells readers to "pin the `effect` family". The spec asked that the pre-flight passages describe the pins and the fail-fast behaviour; these three passages contradict that.

Suggestion: Drop the pinning instruction from the two step-1 texts and the agent prompt, or reword them to "only if another dependency pins a different `effect`" with a link to the deploying section.

### F05 — The valid-section test relies on an unpinned Composer handler code (maintainability, prisma/prisma-cli)

Where: `packages/cli/tests/bin.test.ts` lines 557-574.

Issue: The test asserts only `exitCode` 2 and `error.code` `COMPOSE.ENTRY_UNLOADABLE`. That proves validation passed, but `COMPOSE.ENTRY_UNLOADABLE` is a code from inside Composer's deploy pipeline, not part of the family's contract with the host. If Composer adds a step before the entry import, this host test breaks for a reason unrelated to the section. Nothing asserts that the failure is about the entry the host passed.

Suggestion: Also assert that `error.summary` names `service.ts`, so the test shows the argv reached Composer's handler, and keep the code check as is. The doc comment should say the code comes from the handler's entry import.

### F06 — The `configPath` test checks the diagnostic partially (style, prisma/prisma-cli)

Where: `packages/cli/tests/bin.test.ts` lines 541-555.

Issue: Exit code, headline code, and the diagnostic's `code`, `meta` and `where` are asserted; the array length is exact. The headline's `summary` (which names the section and file) and the diagnostic's `severity` are not. This is enough to catch a mis-wired section, so it is a small gap.

Suggestion: Optionally add `error.summary` containing the fixture path. No change needed otherwise.

### F07 — Preview-only settings must leave with the preview pins (correctness, prisma/prisma-cli)

Where: `pnpm-workspace.yaml` lines 43-44; `pnpm-lock.yaml` lines 1304-1318.

Issue: `blockExoticSubdeps: false` exists only because the preview composer-cli depends on `@prisma/composer` by URL. Left in place after the switch, it silently allows URL and git dependencies anywhere in the tree. The lockfile also holds two copies of `@prisma/composer` (`@331`, a moving PR reference, for the devDependency, and `@be95770` inside composer-cli), both without integrity hashes; the startup canary therefore imports a different copy than the family uses.

The preview specifiers also break `pnpm check:conformance`: this review's run timed out in both sandbox installs (300s each), with no `@prisma/composer-cli` installed, so the suite has not yet shown the composer-cli engine pin equal to the engine's. PR CI and the dev publish both run this check.

Suggestion: In the commit that switches to `0.26.0`, delete the setting and its comment, run `pnpm install`, check that the lockfile has one `@prisma/composer@0.26.0` with an `integrity` field, and rerun `pnpm check:conformance`. If it still times out against registry packages, that blocks this PR; it is not a deferral.

### F08 — The skill's fix sentence is wrong for `CONFIG.SECTION_MISSING` (style, prisma/prisma-cli)

Where: `skills/prisma-platform-core-concepts/SKILL.md` lines 106-108.

Issue: "The fix for all three is to move the old file's `extensions` and `state` into the section" does not apply to a new project with no old file, which gets `CONFIG.SECTION_MISSING`. The sentence is copied from Composer's skill, which has the same flaw.

Suggestion: "Write the section; if an old file exists, move its `extensions` and `state` into it and delete it." Fix the Composer copy in the next Composer PR (deferred below) so the two stay identical.

## Deferred

- **prisma/composer: resolve the `alchemy` bin from Composer's own dependency.** QA step 2 failed with `DEPLOY.ALCHEMY_BIN_MISSING` in a plain pnpm project because pnpm links bins only for direct dependencies. This is a real user-facing defect, not a nice-to-have; raise it as a Composer fix PR before GA rather than parking it. Not caused by this project.
- **prisma/composer: the skill's fix sentence** (see F08).
- **prisma/prisma-cli: the declared-peer engine check.** Every tandem engine release (the next `0.6.3`) will need a new exception per family until each family republishes, which is the friction this PR just removed. The sandbox already counts resolved engine copies, which is the real hazard. Consider making the declared-peer comparison a warning, or comparing against the engine version that resolves for the family in the sandbox. Out of scope for a pin bump.
- **prisma/composer: examples pin `prisma` at the previous host release** (spec edge case, already recorded).

## Already addressed

- The skill-name mismatch (`prisma-composer` vs `prisma-composer-core-concepts`) on `composer/index.mdx` and `ai/tools/skills.mdx`: fixed in `483aaea9e`.
- The automatic product-versions PR: not yet opened (0.26.0 is not on `latest`); the spec's edge-case table covers it.

## Verification run by this review

- `pnpm --filter @prisma/cli test`: 64 files, 1025 passed, 1 skipped (Windows-only `spawn-adapter` case). Includes `bin.test.ts`, `composer-isolation.test.ts`, `v8-conformance.test.ts`, `manifest-pins.test.ts`.
- `pnpm --filter` tests for `@prisma/cli-engine` (1025 passed), `@repo/cli-conformance` (66), `@repo/cli-telemetry` (49).
- Root `pnpm test` fails locally for `prisma` and `@prisma/compute` with "No projects were found" because those packages have no vitest config and vitest walks up into the orm repository that contains this clone. An artifact of the clone location, not the branch; CI runs from a standalone checkout.
- `pnpm check:conformance`: failed. Both sandbox installs (`@prisma/cli` and `prisma` tarballs) hit `tarball/install-timed-out` after 300s; the `@prisma/cli` sandbox had `@prisma/composer` but no `@prisma/composer-cli`. The tarballs carry the pkg.pr.new specifiers, so this run says nothing about the engine-pin check itself (see F07).
- `pnpm lint` (biome, 472 files) and `pnpm typecheck` (9 tasks): pass.
- prisma/web `apps/docs`: `lint:links` 0 errors, `lint:versions` all current, `lint:code` exit 0 (pre-existing advisory counts), cspell 0 issues on the changed pages.

## Acceptance criteria

| # | Criterion | Result | Evidence |
| --- | --- | --- | --- |
| 1 | QA transcript shows `--help` cases from the built binary outside the workspace | PASS | qa.md step 1 |
| 2 | `prisma dev module.ts` starts against the `composer` section | WEAK | qa.md step 2 needed `alchemy` as a direct dependency |
| 3 | Old file restored: `CONFIG.FILE_RETIRED`, exit 2 | PASS | qa.md step 3 (through `dev`; validation is the same for `deploy`) |
| 4 | `composer: { configPath }`: `CONFIG.FIELD_RETIRED`, exit 2 | PASS | qa.md step 4; `bin.test.ts` 541-555 |
| 5 | Forced `effect@4.0.0-rc.118`: `CLI.CONFIG_UNREADABLE`, exit 2; `--version` exits 0 | PASS | qa.md step 5 (through `dev`, as the slice spec allows) |
| 6 | Parent DoD: `prisma deploy` runs against the migrated example | NOT VERIFIED | qa.md step 6, no service token |
| 7 | `pnpm test` passes, conformance without the composer-cli exception | NOT VERIFIED | package tests above; `conformance.ts` 110-121 |
| 8 | Pins equal across `packages/cli` and `packages/prisma` | PASS | `manifest-pins.test.ts`; both manifests line 53/54 |
| 9 | `bin.test.ts`: engine headline plus `CONFIG.FIELD_RETIRED` diagnostic; Windows pair collapsed | PASS | `bin.test.ts` 541-574 |
| 10 | Valid-section test proves validation passed | WEAK | proves it by ordering, asserts only a Composer-internal code (F05) |
| 11 | `composer-isolation.test.ts` still passes | PASS | package test run |
| 12 | Host skill describes the section and the three codes as Composer's skill does | PASS | SKILL.md 74-108 vs `prisma-composer-core-concepts` 219-247 |
| 13 | Web: five `prisma-composer.config.ts` mentions become the section with `prisma/config` | PASS | `9f83e72c8`; F01 covers the missing install step |
| 14 | Web: `effect` passages describe `CLI.CONFIG_UNREADABLE` and the pins | WEAK | getting-started and deploying correct; F04 |
| 15 | Web: `configuration.mdx` names the section and its whole-section merge | PASS | `e92ce1509`; matches family `merge` |
| 16 | Web commits carry `Linear: TML-3340` | PASS | all 4 commits |
| 17 | Web PR open with content checks passing | NOT VERIFIED | PR not opened yet; local lints pass |

Counts: PASS 11, WEAK 3, NOT VERIFIED 3, FAIL 0.

## Verdict

Not ready for PR yet.

- prisma/prisma-cli: ready once the pins are `0.26.0`, F07 is done and `check:conformance` passes. F05, F06 and F08 are small and can land in the same round.
- prisma/web: fix F01, F02 and F04 first. F03 decides when it may merge: after the host release.
- The `dev` happy path stays WEAK until the Composer `alchemy` bin fix lands. Say so in the host PR description rather than claiming it.
