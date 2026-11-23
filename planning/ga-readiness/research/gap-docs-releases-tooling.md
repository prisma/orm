# Gap check: behaviour changes, reference documentation, release notes, upgrade tooling, releases, applying the policy

- Rules checked: 31. True today: 1. Partly true: 9. Not true: 12. Nothing to check: 9.
- Not true, and no plan task covers it (1 of 7): the command-line tool does not stop when its major differs from the library's (4.3).
- Not true, no plan task (2 to 4 of 7): no reference documentation is designated as the specification (8); none ships inside the packages as Markdown (8); the agent skill restates behaviour instead of referring to a reference (8).
- Not true, no plan task (5 to 7 of 7): release notes do not give each change its class (9); no statement that the previous major gets 12 months of critical and security fixes (11); no pull request step where the author states the class and the reviewer checks it (12).
- Not true but covered by a plan task: the deterministic upgrade tool, its handling of changes that need a decision, and its use at a new major (task 9); the exported-API comparison with the last release (task 5).

Checked on 2026-11-23 against this worktree (`8.0.0-rc.24`) and the clones under `wip/repos/` (web at d3d5cc7, prisma-cli at 6914c1d, composer at 8fd4fc3, pdp-control-plane at bf66c51). Nothing was built or run except `scripts/list-error-codes.mjs`.

## 4.3 Sibling products, and the command-line tool and library having the same major

### "Our own products that build on the ORM, such as Composer, the `prisma` command-line tool and the control plane, follow the same rules as any user. They use only what is covered and get no special access." (4.3)

Status: partly true.

Evidence:
- No sibling imports a path containing `internal`, and none imports an `@internal/*` ORM workspace package. The `@internal/*` names in `wip/repos/composer` (`foundation`, `streams`, `dev-emulators`) are Composer's own workspace packages.
- `wip/repos/prisma-cli` imports one path, `@prisma/orm-toolchain/cli` (`packages/cli/src/cli.ts:11`), and mounts the ORM commands from it.
- Composer imports, beyond what an application imports from the facade: `@prisma/orm-toolchain/migration-tools/spaces`, `/io`, `/refs`, `/hash`, `/config-loader`, `/cli`, and `@prisma/orm-postgres/control`, `/family/control`, `/family-contract/canonicalization-hooks`.
- pdp-control-plane imports from the family package directly (`@prisma/orm-family-sql/orm-client`, `/errors`, `/runtime`, `/relational-core`, `/builder/types`, for example in `packages/database/pn.ts`) and `@prisma/orm-toolchain/cli/control-api` in tests. As an application it should reach these through the facade.
- What is "covered" is not yet defined, so whether these paths are covered cannot be decided today. The toolchain's `./cli`, `./cli/control-api` and `./migration-tools/*` entrypoints (`packages/9-public/@prisma/orm-toolchain/package.json:65-80`) exist mainly for these products.

Work needed: decide which of the entrypoints the siblings use are covered, and move each sibling off any that are not. Plan: task 3 (reduce exports) and task 8 (rename `internal` paths) cover the ORM side; no task covers changing the siblings' imports.

### "The command-line tool and the library in one project have the same major version. When they do not, the tool stops and says so." (4.3)

Status: not true.

Evidence:
- The `prisma` CLI bundles its own copy of the ORM toolchain, pinned exactly (`wip/repos/prisma-cli/packages/cli/package.json:56`, `"@prisma/orm-toolchain": "8.0.0-rc.24"`), and imports it statically (`packages/cli/src/cli.ts:11`). It runs that copy against whatever facade the project installed, which `prisma.config.ts` imports.
- The CLI reads the project's installed library version only to sync skills (`packages/cli/src/lib/skills/resolve.ts:28`, `status.ts:244`). It does not compare majors.
- The ORM's config loader checks a config format marker, `$prismaConfig === 1` (`packages/1-framework/3-tooling/config-loader/src/load.ts:302-310`), not a library version. No error code for a version mismatch exists in `docs/reference/error-reference.md`.
- The CLI's own version number is on a separate counter (`wip/repos/prisma-cli/package.json`: `8.0.0-rc.34`, against the ORM's `8.0.0-rc.24`).

Work needed: the CLI (or the toolchain it mounts) reads the installed facade's version, compares majors, and stops with a structured error when they differ. Plan: no task.

### "The release candidates force anything that depends on the ORM to pin an exact version. That requirement ends at `8.0.0`." (4.3)

Status: partly true.

Evidence:
- The first half is true. Our packages depend on each other at exact versions, enforced unconditionally at publish (`scripts/check-publish-deps.mjs:68`, `findPnPinViolations` at line 127). Extension packages peer-depend on their target at the exact version (for example `packages/9-public/@prisma/orm-extension-pgvector/package.json:35`). Composer enforces its pin with `scripts/check-orm-pins.mjs`; the CLI and pdp-control-plane pin exactly.
- Nothing ends at `8.0.0`. The exact-pin check does not depend on the version line. `docs/oss/versioning.md` (section "Lockstep across the workspace") tells extension authors to pin exactly with no end date. The app upgrade reference treats each extension's exact pin as the highest version an application may reach (`skills/prisma-8/references/upgrade-app.md`, "Pre-flight").

Work needed: decide which pins relax at `8.0.0` (our packages' peer ranges on each other, third-party extensions' ranges), change the publish check and the docs to match, and drop the pin pre-flight from the upgrade reference. Plan: no task.

## 5.2 Changes to existing behaviour

### "Every change to existing behaviour belongs to one of four classes." (5.2)

Status: nothing to check. It defines the classes. Whether changes are labelled with them is checked under sections 9 and 12 below.

### "Fix to behaviour that was wrong ... Permitted in a minor or patch: Yes." (5.2)

Status: nothing to check. It is a permission.

### "Change to specified behaviour ... No. Only in a new major, or as a new API the user adopts explicitly." (5.2)

Status: partly true.

Evidence:
- Nothing checks this today, and the release candidates may change anything (`CONTRIBUTING.md:9`, `docs/oss/versioning.md` "Release candidates").
- The release script cannot produce a new major. `computeNextReleaseVersion` (`scripts/determine-version-utils.ts:51`) moves `8.0.0-rc.N` to `rc.N+1` and a stable version to the next minor. It cannot produce `8.0.0` or `9.0.0`. `RC_BASE_PATTERN` (line 13) accepts only `8.0.0-rc.N`.

Work needed: the version script gains a way to cut `8.0.0` and a later major. Enforcing the rule itself falls to the review step and API check in section 12. Plan: no task for the version script; task 5 covers part of the enforcement.

### "Change to unspecified detail ... Permitted: Yes." (5.2)

Status: nothing to check. It is a permission.

### "Security fix: Yes, with a published notice, even when it changes specified behaviour." (5.2)

Status: partly true.

Evidence:
- `SECURITY.md:66-68` says an advisory is published through GitHub Security Advisories when a fix lands. `SECURITY.md:52` reserves the right to make breaking changes for a security fix during the release candidates.
- The release notes have no security section (`docs/releases/README.md:25-29`: Breaking changes, Features, Fixes, New contributors), so a security fix is not marked as one there.
- `SECURITY.md:31` still names `@internal/*` packages as the published scope, and line 54 says the section will be revised at `8.0.0`.

Work needed: state in `SECURITY.md` that every security fix gets a published notice, and give security fixes their own marking in the release notes. Plan: no task.

### "An application that depended on a bug, on unspecified detail, on behaviour a security fix removed, or on a version ... whose maker has ended support for it ... may need changes after an upgrade. These are the only exceptions." (5.2)

Status: nothing to check. It lists exceptions.

## 5.3 Rejecting input that was previously accepted

### "A release may reject input that an earlier release accepted, when the reference never specified that input as accepted." (5.3)

Status: nothing to check. It is a permission.

### "It warns in an earlier release before it fails, where that is possible." (5.3)

Status: partly true.

Evidence:
- A mechanism exists for one kind of input. A PSL type constructor can carry `deprecated: { replacement }` (`packages/1-framework/1-core/framework-components/src/shared/framework-authoring.ts:91`). The PSL interpreter warns where one is written, and the language server tags it (`packages/1-framework/3-tooling/language-server/src/completion-scope.ts:107-110`). Postgres, SQLite and MongoDB use it for renamed scalar types (`packages/3-targets/postgres/1-target/src/core/type-constructors.ts:332-341`).
- There is no general way for other inputs (config, CLI flags, TypeScript builder calls) to warn first, and no rule or review question asks for it. The TypeScript side has three `@deprecated` tags in all of `packages/`.

Work needed: a way to warn in config, CLI and builder input as PSL can, and a review question that asks for a warning release before a new rejection. Plan: no task.

### "It fails at compile time or emit time in preference to run time." (5.3)

Status: partly true.

Evidence: most input is already checked before run time: PSL diagnostics at emit, config validation in the config loader (`CONFIG.VALIDATION_FAILED` in `docs/reference/error-reference.md`), and typed builder APIs. No rule or review question asks for it on a new rejection.

Work needed: add it to the review step in section 12. Plan: no task.

### "It is listed in the release notes." (5.3)

Status: partly true.

Evidence: the release-notes skill always includes anything marked breaking and anything touching error codes, config fields, CLI flags or file formats (`skills-contrib/draft-release-notes/SKILL.md:96-113`). A new rejection that is classed as a fix can still be dropped, because excluded pull requests are "dropped silently" (line 113) and no category is named for it.

Work needed: make a new rejection of input a case the notes always include. Plan: no task.

### "Rejecting input that the reference specifies as accepted is a change to specified behaviour." (5.3)

Status: nothing to check. It is a definition.

## 8 Reference documentation

### "The reference documentation is the specification. It alone determines what is specified." (8)

Status: not true.

Evidence:
- Nothing is designated as the reference, and nothing says that only the reference defines behaviour. Behaviour is described across guides in prisma/web, the CLI README (`packages/1-framework/3-tooling/cli/README.md`, 1,661 lines), the error reference, the decision records and the agent skill.
- `docs/commands/README.md` calls the CLI README "the canonical, always-up-to-date command documentation", while the hosted CLI pages are hand-written separately in `wip/repos/web/apps/docs/content/docs/cli/`.

Work needed: name the reference documentation for each surface and say on it, and in the guides, that only it defines specified behaviour. Plan: no task.

### "It is generated from the code or stored beside it." (8)

Status: partly true.

Evidence:
- Error codes: stored beside the code in `docs/reference/error-reference.md` (hand-written). CI checks it lists every code in production source (`.github/workflows/ci.yml:134-135`, `pnpm check:error-reference`). The hosted page is generated from it at a release tag (`wip/repos/web/apps/docs/content/docs/orm/reference/error-reference.mdx`, header comment; `wip/repos/web/.github/workflows/error-reference-check.yml`).
- CLI commands: `--help` text is generated from the command definitions (`packages/1-framework/3-tooling/cli/src/orm/family.ts:35-58`). The CLI README is beside the code. The hosted pages are hand-written in another repository.
- Config options: the hosted page `wip/repos/web/apps/docs/content/docs/cli/configuration.mdx` is hand-written in another repository.
- Exports: no generated reference. Some declarations carry doc comments, which ship in the `.d.mts` files. No TypeDoc or API Extractor setup exists.
- File formats: described only in guides in another repository (for example `orm/contract-authoring/the-contract-artifact.mdx`). No JSON Schema or format reference for `contract.json`, migration files or ref files is in the repository.

Work needed: produce the reference for exports, commands, config options and file formats in this repository, generated where possible. Plan: no task.

### "It ships inside each package as Markdown, so it matches the installed version." (8)

Status: not true.

Evidence: each published package ships `dist` plus a short README (21 to 130 lines; `packages/9-public/@prisma/*/README.md`). The five facades also ship the agent skill (`"files": ["dist", "skills"]`, copied in by `scripts/sync-package-skills.ts`). The error reference is not shipped; `@prisma/orm-toolchain` ships only `dist`.

Work needed: copy the reference Markdown into each package at pack time, as the skill already is. Plan: no task.

### "Where it is silent, behaviour is unspecified." (8)

Status: nothing to check. It is a definition.

### "Guides, the agent skill and the test suite do not define specified behaviour. The agent skill refers to the reference and does not restate it." (8)

Status: not true.

Evidence: the skill (`skills/prisma-8/SKILL.md` and `references/`, about 4,900 lines) restates behaviour in detail. For example `references/debug.md:44-58` restates the error namespaces, exit codes and several error payloads, while naming `docs/reference/error-reference.md` as the full list. The pull request template asks for a skill update on any user-facing change (`.github/PULL_REQUEST_TEMPLATE.md`, "Skill update"), which keeps the restated copy alive.

Work needed: rewrite the skill to link to the reference for facts, and change the pull request template's skill question to match. Plan: no task.

### "It covers every export of a GA or Preview package, every CLI command, config option, error code and file format." (8)

Status: partly true.

Evidence:
- Error codes: complete. `node scripts/list-error-codes.mjs --verify docs/reference/error-reference.md` reports all 423 codes listed.
- CLI commands: 23 ORM commands (`packages/1-framework/3-tooling/cli/src/orm/family.ts:35-58`). The hosted docs have no page for `contract format`, `lsp`, `migration check`, `migration graph`, `migration list` or `migration log`; `cli/index.mdx:119` says some have "no page of their own yet". Nothing checks coverage.
- Config options: the configuration page does not mention `contract.typesModule`, `adapter` or `driver`, which the config loader validates. Nothing checks coverage.
- Exports: about 1,050 entrypoints; no reference. The committed `exports` maps in `packages/9-public/@prisma/*/package.json` are the only list.
- File formats: no field-level reference for `contract.json`, migration files, contract snapshots, ref files, the marker or the ledger.

Work needed: write the missing reference, and add completeness checks like the error-code one for commands, config options and exports. Plan: no task. Task 3 reduces the number of exports to document.

## 9 Release notes

### "Every release lists each change to behaviour with its class from section 5.2." (9)

Status: not true.

Evidence:
- Notes are hand-curated per release in `docs/releases/v<version>.md`; CI and the publish workflow check only that the file exists (`scripts/check-release-notes.mjs`; `.github/workflows/ci.yml:139`; `.github/workflows/publish.yml`, "Check release notes").
- The sections are Breaking changes, Features, Fixes and New contributors (`docs/releases/README.md:25-29`; `docs/releases/v8.0.0-rc.24.md` headings at lines 7, 60, 73). These are not the four classes: there is no change to unspecified detail and no security fix.
- Not every change is listed: the skill drops "default-exclude" pull requests silently (`skills-contrib/draft-release-notes/SKILL.md:96-113`).

Work needed: change the notes template, the skill and the release-notes check so every behaviour change appears under one of the four classes, taken from the class the author stated (section 12). Plan: no task.

## 10 Upgrade tooling

### "Where an upgrade requires a change, a deterministic tool makes it, such as a CLI command or a codemod that produces the same result on every run." (10)

Status: not true.

Evidence:
- Upgrade instructions are Markdown for an agent. Pull requests add fragments under `upgrade-instructions/pending/<name>/<app|extension>/instructions.md`; a release merges them into `skills/prisma-8/upgrading/<audience>/upgrades/<from>-to-<to>/instructions.md` (`upgrade-instructions/README.md`). The agent applies them by following `skills/prisma-8/references/upgrade-app.md`.
- Of 1,033 change entries in the published guides, 46 have a script. Of 109 entries in the 42 pending fragments (64 audience files), none has a script. `scripts/codemods/` holds two codemods.
- No command applies an upgrade. Neither the ORM toolchain nor `wip/repos/prisma-cli` has an upgrade or codemod command.
- `pnpm check:upgrade-coverage` (`.github/workflows/ci.yml:133`) checks that a declaration exists for changes to `examples/`, extensions and facades, not that a tool makes the change.

Work needed: the upgrade tool. Plan: task 9.

### "An upgrade guide applied by an agent does not meet this requirement." (10)

Status: nothing to check. It clarifies the rule above; today's only mechanism is such a guide, as shown there.

### "Where the correct edit depends on what the user meant, the tool finds every affected location, changes none, and reports what must be decided. ... once the user records a decision, the tool makes the edit deterministically." (10)

Status: not true.

Evidence: change entries carry a `detection` block with a file glob and regular expressions (for example `upgrade-instructions/pending/config-type-renamed/*/instructions.md`). Nothing runs these patterns except an agent reading the guide. No mechanism records a user's decision or applies an edit from it.

Work needed: part of the upgrade tool. Plan: task 9.

### "This applies within a major, for the exceptions in section 5.2, and to the move to a new major, including carrying migrations forward." (10)

Status: not true.

Evidence: no tool exists for any of these cases (see above). Nothing exists for carrying migrations across a major.

Work needed: the upgrade tool's scope includes the 5.2 exceptions and the move to a new major, including migrations. Plan: task 9 in part. Its text names per-release upgrades and does not mention a new major or migrations.

## 11 Releases and how long they are supported

### "We aim for one new major a year. This is an aim, not a limit." (11)

Status: nothing to check.

### "Within the current major, fixes go to the latest minor release only." (11)

Status: true today.

Evidence: `docs/oss/versioning.md:100-102` says patches "only apply to the current minor; older minors are not maintained", and line 117 says there is no tooling for older Prisma 8 releases. Every release publishes from `main` (`.github/workflows/publish.yml`). A patch to the current minor is made with `scripts/set-version.ts` (`docs/oss/versioning.md:105`).

### "When a new major is released, the previous major receives critical and security fixes for 12 more months." (11)

Status: not true.

Evidence:
- No document states this for Prisma 8. `SECURITY.md:40-54` and `docs/oss/versioning.md:9` say the Prisma 8 period is not yet announced.
- The stated period for Prisma 7 is different: bug fixes and security fixes for 18 months after `8.0.0` (`docs/oss/versioning.md:10`, `SECURITY.md:45`, `wip/repos/web/apps/docs/content/docs/orm/release-status.mdx:19-21`). Prisma 6 received security fixes for 12 months after Prisma 7 (`release-status.mdx:25`).

Work needed: state the 12-month rule for Prisma 8 in `SECURITY.md`, `docs/oss/versioning.md` and the release-status page. Plan: no task.

## 12 How the policy is applied to a change

### "The author of a change states its class from section 5.2. The reviewer checks it." (12)

Status: not true.

Evidence: the pull request template (`.github/PULL_REQUEST_TEMPLATE.md`) asks for a linked issue, summary, testing, a skill update and a checklist. It does not ask for a class. The `create-pr` and `triage-contributor-pr` skills and `docs/oss/pr-triage.md` do not ask for one either. The nearest step is the upgrade-instruction declaration that `pnpm check:upgrade-coverage` requires for changes to `examples/`, extensions and facades; it records upgrade steps, not a class.

Work needed: add the class to the pull request template and the review skills, and have a check reject a pull request without one. Plan: no task.

### "An automated check compares each package's exported API with the last release. It fails on a removal or an incompatible change to anything GA." (12)

Status: not true.

Evidence: no API report files are committed (no `*.api.md` or API Extractor configuration). No script compares exports with a published release. `pnpm check:error-reference` checks only that every code in source is listed; it does not notice a code that was removed. The committed `exports` maps show added or removed entrypoint paths in a diff, but not names or types, and nothing fails on them.

Work needed: the API comparison check. Plan: task 5.

### "It also reports every added API, and an addition is merged only when the reviewer approves it as intended." (12)

Status: not true.

Evidence: as above; nothing reports additions.

Work needed: part of the API comparison check. Plan: task 5.
