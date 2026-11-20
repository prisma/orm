## Overview

Complete the CLI-owned `prisma7` identity pass by making executable selection explicit at every identity-sensitive CLI boundary and by proving the shipped behavior from packed artifacts instead of slice-local mocks. The compatibility invocation now renders `prisma7` across CLI-owned help, setup, completion, and version surfaces while ordinary `prisma` callers and tests pass `'prisma'` explicitly.

## Changes

- **Explicit identity plumbing**: `packages/cli/src/bin.ts` and `packages/cli/src/completions/completion-entry.ts` are the only executable-boundary inference points, and they now pass the selected identity through `CLI`, CLI-owned commands, factories, and helpers. Existing ordinary call sites such as `scripts/run-studio.ts` and the updated CLI test suites pass `'prisma'` explicitly instead of relying on fallback defaults.
- **CLI-owned output stays on the selected executable**: help, init/bootstrap/postgres guidance, completion scripts, version labels, mismatch messaging, and CLI-owned rerun/install text now derive from the selected identity. `prisma7 init` emits `prisma7/config` and `prisma7` next-step commands, while stable Prisma domain surfaces such as `prisma/schema.prisma`, `prisma.config.ts`, and `@prisma/client` stay unchanged. `packages/cli/src/CLI.ts` also avoids starting the update-check path for `prisma7`.
- **Cross-platform execution and build aliases**: Bootstrap resolves the selected local CLI through its Unix shim or Windows `.cmd` shim. Workspace path mappings expose exact and wildcard `prisma`/`prisma7` entrypoints, and the esbuild resolver now handles explicit files, package directories, and wildcard subpaths consistently.
- **Packed proof replaces slice-local mock coverage**: the four mock-heavy identity suites and the slice-added mock assertions are gone. Evidence now comes from the single packed E2E in `packages/client/tests/e2e/prisma7-compatibility/tests/main.test.ts`, which exercises real built/packed `prisma7 --help`, `validate --help`, text/JSON `--version`, `complete zsh`, `init`, `generate`, and `db push` flows. Identity-bearing command outputs use local inline snapshots with narrow path/version normalization; completion branding uses direct assertions rather than snapshotting the generated script.

## Why

Keep the identity seam mechanically auditable: executable entrypoints infer identity once, everything identity-sensitive receives it explicitly, and ordinary `prisma` callers say so explicitly. Using one packed executable-boundary proof captures the shipped wrapper behavior without over-claiming visibility into internal update or mismatch paths, while preserving stable Prisma product names that are not distribution identity.

## Scope

_CLI-owned identity completion only: explicit identity plumbing across `packages/cli`, compatibility-facing help/setup/completion/version surfaces, packed executable-boundary proof, and updated ordinary-Prisma call sites/tests. Lower-package guidance, release mirroring, and publication remain out of scope._
