# Prisma 7 config coexistence — Plan

**Spec:** `projects/prisma7-config/spec.md`  
**Linear Project:** N/A — operator-directed repository project; no tracker reference was supplied

## At a glance

This is a single-slice project. Config discovery, bootstrap recognition, initialization, user-facing guidance, and compatibility proof land together because each is one surface of the same Prisma 7 filename contract and an intermediate split would either advertise unsupported behavior or support behavior the CLI does not teach.

## Composition

### Stack (deliver in order)

1. **Slice `versioned-config-coexistence`** — Linear: N/A
   - **Outcome:** Both Prisma 7 entry points automatically prefer the complete `prisma7.config.*` family across root and `.config/` locations, hard-fail selected-file errors, fall back quietly to existing `prisma.config.*` discovery only when the Prisma 7 family is absent, generate `prisma7.config.ts` from init, and recognize or advertise that filename consistently across bootstrap and user-facing default-path guidance.
   - **Builds on:** The current c12-backed loader in `@prisma/config`, the existing CLI distribution-identity seam, bootstrap's project-state inspection, and the packed Prisma 7 compatibility E2E.
   - **Hands to:** A complete, backward-compatible Prisma 7 config contract that projects can use beside Prisma 8 without routine `--config` arguments, with focused loader/CLI tests and installed-artifact evidence suitable for release.
   - **Focus:** Centralized candidate selection and error attribution; root and `.config/` extension-family precedence; explicit-path preservation; legacy fallback; relative-path behavior; bootstrap config/seed selection across supported JavaScript/TypeScript candidates only; init output; completion, help, and actionable default-filename guidance; focused unit, snapshot, and packed dual-entrypoint coverage. Legacy JSON/JSONC/JSON5/YAML/YML/TOML bootstrap candidates, Prisma 8 parsing, config conversion, warnings, and unrelated Prisma naming remain out of scope.

## Dependencies (external)

None. c12 3.3.4 is already pinned by `@prisma/config`; the slice may constrain how it is invoked or preselect candidates but does not require a dependency upgrade.

## Sequencing rationale

The project spec deliberately requires a single coherent slice. Runtime discovery, non-executing bootstrap detection, generated files, and guidance all express the same default-filename invariant: splitting them would temporarily leave users with either an undiscoverable generated file or an undisclosed runtime capability. The resulting slice remains reviewable as one end-to-end compatibility change, with the loader contract as the center and CLI surfaces as its bounded consumers.
