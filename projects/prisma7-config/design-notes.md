# Design notes: prisma7-config

> Synthesized design document for `prisma7-config`. Read this if you want to understand **what the project's design is**, **what principles it serves**, and **what alternatives were considered and rejected**. This document is not a chronological log of decisions — it captures the settled design, standing independently of the discussions that produced it.
>
> Owned by the Orchestrator. Authored directly (not delegated — see [`drive/roles/README.md § Orchestrator-direct authoring`](../../../drive/roles/README.md)). Updated as design settles; not as decisions happen. Cross-link from the project spec; never block on a design-notes update during execution.

## Principles this design serves

- **Side-by-side operation** — Prisma 7 and Prisma 8 need independent default config files during migration.
- **Backward compatibility** — existing Prisma 7 projects continue working without renaming their current config.
- **Deterministic failure** — an invalid Prisma 7-specific config must not silently redirect execution to a different config contract.

## The model

Prisma 7 treats `prisma7.config.*` as its canonical automatic-discovery family and `prisma.config.*` as a compatibility fallback. Both root-level and `.config/` locations participate, preserving the supported extension family and existing ordering within each family.

An explicit `--config` path remains authoritative. Automatic fallback occurs only when no Prisma 7-specific candidate exists; a discovered but invalid Prisma 7 config hard-fails. Both CLI entry points implemented by the Prisma 7 code in this branch use this policy. The future Prisma 8 package owns Prisma 8 config behavior.

Initialization generates `prisma7.config.ts`. Bootstrap project-state detection and seed inspection recognize the Prisma 7 family plus the supported JavaScript/TypeScript legacy candidates without adding JSON, JSONC, JSON5, YAML, YML, or TOML candidates. Completion and user-facing default-path guidance advertise the canonical TypeScript filename. Loading a legacy fallback adds no warning beyond the existing loaded-file diagnostic.

## Alternatives considered

- **Change only the `prisma7` wrapper** — attractive because it isolates the compatibility executable. **Rejected because:** both CLI entry points in this branch are Prisma 7 implementations and are intended to remain behaviorally identical.
- **Support only `prisma7.config.ts`** — attractive because it minimizes discovery work. **Rejected because:** Prisma config discovery already supports an extension family and a `.config/` location; a partial mirror would be inconsistent.
- **Fall back after a Prisma 7 config load error** — attractive as resilience. **Rejected because:** it could silently load Prisma 8's config and conceal the exact migration failure the filename split is intended to prevent.
- **Warn when using `prisma.config.*`** — attractive as migration encouragement. **Rejected because:** legacy fallback is a compatibility guarantee and new stderr output would create noise or disrupt automation.

## Open questions

None.

## References

- Project spec: [`./spec.md`](./spec.md)
- Project plan: [`./plan.md`](./plan.md)
- Config loader: [`../../packages/config/src/loadConfigFromFile.ts`](../../packages/config/src/loadConfigFromFile.ts)
- Bootstrap project state: [`../../packages/cli/src/bootstrap/project-state.ts`](../../packages/cli/src/bootstrap/project-state.ts)
