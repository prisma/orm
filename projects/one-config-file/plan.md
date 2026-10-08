# Plan: one config file for Composer

**Spec:** [`spec.md`](./spec.md). **Design:** [`design-notes.md`](./design-notes.md).

Three slices in one stack. Each is one PR in the repository named. Slice specs and plans are written under `slices/` when the slice is picked up.

## Slice 1 — The `composer` section holds Composer's configuration (prisma/composer)

**Outcome.** Composer's whole configuration lives in the `composer` section of `prisma.config.ts`, shaped like the ORM section. Composer's own loader, the walk-up discovery, the `configPath` field, the c12 dependency of the cli package and the `effect` pre-flight are gone. The old file and the old field are refused with diagnostics that show the section to write. All ten examples, the integration test project and the website config carry the section and have no `prisma-composer.config.ts`. The standalone binary still builds and runs on the new section so the tree is releasable at every commit. A new Composer ADR records the decision and ADR-0017 names `prisma.config.ts`. Guard tests of the control-plane boundary pass.

**Builds on.** Nothing.

**Hands to.** Slice 2: a family whose section is the configuration, and examples that only need their scripts changed. Slice 3: a published dev build of `@prisma/composer-cli` whose family reads the section.

**Verified by.** Composer's unit tests for the section validator, the two legacy diagnostics, and the deploy and dev pipelines reading the section; the existing static-graph and control-import checks; the published-tarball resolution script with its adversarial shape reworked to assert that importing Alchemy from a broken tree throws.

## Slice 2 — The `prisma-composer` binary and its name are gone (prisma/composer)

**Outcome.** `@prisma/composer-cli` declares no `bin`. `bin.ts`, `cli.ts`, `family/engine-cli.ts`, the pass-through `orm` section family and everything only they used are deleted. The stale comments saying `@prisma/composer` ships the CLI are gone. Every guide, the README, the example READMEs and package scripts, and the shipped skill name `prisma` commands only, and only ones the released `prisma` binary has. A CI check fails on `prisma-composer` as a command or config-file name in those files. The root version advances so the merge publishes a release.

**Builds on.** Slice 1.

**Hands to.** Slice 3: a released `@prisma/composer-cli` with no binary and a family that reads the section.

**Verified by.** The packed tarballs; the CI check failing on a planted mention and passing on `main`; the existing engine-pin check still passing.

## Slice 3 — The host proves the end state (prisma/prisma-cli, prisma/web, this repo)

**Outcome.** The `prisma` host pins the released `@prisma/composer-cli`. Its tests that exercised the `configPath` fixture now exercise a real `composer` section. Run from the host binary against the migrated orm-demo example: `prisma deploy` and `prisma dev` work; the legacy file and legacy field cases give Composer's diagnostics; the `effect@4.0.0-rc.118` case gives `CLI.CONFIG_UNREADABLE` with exit code 2 while `prisma --version` still exits 0. The two prisma/web pages that name the old config file are fixed. TML-3340 is closed with a comment linking the PRs.

**Builds on.** Slice 2.

**Hands to.** Close-out.

**Verified by.** The host's test suite; the manual QA transcript recorded in the slice folder and summarised in the PR.

## Sequencing

One stack: 1 → 2 → 3. Slice 2 cannot start before slice 1 merges because the binary it deletes must keep working until then, and slice 3 needs slice 2's release to pin. The prisma/web fix in slice 3 could land any time after slice 1 merges, and is folded into slice 3 only to keep the slice count low.

## Tracking

TML-3340 is the only ticket, and it tracks the docs and skill outcome of slice 2 and the web fix of slice 3. No further Linear issues are created unless Will asks; Composer work is tracked in the "Prisma Composer" Linear project.

## Close-out (required)

- [ ] Verify every item of the project Definition of Done in `spec.md`.
- [ ] The Composer ADR is merged and ADR-0017 amended (slice 1).
- [ ] Final retro run; lessons landed in `drive/` calibration files where they generalise.
- [ ] Strip repo-wide references to `projects/one-config-file/**`.
- [ ] Delete `projects/one-config-file/`.
