# Slice: cli-owned-distribution-identity

_(Parent project `projects/prisma7-compatibility-cli/`. This slice makes the compatibility identity complete across the CLI-owned shell and project-creation lifecycle.)_

## At a glance

Make every actionable distribution reference owned by `packages/cli` render `prisma7` when invoked through the compatibility wrapper, while preserving ordinary `prisma` output byte-for-byte. This covers CLI-owned help and examples, generated config imports, initialization/bootstrap guidance, version and mismatch labels, completion setup, and update-check suppression.

## Chosen design

`packages/cli/src/utils/cli-distribution-identity.ts` remains the only distribution-identity authority and stays deliberately minimal:

```ts
type CliDistributionIdentity = 'prisma' | 'prisma7'
```

Each separately bundled CLI entry resolves that primitive identity from the executed script and passes it into the CLI-owned command constructors and output helpers it composes. Tests may inject the same primitive explicitly. The slice does not introduce an identity object, lookup map, environment marker, global state, compatibility reexport, or generic branding framework.

Actionable distribution references derive directly from the primitive value:

```text
command name       prisma generate      → prisma7 generate
config import      prisma/config        → prisma7/config
package label      prisma@7.x           → prisma7@7.x
completion target  prisma complete zsh  → prisma7 complete zsh
```

Prisma domain terminology remains unchanged: Prisma ORM and Prisma Client, `schema.prisma`, `prisma.config.ts`, `prisma/`, `.prisma`, `@prisma/client`, `PRISMA_*`, generator/provider names, documentation URLs, and low-level nested dependency paths are not distribution references.

Compatibility invocations do not start the checkpoint update request and do not print update guidance. Suppressing only the rendered message is insufficient because the project contract requires `prisma7` never to consult the Prisma 8 release line. Ordinary `prisma` checkpoint behavior remains unchanged.

This slice is bounded to direct `packages/cli` ownership. Migrate/db help and runtime guidance plus internals and generator diagnostics receive identity in `downstream-actionable-guidance`; lower packages do not import from `packages/cli`.

## Coherence rationale

The slice migrates one ownership boundary—the CLI shell and the project-creation lifecycle—to the existing primitive identity contract, leaving lower command packages as a separate dependency-direction review.

## Scope

**In:** CLI-owned command help and examples; initialization, bootstrap, platform/postgres guidance owned by `packages/cli`; generated `prisma7/config` imports; version output; global/local mismatch labels and recommendations; shell-completion installation and reinvocation; update-check suppression before checkpoint request creation; focused dual-identity tests; packed compatibility E2E coverage; an audit classifying remaining actionable `prisma` literals under `packages/cli/src`.

**Out:** Migrate/db command help and runtime guidance in `packages/migrate`; internals and client-generator diagnostics; Prisma product/domain terminology; telemetry protocols unrelated to update checking; publication, version rewriting, release selection/order/recovery, and the cross-package-manager release matrix.

## Pre-investigated edge cases

| Edge case                                                              | Disposition         | Notes                                                                                                                                          |
| ---------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Completion runs in a separately bundled entrypoint                     | Supported by design | The completion bundle resolves the same executable-derived primitive independently; no mutable cross-bundle transport is introduced.           |
| Package managers expose either a `prisma7` shim or `prisma7.js` target | Already supported   | The merged wrapper slice normalized both forms; this slice consumes that settled identity contract.                                            |
| Distribution words overlap Prisma domain paths and package names       | Audit explicitly    | `prisma/config` varies because it is a distribution export; `prisma.config.ts`, `prisma/`, and `@prisma/client` remain stable domain surfaces. |

## Slice-specific done conditions

- [ ] A packed `prisma7` invocation proves the CLI-owned help/version/completion/init/update behavior, ordinary Prisma regression tests remain unchanged, and every remaining actionable `prisma` literal under `packages/cli/src` is either migrated or explicitly classified as downstream/domain-stable.

## Open Questions

None.

## References

- Parent project: `projects/prisma7-compatibility-cli/spec.md`
- Project plan: `projects/prisma7-compatibility-cli/plan.md`
- Prior slice: `projects/prisma7-compatibility-cli/slices/side-by-side-wrapper/spec.md`
- Identity authority: `packages/cli/src/utils/cli-distribution-identity.ts`
- CLI composition: `packages/cli/src/bin.ts`, `packages/cli/src/CLI.ts`
- Update check: `packages/cli/src/utils/checkpoint.ts`, `packages/cli/src/utils/printUpdateMessage.ts`
- Linear issue: N/A — operator-authorized project without Linear
