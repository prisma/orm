# @internal/extension-author-tools

CLI tools that pair with the extension-upgrade branch of the [`prisma-8`](../../../skills/prisma-8/references/upgrade-extension.md) agent skill. Today this package ships one tool; future tools for extension authors using the upgrade-skill flow will land here.

The agent-readable upgrade procedure itself (the flow in [`references/upgrade-extension.md`](../../../skills/prisma-8/references/upgrade-extension.md) and the `upgrades/<from>-to-<to>/instructions.md` set under [`upgrading/extension/`](../../../skills/prisma-8/upgrading/extension/)) ships inside the `@prisma/orm-*` tarballs. This package is the npm-published companion that supplies the CI bin the skill drives.

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

Run from the extension's repository root:

```bash
pnpm exec prisma-8-check-pins
```

Exit code is `0` if every `@internal/*` peerDep is exact, non-zero otherwise. Suitable for use in a GitHub Actions `run:` step, a pre-commit hook, or `package.json` `scripts.lint`.

## Source location

`packages/0-shared/extension-author-tools/`
