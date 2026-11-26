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

An extension's own `package.json` also has to list Prisma's packages correctly. List every `@prisma/orm-*` package that your shipped code uses as a peer dependency, and again as a development dependency for your own build and tests. A package that only your tests use is a development dependency alone. None is an ordinary dependency.

Why peer dependencies:

- **Listed as a peer dependency,** a version your extension does not accept is reported when the application installs. npm refuses the install. pnpm, Yarn and Bun install and print a peer dependency warning, so read the warnings: a successful install does not prove that the versions match.
- **Listed as an ordinary dependency,** the application would get a second copy of Prisma ORM, and the two copies do not accept each other's values.
- **A monorepo is the exception.** If its applications are on different Prisma releases, it can still get two copies under npm workspaces and under Bun's hoisted linker. Keep such applications on one release, or use pnpm, Yarn or Bun's isolated linker.

Until release 8.0, list each `@prisma/orm-*` package at one exact `8.0.0-rc.N`. The [exact-pin rule](../../../skills/prisma-8/references/upgrade-extension.md#exact-pin-rule) says why.

From release 8.0, list ranges:

- **A caret on a GA package,** such as `^8.1.0`, from the first release your extension works with. Your extension then keeps working when an application moves to a later release.
- **A tilde on a package below GA,** such as `~8.1.0-preview.0`. It may change in the next release.
- **At release 8.0, write `^8.0.1` and `~8.0.1-ea.0`.** Every Prisma package starts release 8.0 at patch 1. Never write `8.0.0` in a range on our packages: `~8.0.0-ea.0` would accept the old `8.0.0-rc.N` release candidates, because `rc` sorts after `ea`.

For your own package's version, we recommend the major and minor of the first Prisma release it works with, and your own patch number. The [extension-upgrade skill](../../../skills/prisma-8/references/upgrade-extension.md#from-release-80-number-your-package-and-declare-ranges) has the details.

`prisma-8-check-pins` does not check the `@prisma/orm-*` entries. The one-line check in step 3 of the [extension-upgrade skill's per-step flow](../../../skills/prisma-8/references/upgrade-extension.md#per-step-flow) does.

Run from the extension's repository root:

```bash
pnpm exec prisma-8-check-pins
```

Exit code is `0` if every `@internal/*` peerDep is exact, non-zero otherwise. Suitable for use in a GitHub Actions `run:` step, a pre-commit hook, or `package.json` `scripts.lint`.

## Source location

`packages/0-shared/extension-author-tools/`
