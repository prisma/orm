# @internal/extension-author-tools

CLI tools that pair with the extension-upgrade branch of the [`prisma-8`](../../../skills/prisma-8/references/upgrade-extension.md) agent skill. Today this package ships one tool; future tools for extension authors using the upgrade-skill flow will land here.

The agent-readable upgrade procedure itself (the flow in [`references/upgrade-extension.md`](../../../skills/prisma-8/references/upgrade-extension.md) and the `upgrades/<from>-to-<to>/instructions.md` set under [`upgrading/extension/`](../../../skills/prisma-8/upgrading/extension/)) ships inside the `@prisma/orm-*` tarballs. This package is the npm-published companion that supplies the CI bin the skill drives.

A package that adds a database target follows [`references/build-a-target-package.md`](../../../skills/prisma-8/references/build-a-target-package.md) in the same skill: the modules its `defineConfig` names for generated files, and the `init` entrypoint `prisma orm init` loads.

## Installation

```bash
pnpm add -D @internal/extension-author-tools
# or:
npm install --save-dev @internal/extension-author-tools
```

## Tools

### `prisma-8-check-pins`

CI guard for extension packages. Asserts that every `@internal/*` entry under the package's `peerDependencies` (and, optionally, `dependencies`) is pinned to an exact version, not a range.

This is the invariant the [extension-upgrade flow](../../../skills/prisma-8/references/upgrade-extension.md) relies on at upgrade time: extension authors pin every `@internal/*` peer to a single exact version per release of their extension, so the skill can mechanically advance both the framework deps and the extension's published version in lockstep.

One version matters beyond the upgrade flow. Until `8.0.0`, an extension names every `@prisma/orm-*` package it uses as a peer dependency at that version, and again as a development dependency for its own build and tests; none is an ordinary dependency. An application on another version then gets a mismatch reported at install, instead of a second copy of Prisma ORM whose values the first copy does not recognise. A monorepo whose applications are on different Prisma versions can still get two copies under npm workspaces and Bun's hoisted linker; keep such applications on one version, or use pnpm, Yarn or Bun's isolated linker. The [exact-pin rule](../../../skills/prisma-8/references/upgrade-extension.md#exact-pin-rule) says why.

From `8.0.0` the exact version is replaced by ranges: an extension maintained outside this repository takes the major and minor of the first release of ours it works with, with its own patch number, and declares a caret range such as `^8.1.0` on our packages. The [extension-upgrade skill](../../../skills/prisma-8/references/upgrade-extension.md#from-800-number-your-package-and-declare-ranges) describes it.

`prisma-8-check-pins` does not check the `@prisma/orm-*` entries. The one-line check in step 3 of the [extension-upgrade skill's per-step flow](../../../skills/prisma-8/references/upgrade-extension.md#per-step-flow) does.

Run from the extension's repository root:

```bash
pnpm exec prisma-8-check-pins
```

Exit code is `0` if every `@internal/*` peerDep is exact, non-zero otherwise. Suitable for use in a GitHub Actions `run:` step, a pre-commit hook, or `package.json` `scripts.lint`.

## Source location

`packages/0-shared/extension-author-tools/`
