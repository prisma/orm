## Dispatch plan

### Dispatch 1: establish versioned discovery semantics

- **Outcome:** `@prisma/config` automatically selects the complete Prisma 7-specific family before legacy discovery, preserves explicit paths and relative-path resolution, and returns the selected Prisma 7 file's error without fallback when loading or validation fails.
- **Builds on:** The slice spec's precedence and absence-only fallback contract, plus the existing c12-backed loader behavior.
- **Hands to:** One tested lower-layer candidate-order and loading contract that distinguishes Prisma 7-family absence from selected-file failure and can be consumed by non-executing detection.
- **Focus:** Candidate ordering across root and `.config/`; all supported JS/TS extensions; explicit `configFile`; error-path attribution; invalid-file hard failure beside a valid legacy file; quiet legacy/default fallback; path transformation regressions. Do not change CLI-generated files or user-facing guidance yet.
- **Validation gate:** `pnpm --filter @prisma/config build`; `pnpm --filter @prisma/config test loadConfigFromFile.test.ts`; Prettier on affected files; `git diff --check`.

### Dispatch 2: align project lifecycle and guidance

- **Outcome:** Bootstrap selects the same effective config for project-state and seed inspection, both init identities generate `prisma7.config.ts`, and production completion/help/actionable default-path guidance consistently teaches the Prisma 7 filename while generic Prisma terminology remains unchanged.
- **Builds on:** Dispatch 1's shared, tested candidate-order contract.
- **Hands to:** A source-complete Prisma 7 filename contract spanning runtime discovery, project detection, initialization, completion, and concrete user-facing guidance, with updated focused tests and snapshots.
- **Focus:** Non-executing bootstrap selection with existing package.json seed precedence; init output and identity-specific config imports; completion value; CLI, migrate, and internals production literals classified as concrete defaults versus intentional generic/domain references; focused snapshot updates. Do not redesign explicit `--config`, add fallback warnings, or implement packed E2E coverage yet.
- **Validation gate:** builds for `@prisma/config`, `@prisma/internals`, `@prisma/migrate`, and `prisma`; focused config, init, bootstrap, CLI, internals, and migrate tests covering changed behavior/snapshots; Prettier on affected files; `git diff --check`.

### Dispatch 3: prove the installed compatibility contract

- **Outcome:** Installed-command evidence exercises Prisma 7-specific precedence, invalid-file hard failure, quiet legacy fallback, and generated filename behavior through both Prisma 7 entry points; the final production-literal audit and package gates leave the slice reviewer-ready.
- **Builds on:** Dispatch 2's source-complete runtime and user-facing contract.
- **Hands to:** A fully verified slice satisfying the project DoD, with real CLI evidence and a classified record of intentionally unchanged `prisma.config.ts` references.
- **Focus:** Extend the existing packed `prisma7-compatibility` scenario or equivalent installed-artifact boundary; assert selected loaded paths and negative fallback behavior without network activity; preserve the existing generated-client smoke; run the final literal audit and fix only in-scope escapees; complete cross-package validation. Do not broaden into package-manager topology or Prisma 8 behavior.
- **Validation gate:** affected package builds and focused tests from Dispatches 1–2; `pnpm --filter @prisma/client test:e2e --verbose --runInBand prisma7-compatibility`; relevant root lint/format checks; `git diff --check`.
