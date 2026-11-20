# Task: Move `typedSql` Out of Hidden Preview

## Overview

`typedSql` is currently a **hidden** preview feature: valid, but absent from autocomplete and
from "valid preview features" error lists, so users and agents cannot discover it. Since the
recommended answer to several pitfalls (notably full-text search on PostgreSQL, task 007) is
"use TypedSQL", it must be discoverable. Make it a visible (active) preview feature; GA is a
separate, later decision.

## Current state

- Classification lives in the PSL Rust source compiled into `prisma-schema-wasm`:
  `psl/psl-core/src/common/preview_features.rs` in prisma-engines — `TypedSql` sits in the
  `hidden` set alongside `ReactNative`.
- The TS side gates on it: `packages/client/src/runtime/getPrismaClient.ts` throws
  "`typedSql` preview feature must be enabled in order to access $queryRawTyped API"; both
  generators gate `$queryRawTyped`emission on`isPreviewFeatureOn('typedSql')`.

## Steps

1. **prisma-engines**: move `TypedSql` from the `hidden` bitflags to the `active` set in
   `psl/psl-core/src/common/preview_features.rs`. Audit for engines-side tests pinning the
   valid-features list.
2. **prisma/prisma**: bump `@prisma/prisma-schema-wasm` (per the Wasm workflow in `AGENTS.md`);
   update any snapshots that enumerate valid preview features (e.g.
   `packages/internals/src/__tests__/engine-commands/lintSchema.test.ts` territory).
3. Review CLI help and generate output for places that should now mention `--sql` /
   `prisma generate --sql` alongside the feature.
4. Docs follow-up (docs repo): promote TypedSQL from its hidden status in the docs navigation.

## Non-goals

- GA/stabilization of `typedSql` (would make `$queryRawTyped` generation unconditional and has
  its own compatibility questions — separate decision).
- Touching `reactNative`, the other hidden feature.

## Acceptance criteria

- `previewFeatures = ["typedSql"]` appears in schema-language autocomplete, and an invalid
  feature name's error message lists `typedSql` among valid options.
- No behavioral change for schemas that already enable it.
