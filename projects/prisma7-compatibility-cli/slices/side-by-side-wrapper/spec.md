# Slice: side-by-side-wrapper

_(Parent project `projects/prisma7-compatibility-cli/`. This slice establishes the runnable compatibility distribution that later identity and release work complete.)_

## At a glance

Add an unpublished `prisma7` workspace package that resolves and runs its exact `prisma` dependency through a `prisma7` binary, while forwarding the matching root and `prisma7/config` package APIs. The existing Prisma CLI gains the smallest immutable distribution-identity seam needed for that wrapper, with ordinary `prisma` remaining the default.

## Chosen design

`prisma@7` remains the only full CLI implementation. The wrapper owns no copied CLI bundles, engines, Wasm assets, command implementations, or preinstall logic.

```text
prisma7/build/prisma7.js
  └─ require("prisma/build/index.js")
       ├─ complete     → nested Prisma 7 completion bundle
       └─ other args   → nested Prisma 7 CLI bundle
```

The wrapper's bin target has the distinctive filename `prisma7.js`. Each separately bundled CLI consumer derives an immutable identity from the normalized stem of `process.argv[1]`: `prisma7` selects the compatibility identity and every other value defaults to the existing `prisma` identity. This handles package managers that expose either the shim path (`.../.bin/prisma7`) or the real target (`.../build/prisma7.js`) without environment markers, global symbols, package metadata lookup, or physical dependency-path parsing.

The wrapper declares `prisma` with workspace exact-version semantics so its packed manifest names the identical published version without a floating range. Runtime resolution always begins from the wrapper's declared dependency edge (`require`/`require.resolve`), never from a constructed `node_modules` path.

The wrapper mirrors Prisma's supported package API shape through forwarding modules:

```text
prisma7                 → matching public root/type surface from prisma@7
prisma7/config          → matching config runtime and types from prisma@7/config
prisma7/package.json    → wrapper metadata
```

This slice makes identity transport and the wrapper executable real, but deliberately leaves the exhaustive replacement of command/help/generated-output references to `identity-complete-prisma7`. The package remains unpublished.

## Coherence rationale

Identity transport and the first consuming wrapper form one rollback unit: either alone is preparation or non-functional, while together they produce a directly testable side-by-side executable and package API that one reviewer can evaluate as a single packaging boundary.

## Scope

**In:** Immutable CLI distribution identity inferred from the normalized executed-script stem; a distinct `prisma7.js` wrapper target; a new `prisma7` workspace package; its binary build, exact Prisma dependency, files/exports/types/config forwarding, and package-level tests; focused packed-install checks proving the wrapper resolves Prisma 7 while a direct root `prisma` remains a different version; regression coverage for the default Prisma identity.

**Out:** Exhaustive identity propagation through all command help, warnings, initialization templates, completion text, update handling, and snapshots; update-prompt suppression; publish graph/order/recovery and release workflow integration; release-channel policy; hiding nested dependency paths; automatic reconciliation of v7/v8 project files.

## Pre-investigated edge cases

| Edge case                                                                              | Disposition          | Notes                                                                                                                                 |
| -------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| A direct root `prisma@8` conflicts with the wrapper's exact `prisma@7` dependency      | Supported            | npm, pnpm, Yarn node-modules/PnP, and Bun probes all preserved the root v8 command and resolved v7 from the wrapper edge.             |
| Installing only `prisma7` under a hoisting linker exposes a top-level `prisma` command | Accepted             | npm, Yarn node-modules, and Bun hoisted the v7 dependency; preventing this is a project non-goal.                                     |
| Package managers expose either a shim path or the real target in `process.argv[1]`     | Supported by design  | npm, pnpm, Yarn node-modules/PnP, Bun, scripts, exec commands, direct Node execution, and npm global installs normalize to `prisma7`. |
| A custom renamed symlink or another script programmatically requires the bin           | Defaults to `prisma` | Caller-defined entrypoints no longer identify the `prisma7` distribution and are outside the supported binary-invocation contract.    |
| Completion dispatch loads a different bundle from normal CLI execution                 | Supported            | Both branches derive the same identity independently from unchanged `process.argv[1]`; no cross-bundle mutable state is required.     |

## Slice-specific done conditions

- [ ] A packed local `prisma7` artifact has an exact same-version Prisma dependency, exposes `prisma7` and `prisma7/config`, and demonstrably resolves Prisma 7 beside a different direct root Prisma version without changing ordinary Prisma's default invocation.

## Open Questions

None.

## References

- Parent project: `projects/prisma7-compatibility-cli/spec.md`
- Project plan: `projects/prisma7-compatibility-cli/plan.md`
- Linear issue: N/A — operator-authorized project without Linear
- Existing package contract: `packages/cli/package.json`
- Existing dispatcher/build: `packages/cli/src/bin-dispatcher.ts`, `packages/cli/helpers/build.ts`
