# @repo/tsdown

We're solving maintenance burden of lots of similar `tsdown.config.ts` files across many packages that need to be aligned on pretty much everything except for the `entry` property.

Agents could help us align them and make those changes across the codebase, but doing so is usually pretty slow as the agents have to do a bunch of filesystem scans first and waste a bunch of roundtrips to do the job.

We ship `esm` only by default. Bundle target is infered from your package. Output goes to `dist`. We ship DTS files and DTS maps too - so "Go To Definition" jumps to the source files.

## Prerequisites

Your package needs to have:

1. `tsconfig.prod.json` - a TypeScript configuration file specific for bundling.

2. `package.json#engines.node` - `tsdown` infers the bundling target based on this value. e.g. `{ "engines": { "node": ">=24" } }`

3. `"tsdown": "catalog:"` in your packages `devDependencies`.

4. `"build": "tsdown"` in your `package.json#scripts`.

5. `"src"` and `"dist"` in your `package.json#files`.

## Usage

Add `@repo/tsdown` as a workspace devDependency in your package's `package.json`:

```bash
pnpm add -D --workspace @repo/tsdown
```

Or add it manually to `package.json`:

```json
{
  "devDependencies": {
    "@repo/tsdown": "workspace:*"
  }
}
```

### Extending the Base Configuration

For convenience, we provide a drop-in replacement for `defineConfig` that you can import and use in your `tsdown.config.ts` file:

```ts
import { defineConfig } from '@repo/tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/stuff.ts'],
})
```

Alternatively, you can import and use the base configuration object directly:

```ts
import { baseConfig } from '@repo/tsdown'
import { defineConfig } from 'tsdown'

export default defineConfig({
  ...baseConfig,
  entry: ['src/index.ts', 'src/stuff.ts'],
})
```

### Migration from tsup

`tsup` is no longer actively maintained. Migrate a monorepo package by uninstalling `tsup` - `pnpm uninstall tsup`.

Rename `tsup.config.ts` to `tsdown.config.ts` - keep only `entry` property - should probably also transform it into an array of values.

Replace `package.json#scripts.build` value with `"tsdown"`.

Run `pnpm build` at least once for `package.json#exports` and similar to be generated. Don't forget to push those changes!

## Auto-Generated Exports

The base config sets `exports.enabled: 'local-only'`, which means tsdown automatically generates and updates the `exports` field in `package.json` during local builds.

**Do NOT manually write exports entries.** Instead:

1. Define entry points in `tsdown.config.ts` under the `entry` array
2. Run `pnpm build` to generate the exports
3. Commit the updated `package.json`

The `customExports` function in the base config strips `exports/` prefixes from entry paths, so `src/exports/types.ts` becomes the export `./types`.

If you need to add a new export, add the entry file to `tsdown.config.ts` and rebuild.

### Export convention (required)

Use this decision tree for package migrations and new packages:

1. Prefer base config auto-exports (`exports.enabled: 'local-only'`).
2. Model public subpaths with `entry` values, usually under `src/exports/*`.
3. Commit generated `package.json#exports` after `pnpm build`.

### Allowed exceptions

Only disable exports generation (`exports: { enabled: false }`) when at least one of these applies:

- You must keep non-code exports that tsdown cannot infer from `entry` (for example JSON schema assets).
- You must preserve a legacy root export shape that cannot be represented via `entry` + shared `customExports` without changing runtime semantics.
- You must emit a custom dist layout that intentionally diverges from the base mapping behavior.

When using an exception:

- Keep the exception local to that package only.
- Add a short comment in `tsdown.config.ts` explaining why it cannot use auto-exports.
- Keep `package.json#exports` minimal and explicit.

## A package's published module base

A package that names its own modules, for example in the config its `defineConfig` returns, reads its published module base from the global `__PRISMA_PUBLISHED_MODULE_BASE__` and appends the subpath. The module base is the published package's name plus the entry the package is published under in `packages/0-shared/publish-surface/src/shells.ts`: `@prisma/orm-postgres` for `@internal/postgres`, which has no entry, and `@prisma/orm-postgres-contrib/citext` for `@internal/extension-citext`. The shell build (`@repo/tsdown/shell-build`) derives it from that table. Nothing else defines it, so the package falls back to its workspace name when its own build or its source runs inside this repository:

```ts
declare const __PRISMA_PUBLISHED_MODULE_BASE__: string | undefined;

export const moduleBase =
  typeof __PRISMA_PUBLISHED_MODULE_BASE__ === 'string'
    ? __PRISMA_PUBLISHED_MODULE_BASE__
    : '@internal/postgres';
```

Write this check in each package's own source, never in a helper from another package. The shell build defines the constant only in the code it bundles into that shell, and a helper owned by another shell is bundled into that other shell, so it would return that shell's module base for every package that calls it.

The shell build defines the constant only for a shell that bundles exactly one internal package, because one global cannot hold a different value for each package. A package in a shell that bundles several cannot use this pattern.

The workspace build must not define it. The shell build bundles the workspace build's `dist`, so a value substituted there could not be replaced with the published one. See `packages/3-targets/postgres/9-facade/src/config/module-base.ts`.

Two cases in `all-shells-tarball.test.ts` in `@prisma/orm-framework` check this on every pull request. One fails when the identifier is left in any published package's built code. The other loads each published target package's `defineConfig` and fails unless the modules it names are exports of that package.
