# Slice 3 grounding: the host, prisma/web and TML-3340

Read on 2026-10-01. Sources:

- prisma/prisma-cli `main` at `4d254ff` (2026-09-30, "fix(cli): make logout and update notices clearer (#317)"). The project spec cites `fee1624`; main has moved on, nothing below depends on the difference.
- prisma/composer branch `one-config-file/remove-binary` (PR #331, open, stacked on PR #328, open) for what 0.26.0 will publish.
- prisma/web `main` at `e262c4d`.
- npm registry dist-tags, read the same day.
- Linear TML-3340.

Paths under "host" are relative to the prisma/prisma-cli root.

## 0. What Composer 0.26.0 publishes (from the slice 2 branch)

`packages/9-public/composer-cli/package.json`: `@prisma/composer-cli@0.26.0`, no `bin`, exports `./family`, `./testing`, `./package.json`, peer `@prisma/cli-engine: 0.6.2`, deps `@prisma/composer` (workspace, becomes 0.26.0), `alchemy 2.0.0-beta.78`, `effect 4.0.0-rc.115`, `esbuild`, `cross-spawn`. `@prisma/composer@0.26.0` still exports `./deploy`, `./control`, `./config`, `./testing` and the rest.

Today on npm: `@prisma/composer-cli` and `@prisma/composer` are `latest 0.25.0` (2026-09-29), `dev 0.25.0-dev.3` (2026-09-30). `0.25.0` declares `bin: prisma-composer`, peers engine `0.6.1`. `prisma` and `@prisma/cli` are `latest 8.0.0-rc.19`, `dev 8.0.0-rc.19-dev.136`. `@prisma/cli-engine` is `latest 0.6.2`.

The section validator (`packages/0-framework/3-tooling/cli/src/family/section.ts`, `src/composer-config.ts`) returns these codes. They are not the codes slice 1's spec names (`CONFIG.LEGACY_FILE`):

| Case | Composer code | Where it comes from |
| --- | --- | --- |
| No file declares `composer` | `CONFIG.SECTION_MISSING` | validator, `composer-config.ts:43-48` |
| `composer: { configPath }` | `CONFIG.FIELD_RETIRED`, `meta.field: "configPath"` | validator, `composer-config.ts:193-207` |
| `prisma-composer.config.*` beside the declaring file | `CONFIG.FILE_RETIRED` | validator, `retiredFileFinding` |
| Unknown key, bad field | `CONFIG.FIELD_UNKNOWN`, `CONFIG.FIELD_INVALID`, `CONFIG.EXTENSION_DUPLICATE` | validator |
| `--config` names a file that does not exist | `CONFIG.FILE_MISSING` | `configFileMissing` |

All validator findings reach the user wrapped by the engine: the result envelope's `error.code` is `CLI.CONFIG_SECTION_INVALID` and Composer's finding is in `envelope.diagnostics[]` (engine `packages/cli-engine/src/execution/needs.ts:285-313`, `350-380`; shape pinned by `packages/cli-engine/tests/config.test.ts:1250-1312`). In human mode both `[CLI.CONFIG_SECTION_INVALID]` and the Composer code print on stderr. Host tests must assert the diagnostic, not the top-level code.

Family command needs (slice 2 branch, `family/commands/deploy.ts:55`, `dev.ts:207`): `deploy` has `{ config: composerSection, credentials: 'child' }`; `dev` has `{ config: composerSection }`, no credentials. The engine checks credentials before config (`needs.ts:74-100`).

## 1. Composer pins in the host

| File | Line | Field | Package | Version |
| --- | --- | --- | --- | --- |
| `packages/cli/package.json` | 53 | `dependencies` | `@prisma/composer-cli` | `0.25.0` |
| `packages/cli/package.json` | 65 | `devDependencies` | `@prisma/composer` | `0.25.0` |
| `packages/prisma/package.json` | 54 | `dependencies` | `@prisma/composer-cli` | `0.25.0` |

No `@prisma/composer-prisma-cloud` anywhere in the host. No pnpm catalog, no changesets. `pnpm-workspace.yaml:21-26` exempts `@prisma/composer` and `@prisma/composer-cli` (by name, not version) from `minimumReleaseAge`, so a same-day release installs. Lockfile entries: `pnpm-lock.yaml:32, 63, 215, 1304, 1311, 4016, 4050`.

`@prisma/composer` is a devDependency only because `tests/fixtures/startup-probe.mjs:29` imports `@prisma/composer/deploy` as the canary; `scripts/update-product-versions.mjs:49-52` says it must move with `composer-cli`.

Pin equality between the two manifests:

- `packages/cli/tests/manifest-pins.test.ts:29-35` asserts `packages/prisma` `dependencies` equal `packages/cli` `dependencies` exactly (devDependencies are not compared, so `@prisma/composer` lives only in `packages/cli`).
- The tarball conformance check (`packages/cli/scripts/conformance.ts:96-141`) also catches divergence; `packages/cli/AGENTS.md` (line 96 of the file) states the two-manifest rule and the `prisma@8.0.0-rc.8` incident.

How a bump is normally done: automatically. `.github/workflows/update-product-versions.yml` runs on a `product-published` `repository_dispatch` from Composer's publish workflow, daily at 06:17 UTC, or by hand. It runs `node scripts/update-product-versions.mjs --channel release` (watched list `scripts/update-product-versions.mjs:47-54`: `@prisma/composer-cli`, `@prisma/composer`, `@prisma/orm-toolchain`, all following `latest`), rewrites both manifests across `dependencies`/`devDependencies`/`optionalDependencies`, runs `pnpm install --lockfile-only`, closes any open `product-versions/*` PR, pushes `product-versions/<timestamp>` as willbot with Will's sign-off trailer, opens a PR and arms squash auto-merge (lines 72-114). Docs: `docs/oss/release-automation.md:15-20`, `docs/oss/versioning.md` "Which product versions a CLI ships".

Consequence: the moment Composer 0.26.0 lands on `latest`, a bot PR appears that bumps the three pins. Its CI will fail on the tests in section 2. Slice 3 is either that PR with fixes pushed onto it, or a hand PR that supersedes it (the next scheduled run closes the bot PR only if it opens another one, so close it by hand or build on it).

Dev channel: every push to `main` runs `update-product-versions.mjs --channel dev` inside `publish.yml:80-86`, so `prisma@dev` builds already pick up Composer's `dev` tag without any commit. That run checks only `check:grammar`, `test:scripts` and `check:conformance` (`publish.yml:91-97`), not `pnpm test`.

## 2. Host files that reference the old Composer surface

Searched `packages/`, `scripts/`, `docs/`, `skills/`, `.github/`, `AGENTS.md`, `README.md` for `configPath`, `composer-section`, `named-by-the-section`, `CONFIG.FILE_MISSING`, `createControlDouble`, `createOperationsDouble`, `@prisma/composer-cli/testing`, `@prisma/composer/deploy`, `@prisma/composer/control`, `prisma-composer`.

Not found anywhere in the host: `createControlDouble`, `createOperationsDouble`, `@prisma/composer-cli/testing`, `@prisma/composer/control`, `destroy`/`log` as Composer commands. The rename and the testing exports need no host change. Every `configPath` hit in `packages/cli-engine/**` and most in `packages/cli/src/**` is the engine's own `--config` plumbing or the telemetry user-config path, unrelated to Composer.

Hits that matter:

| File | Lines | What it asserts or does | Breaks on 0.26.0? |
| --- | --- | --- | --- |
| `packages/cli/tests/fixtures/config/composer-section.config.ts` | 1-9 | `definePrismaConfig({ composer: { configPath: "./named-by-the-section.config.ts" }, parent: false })`, imported from `@prisma/cli-engine` | Becomes the legacy-field case: validator returns `CONFIG.FIELD_RETIRED`. |
| `packages/cli/tests/bin.test.ts` | 37-43 | `COMPOSER_SECTION_CONFIG_PATH` constant | — |
| `packages/cli/tests/bin.test.ts` | 507-526 | `runComposerDev()`: in-process `main(proc)` with argv `dev --config <fixture> src/service.ts`, parses the JSON result frame | — |
| `packages/cli/tests/bin.test.ts` | 528-557 | non-Windows: exit 2, `error.code === "CONFIG.FILE_MISSING"`, `error.where.path` is `named-by-the-section.config.ts` next to the fixture, `error.why` contains `"there is no walk to fall back on"` | Yes. New result: exit 2, `error.code` `CLI.CONFIG_SECTION_INVALID`, diagnostic `CONFIG.FIELD_RETIRED`. |
| `packages/cli/tests/bin.test.ts` | 559-578 | Windows only: exit 2, `DEV.PLATFORM_UNSUPPORTED`, because the old section validated and the handler refused the platform first | Yes. Validation now fails before the handler, so Windows gets the same `CLI.CONFIG_SECTION_INVALID` as every other platform. The `skipIf`/`runIf` pair collapses into one test (CI runs ubuntu and windows, `.github/workflows/test.yml:15-21`). |
| `packages/cli/tests/composer-isolation.test.ts` | 74-100 | Spawns `node --import tsx tests/fixtures/startup-probe.mjs`; `--version` evaluates `@prisma/composer-cli/dist/family.mjs` and no alchemy/effect module, no SIGINT/SIGTERM listeners; canary imports `@prisma/composer/deploy` and sees alchemy and effect | Should pass: `./deploy` still exported, `dist/family.mjs` kept by slice 2. Node 24 only (lines 42-49). |
| `packages/cli/tests/fixtures/startup-probe.mjs` | 22-40 | runs `main` with `--version`; canary import at 29; family match at 37 | As above. |
| `packages/cli/tests/v8-conformance.test.ts` | 31-58 | section names are exactly `["composer","orm","skills"]`; `checkValidatorNoThrow` over hostile inputs returns `[]` | Should pass if the new validator never throws. The hostile inputs (`packages/cli-conformance/src/checks/validator-no-throw.ts:22-71`) are mostly `{ configPath: ... }` objects; with 0.26.0 they exercise the retired-field branch. Provenance there is a synthetic file (`validator-no-throw.ts:159-181`), and `retiredFileFinding` does `existsSync` on its directory. |
| `packages/cli/tests/v8-conformance.test.ts` | 60-80 | built `dist` imports only declared deps; must import `@prisma/composer-cli/family` | Unchanged. |
| `packages/cli/scripts/conformance.ts` | 57-81 | import purity, `requiredSpecifiers` include `@prisma/composer-cli/family` for both `@prisma/cli` and `prisma` | Unchanged. |
| `packages/cli/scripts/conformance.ts` | 83-94 | validator no-throw over platform, composer, orm families (not skills) | Same as above. |
| `packages/cli/scripts/conformance.ts` | 112-128 | pin exception: `@prisma/composer-cli` peers engine `0.6.1` while the shell ships `0.6.2`; `removeWhen: "composer-cli releases peering 0.6.2 and the follow-up bump PR pins that release"` | 0.26.0 peers `0.6.2`, so this PR is the follow-up it names. Delete the composer entry. An unused exception does not fail (`packages/cli-conformance/src/checks/tarball.ts:506-535`), so nothing forces this. The orm-toolchain entry stays. |
| `packages/cli/tests/orm-mount.test.ts` | 64-76, 116-128 | mounts `composerCommandFamily` beside the ORM family; `shell({})` expects `CLI.CONFIG_SECTION_INVALID` for the `orm` section | Unaffected: the engine validates only the running command's section (`needs.ts:255-279`), so an absent `composer` section does not fail ORM commands. |
| `packages/cli/tests/mount-coverage.test.ts` | 167-183 | every command in the composer family is mounted | Passes: the family already has only `deploy` and `dev`. |
| `skills/prisma-platform-core-concepts/SKILL.md` | 90-93 | "`prisma-composer.config.ts` configures Composer itself and is a separate, mandatory file for `dev` and `deploy`: without it `dev` fails with `CONFIG.FILE_MISSING`." | Wrong after 0.26.0. This skill ships inside the `prisma` tarball (`packages/prisma/package.json` `files: ["skills"]`, staged by `scripts/stage-skills.mjs` in `prepack`) and `prisma init` installs it. Not on slice 3's list. |
| `packages/cli/tests/skills-sync.test.ts` | 174-190, 841-856 | a fake `@prisma/composer` package carrying a skill named `prisma-composer` | Fixture names only, no change needed. |

No host doc names `prisma-composer.config.ts` except that skill.

## 3. How the host mounts the family

`packages/cli/src/cli.ts`:

- line 10: `import { createComposerFamily } from "@prisma/composer-cli/family";`
- line 141: `export const composerCommandFamily: CommandFamily = createComposerFamily();`
- lines 414-416: `deploy: composerCommandFamily.commands.deploy`, `dev: composerCommandFamily.commands.dev`.
- lines 454-465: `buildCli()` passes `composerCommandFamily` in `commandFamilies`, which is how its `composer` section reaches the engine's set of known section names.

Nothing in the host reads the family's section value or any other command. The only other consumers of `composerCommandFamily` are tests and `scripts/conformance.ts`, which read `family.configSections` through `sectionsFrom` and the `commands` map for coverage.

## 4. Host release process

- `publish.yml` triggers on every push to `main` and on `workflow_dispatch` (`.github/workflows/publish.yml:12-27`).
- Every run publishes a dev build: `scripts/determine-version.ts` computes `<base>-dev.<run>`, `set-version.ts` stamps it, `update-product-versions.mjs --channel dev` moves product pins to their `dev` tags, then build, `check:grammar`, `test:scripts`, `check:conformance`, publish `@prisma/cli` and `prisma` under `dev` (lines 76-122). The engine publishes only when its own version changed.
- A release happens only when the push changed the root `version` (`package.json:3`, `8.0.0-rc.19`): restore committed versions, re-check with `PUBLISH_CHANNEL=release` (refuses any `-dev.` dependency), publish `@prisma/cli-engine`, `@prisma/cli` and `prisma` under `latest`, create a GitHub prerelease (lines 124-217).
- `8.0.0-rc.N` advances only through `pnpm bump-version`, driven by `skills-contrib/publish-npm-version/SKILL.md`, as a `chore(release): 8.0.0-rc.N+1` PR (`docs/oss/versioning.md` "Procedure: cut the next release"). Lockstep across `cli`, `prisma`, `cli-conformance`, `cli-telemetry`, `tsconfig`; `@prisma/cli-engine` and `@prisma/compute` version on their own.
- So a pin-bump PR merges without a host release; it ships only `prisma@8.0.0-rc.19-dev.N`. `prisma` and `@prisma/cli` publish from the same workflow and step. A `prisma@latest` with Composer 0.26.0 needs a separate release PR. Composer's examples use the `prisma` catalog pin `8.0.0-rc.19` (composer `pnpm-workspace.yaml:11-12`), so they keep running 0.25.0's host outside the workspace until the host releases.
- PR CI: `pr-quality.yml` runs `pnpm typecheck`, `biome ci`, `check:grammar`, `check:error-reference`, `check:skill-packaging`, `pnpm test`, `pnpm test:scripts`, `check:conformance` (lines 37-184). `test.yml` runs `pnpm build` then `pnpm --filter @prisma/cli test` on ubuntu and windows, Node 24 (lines 15-60), plus `scripts/check-engine-version.mjs` against the base branch (line 86).

## 5. Host agent instructions and commands

- `AGENTS.md`: use `pnpm`; `pnpm --filter <package> <script>` for package checks; every mounted command needs a real-API e2e or an `EXCLUSIONS` entry in `packages/cli/tests/e2e-coverage.test.ts` (`deploy` and `dev` are already excluded, lines 98-100); pre-commit: `pnpm typecheck`, `pnpm lint`, `pnpm --filter @prisma/cli test`.
- `packages/cli/AGENTS.md`: product docs in `docs/product` are the source of truth; `better-result` error handling; the two-manifest pin rule.
- `packages/cli-engine/AGENTS.md`: arktype rules for section schemas. Not touched here.
- `.github/workflows/AGENTS.md`: pin actions by SHA.
- No `.agents/rules` directory. `.agents/` holds only a diary and one project. `skills-contrib/publish-npm-version` is the release skill.
- `CONTRIBUTING.md`: Node 24+, pnpm 10 (root `packageManager` says `pnpm@11.6.0`), `pnpm install`, `pnpm test`. `.node-version` is `24.19.0`; root `engines.node >=24`; published packages declare `>=22.18.0`.
- Build: `pnpm build` (turbo). `packages/cli` `test` script is `pnpm run build && vitest run` (`packages/cli/package.json:46`).
- `bin.test.ts` does not run the built binary. It imports `main` from `src/main.ts` and runs it in-process with a fake `HostProcess` (`bin.test.ts:8-17, 52-80`). The built binary (`dist/cli.js`) is spawned only by the e2e suite (`packages/cli/e2e/harness.ts:27`, `pnpm --filter @prisma/cli test:e2e`, needs `PRISMA_E2E_SERVICE_TOKEN`). The `prisma` binary is `packages/prisma/dist/prisma.js`, built by `pnpm build`.

## 6. prisma/web

Search at `e262c4d` over `apps/docs/content/docs`. Five places name `prisma-composer.config.ts`, not two:

| File | Line | Text |
| --- | --- | --- |
| `apps/docs/content/docs/composer/getting-started.mdx` | 84 | `├── prisma-composer.config.ts  # deploy config (read only by the CLI)` |
| same | 200-211 | "Next to it goes the deploy config. Only the Composer CLI reads this file; your app code never imports it:" then a ` ```ts title="prisma-composer.config.ts" ` block with `defineConfig({ extensions: [prismaCloud(), nodeBuild()], state: prismaState() })` from `@prisma/composer/config` |
| `apps/docs/content/docs/composer/porting-an-app.mdx` | 67-79 | "Add `nextjsBuild()` ... to the deploy config's `extensions`:" then a ` ```ts title="prisma-composer.config.ts" ` block with `extensions: [prismaCloud(), nodeBuild(), nextjsBuild()]` |
| `apps/docs/content/docs/(index)/prisma-compute/deploy.mdx` | 59, 70-78 | "The **deploy config** next to it is read only by the CLI:" then a ` ```ts title="prisma-composer.config.ts" ` block; line 132 refers back to "the deploy config next to it" |
| `apps/docs/content/docs/(index)/index.mdx` | 169 | Agent prompt step 2: "a `module.ts` that provisions it, and a `prisma-composer.config.ts`." |

No page names `prisma-composer` as a command. Other stale Composer statements found while reading:

- `composer/getting-started.mdx:46` and `composer/deploying.mdx:123-132`: the `effect` pre-flight (`DEPS.EFFECT_VERSION_CONFLICT`, "Before doing anything else, every Composer command verifies ...") that slice 1 deletes. After 0.26.0 a conflicting `effect` gives `CLI.CONFIG_UNREADABLE`. The index agent prompt (`(index)/index.mdx:168`) also tells agents to pin `effect` with an override.
- `cli/configuration.mdx:9, 44`: lists only the `orm` and `skills` sections and says the CLI merges each section key by key from the nearest file. The `composer` section is taken whole from the nearest file.
- `composer/index.mdx:108` and `ai/tools/skills.mdx:124` call Composer's skill `prisma-composer`; the shipped name is `prisma-composer-core-concepts` (as `guides/frameworks/solid-start.mdx:399` shows).
- `cli/deploy.mdx:15, 45`, `composer/deploying.mdx:30`, `composer/getting-started.mdx:284` say "deploy config" without naming the file. Correct if "deploy config" now means the `composer` section.

prisma/web rules:

- `CONTRIBUTING.md`: Conventional Commit type required; scope is the app (`docs`), or empty across apps; commit body must contain a Linear reference (`Linear: TML-3340`); PR title in the same form; PR description says what changed, how it was tested, follow-ups.
- `apps/docs/AGENTS.md`: from `apps/docs` run `pnpm lint:links`; `pnpm lint:versions` after pinning a Prisma package version (every pin must be the package's npm `latest`). `guides/frameworks/solid-start.mdx:399` prints `@prisma/composer 0.25.0`, which goes stale when 0.26.0 is `latest`.
- CI on PRs: `docs-test.yml` (build docs, `pnpm --filter=docs test`, Playwright), `docs-prose.yml` (an AI-signs prose checker over changed `.mdx`), `spellcheck.yml`, `links.yml`, `lychee.yml`.

## 7. TML-3340

Status Backlog, priority Urgent, assignee William Madden, project "Prisma Composer", team Terminal. Created 2026-09-28 09:51, last updated 2026-09-28 09:53. No comments, no relations, no attachments. Nothing has been added since 2026-09-30.

Its "Out of scope" section lists "Removing the standalone `prisma-composer` CLI" and "Moving Composer's configuration from `prisma-composer.config.ts` into `prisma.config.ts`". This project does both, so the closing comment should say the project widened the scope and link PRs #328, #331, the host PR and the web PR. The ticket's "Done when" also asks for a list of commands `prisma` lacks: `destroy` and `log`, which are now `@prisma/composer/control` operations.

## 8. Facts for manual QA against orm-demo

- On the slice 2 branch, `examples/orm-demo/prisma.config.ts` imports `definePrismaConfig` from `prisma/config` and declares `composer: composer({ extensions: [prismaCloud(), nodeBuild()], state: prismaState() })` plus `orm`. Its `package.json` has `deploy` and `destroy` scripts but no `dev` script, and every Composer dependency is `workspace:0.26.0`. To run the host built from prisma-cli against it, copy it out of the workspace and install published 0.26.0 packages, or point its `prisma` dependency at the local host build.
- `prisma deploy` checks credentials before it loads the config. Without `auth login` or `PRISMA_SERVICE_TOKEN` plus `PRISMA_WORKSPACE_ID`, the broken-`effect` copy fails on credentials, not `CLI.CONFIG_UNREADABLE`. `prisma dev` needs no credentials and reaches config evaluation directly.
- `prisma --version` has no config need, so it never reads the config file and exits 0 in a broken tree (`bin.test.ts:441-446` pins this behaviour for `telemetry status`).
