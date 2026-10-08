# System design review: alchemy bin resolution (`fix/alchemy-bin-resolution`, prisma/composer PR #332)

Range: `one-config-file/remove-binary...fix/alchemy-bin-resolution` in the `wip/composer` clone (11 commits). Reviewed as an architect: concepts, ownership, layering and the design record. Mechanism-level issues are in `alchemy-bin-review.md` (F01–F08) and are not repeated here.

## Summary

The PR fixes a real bug with a sound idea: run the `alchemy` that Composer is installed with, not a `.bin` link the app may not have. The implementer also proved the lookup works under pnpm with hoisting off. The design problems are about who owns that lookup and what it is anchored to:

- The lookup lives in `@internal/cli`, which does not declare `alchemy`. It works because the code is inlined into two published packages that do.
- It is anchored at "wherever this copy of the code was inlined", not at the package the generated stack file imports. The two only coincide while every manifest pins the same version.
- The runtime Alchemy runs on, the launch mechanism and the reproduce command are recorded in the guide, the skill and doc comments, but not in the design docs (ADR-0007, deploy-cli.md).

## Architect findings

### D01 (Medium): anchor the lookup at `@prisma/composer`, the package the stack file imports

Location: packages/0-framework/3-tooling/cli/src/run-alchemy.ts lines 5-9 and 67-84; packages/9-public/composer-cli/tsdown.config.ts lines 3-11.

Issue: `@prisma/composer-cli` inlines `@internal/*` (ADR-0028), so it carries its own copy of `run-alchemy.ts`. Under `prisma`, that copy finds the `alchemy` beside `@prisma/composer-cli`. The child then loads the generated stack file, which imports `@prisma/composer/deploy` and `/local-target`, which load the `alchemy` beside `@prisma/composer`. These are the same files only when both manifests pin the same version and the package manager deduplicates them. If the pins ever differ, the child runs one Alchemy CLI against stack code built on another. That gives two `alchemy` module instances in one process, so Effect service tags and the `State` service may not match. The same-version test (D04) guards this invariant only indirectly.

Suggestion: Define the concept as "the Alchemy that runs a stack is the Alchemy that `@prisma/composer` resolves". Then resolve it from `@prisma/composer`'s location: `@prisma/composer-cli` declares `@prisma/composer` and keeps it external, so it can call a function that `@prisma/composer` exports (see D02) and run the result. The two then match by construction, and the version pin becomes a deduplication concern instead of a correctness requirement.

### D02 (Medium): the engine relationship belongs to core, not to the tooling package

Location: packages/0-framework/3-tooling/cli/package.json lines 19-26 (no `alchemy`); packages/0-framework/1-core/core/package.json line 22; packages/0-framework/1-core/core/src/control/deploy.ts lines 3-5; architecture.config.json lines 22-26 and 118-122.

Issue: `@internal/core` declares `alchemy` and imports it on the control plane (`lower`, and now `localState`). `@internal/cli` (framework, tooling layer, control plane) declares no `alchemy` dependency, yet locates the package on disk. That is an undeclared dependency. Dependency-cruiser cannot catch it because it checks imports, not filesystem lookups. In the workspace it works only because `.npmrc` sets `node-linker=hoisted`. ADR-0007 says the framework depends on Alchemy's CLI command surface, so locating that CLI belongs with the package that owns the dependency.

Suggestion: Move `resolveAlchemyEntry` (renamed per D07) into `@internal/core/src/control/`, next to `deploy.ts`, and expose it through an existing control-plane subpath of `@prisma/composer` (for example `/control`), re-exported per ADR-0035. `@internal/cli` keeps composing the command line (`alchemyCommandLine`) and spawning it. At minimum, if it stays put, declare `alchemy` in `@internal/cli/package.json`.

### D03 (Low): a hand-written `node_modules` walk is the pattern ADR-0017 rejected

Location: packages/0-framework/3-tooling/cli/src/run-alchemy.ts lines 23-44; docs/design/90-decisions/ADR-0017-control-plane-loads-through-the-app-config.md lines 56-65 and 136-140.

Issue: ADR-0017 rejects anchoring resolution at a chosen file and building paths by hand: the platform owns resolution, and Yarn Plug'n'Play has no `node_modules` to walk. The case here differs because the framework does declare `alchemy`, so its own location is a valid anchor. But the walk is still a reimplementation of Node's lookup, and the design record does not say why it is acceptable here. (Mechanism: F06 already proposes `import.meta.resolve('alchemy')`.)

Suggestion: Use the platform resolver from the owning module (D02), then go from the resolved file up to the `alchemy` package root to read `bin`. Record the exception in ADR-0007 (D06): the anchor is the owning package and resolution is Node's.

### D04 (Low): one alchemy version, enforced at the repository level

Location: packages/0-framework/3-tooling/cli/src/__tests__/run-alchemy.test.ts lines 72-103; pnpm-workspace.yaml (`catalog:` block); 11 manifests pin `alchemy` 2.0.0-beta.78.

Issue: Removing `alchemy` from `@prisma/composer-cli` is not possible: its inlined core imports `alchemy` (`control/deploy.ts`), so ADR-0028 requires it to declare the dependency. Two declarations are inherent. What needs a single owner is the version. Right now a unit test in `@internal/cli` reads sibling manifests through `../../../../../9-public`, reaching across package boundaries, and covers only 2 of the 11 manifests. The repository already solves this problem for the `prisma` host: a `catalog:` pin plus `scripts/check-cli-engine-pin.mjs`.

Suggestion: Add `alchemy` to the pnpm catalog and reference `catalog:` from every manifest, or extend the existing pin-check script to cover it. Then delete the cross-package manifest test. With D01, a version mismatch would cost disk space but would no longer break a deploy.

### D05 (Medium): which runtime Alchemy runs on is not stated in the design docs

Location: docs/design/10-domains/deploy-cli.md lines 45-55 (§ Runtime) and 101-108 (step 7); packages/0-framework/3-tooling/cli/src/run-alchemy.ts lines 119-143.

Issue: deploy-cli.md § Runtime covers only the `prisma` bin. The design docs never say which runtime starts the Alchemy child. The PR's real rule is "Composer starts Alchemy's launcher with a Node, as its `#!/usr/bin/env node` shebang would; Alchemy's launcher then picks its own runtime". That rule exists only in a doc comment, the guide and the skill. F01 asks whether Node is a requirement. The design answer: Composer cannot make it one without overriding Alchemy's launcher, and nothing shows it needs to. The stated invariant should be that Composer delegates the runtime decision, not that Alchemy runs on Node.

Suggestion: Add a paragraph to deploy-cli.md § Runtime and step 7. It should cover four facts: the child is the declared `bin` of Composer's own `alchemy`, started with Node; under a Bun host, that Node is the first `node` on PATH (`DEPLOY.NODE_MISSING`); the final runtime is Alchemy's launcher's choice; and the invocation table in docs/guides/deploying.md is the user-facing consequence. local-dev.md § Process lifetimes item 1 can link to it instead of repeating it.

### D06 (Medium): ADR-0007's "runnable on its own" promise is now false under pnpm

Location: packages/0-framework/3-tooling/cli/src/operations/execute-deploy-destroy.ts line 481 (`reproduceCommand`); packages/0-framework/3-tooling/cli/src/generate-stack.ts lines 66-72; packages/0-framework/3-tooling/cli/src/dev/generate-dev-stack.ts lines 80-84; docs/design/90-decisions/ADR-0007-deploy-drives-alchemy-through-a-generated-stack-file.md lines 38-44 and 58-60.

Issue: ADR-0007 justifies the generated stack file with one property: a user can run `alchemy deploy <file>` themselves to tell a Composer bug from an Alchemy bug. The failure diagnostic (`reproduceCommand`) and both generated-file headers still tell users to run `alchemy …`. In the layout this PR fixes (pnpm, no direct `alchemy` dependency), there is no `alchemy` on PATH or in `.bin`, so that command fails. This PR resolved the launch command but left the instructions that tell users how to reproduce it.

Suggestion: Build `reproduceCommand` and the headers from the same `AlchemyCommandLine` that was spawned (`<node> <alchemy bin path> deploy … --yes --stage …`), so the instruction matches what actually ran. Amend ADR-0007 with a short addendum: Composer runs the `alchemy` it is installed with, launched as in D05, and the reproduce command is printed from the resolved command line.

### D07 (Low): naming

Location: packages/0-framework/3-tooling/cli/src/run-alchemy.ts lines 46, 71, 86-94 and 138-142; ADR-0044 lines 90-93.

Issue and suggestion:
- `resolveAlchemyEntry`: "entry" already means the app's `module.ts` throughout the pipeline (`entryPath`, `<entry>`). `resolveAlchemyBin` says what is returned.
- `NodeRuntime` describes the host, which may be Bun (`bun: boolean`). `HostRuntime` fits. `nodeExecutable` is accurate.
- `readManifest` is a generic name for a reader that swallows errors. It is file-private, so it is acceptable. `readPackageJson` would be plainer.
- `DEPLOY.NODE_MISSING` and `DEPLOY.ALCHEMY_BIN_MISSING` are also raised by `prisma dev`, which has its own `DEV` namespace. ADR-0044 lists them only under `DEPLOY`. Add a one-line note in ADR-0044 that the converge step is shared by `deploy` and `dev` and uses `DEPLOY` codes. The alternative is a separate namespace for that step, which is a larger change than this PR needs.

### D08 (Low): `localState` is an Alchemy value on a published Composer subpath

Location: packages/0-framework/1-core/core/src/exports/local-target.ts lines 10-14; packages/0-framework/3-tooling/cli/src/dev/generate-dev-stack.ts lines 57 and 74.

Issue: The re-export follows the letter of the exports-entrypoints rule (only re-exports) and ADR-0017 (`/local-target` is a control-plane subpath). But the concept the dev stack needs is Composer's own: "the state store `prisma dev` uses". Instead, `@prisma/composer/local-target` publishes a raw Alchemy value, so an Alchemy upgrade changes Composer's public types. The `@internal` tag is only a comment: nothing in the tsdown config strips internal declarations, so consumers still see `localState`. (F03 covers the import cost.)

Suggestion: Add a Composer-owned function in `@internal/core/src/control/local-target.ts`, for example `devState()`, that returns `localState()`, and re-export that. Alternatively, have `lower()`'s local path supply the state itself, so the stack file names no Alchemy symbol. This keeps the PR's real goal (the stack file never imports `alchemy`) without making Alchemy part of the public surface.

## Items for the code-review pass

- D04's cross-package manifest read (`../../../../../9-public`) is a test-organisation issue in its own right if D04 is not taken.
- The generated-file header tests (generate-dev-stack.test.ts line 60) and operations.test.ts line 581 pin the `alchemy …` reproduce text. They change with D06.

## Verdict

Nothing here blocks the bug fix. D01 and D02 are one change: move the lookup into core and anchor it at `@prisma/composer`. Make that change before more code depends on `run-alchemy.ts`'s location. Do D05 and D06 in this PR, because the PR changes how the child is launched and these update the design docs to match. D03, D04, D07 and D08 can follow.
