## Overview

Add an unpublished `prisma7` compatibility package that runs the exact matching Prisma 7 CLI alongside a direct Prisma dependency, without copying CLI implementation or assets. The wrapper's distinctive executable target lets the CLI derive its distribution identity from the invoked script while ordinary `prisma` invocations retain their existing default.

## Changes

- **CLI identity and delegation**: Derive the immutable distribution identity from the normalized `process.argv[1]` filename stem: exact `prisma7` selects the compatibility identity and every other value defaults to `prisma`. The `prisma7` wrapper forwards arguments and exit behavior to `prisma/build/index.js` through its declared dependency.
- **Wrapper package surfaces**: Add the buildable `prisma7` workspace package with the distinctive `build/prisma7.js` bin target, an exact same-version packed Prisma dependency, root type forwarding, and `prisma7/config` runtime/type forwarding. The package contains only wrapper outputs and remains private/unpublished.
- **End-to-end coverage**: Add one client Docker E2E installed from the packed `prisma7` and workspace dependency tarballs. It imports and typechecks `prisma7/config`, proves the CLI honors a non-default schema and output, runs `prisma7 --version` and `prisma7 generate`, then executes the generated client through a real SQLite write/read.

## Why

Keeping `prisma@7` as the sole implementation avoids divergent CLI behavior and duplicated engines while giving package managers a declared dependency edge to resolve. A real-tarball probe across npm, pnpm, Yarn node-modules/PnP, Bun, package scripts/exec, direct Node execution, and npm-global launches found either a `prisma7` shim path or the `prisma7.js` target in `process.argv[1]`; normalizing that stem provides the same identity without package.json lookup or physical dependency-path parsing.

Only the exact `prisma7` stem selects the compatibility identity. Custom renamed symlinks and programmatic `require()` callers default to `prisma` because they do not represent the supported binary-invocation contract. Windows execution remains unverified; the client E2E runs in the standard Linux Docker harness.

## Scope

This slice intentionally does not yet provide exhaustive `prisma7` branding across help, warnings, initialization, generated output, completion guidance, version/update handling, or update-prompt suppression. It also does not add release mirroring, publish ordering/recovery, release-channel policy, or the full cross-package-manager acceptance matrix; those belong to later slices. The artifact remains unpublished.
