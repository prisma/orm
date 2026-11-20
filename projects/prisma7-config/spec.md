# Prisma 7 config coexistence

## Purpose

Let Prisma 7 and Prisma 8 run side-by-side during migration without competing for the same automatically discovered config file. Existing Prisma 7 projects must continue working unchanged until users deliberately adopt the version-specific filename.

## At a glance

During the migration period, each major version has its own canonical config:

```text
prisma7.config.ts  # Prisma 7
prisma.config.ts   # Prisma 8
```

When no explicit `--config` path is supplied, both Prisma 7 CLI entry points implemented in this branch use the same discovery policy:

```text
1. prisma7.config.{js,ts,mjs,cjs,mts,cts}
2. .config/prisma7.{js,ts,mjs,cjs,mts,cts}
3. existing prisma.config.* / .config/prisma.* discovery
4. default config when neither family exists
```

Within each location, the existing supported-extension ordering is preserved. A discovered Prisma 7-specific config is authoritative: if loading or validation fails, Prisma 7 reports the error and stops rather than falling back to `prisma.config.*`. Fallback occurs only when no Prisma 7-specific candidate exists.

`prisma init` and `prisma7 init` generate `prisma7.config.ts`. Bootstrap project-state detection, seed inspection, shell completion, help examples, and other default-path guidance recognize or advertise the Prisma 7 filename consistently. Loading a legacy `prisma.config.*` fallback remains silent apart from the existing loaded-file diagnostic.

## Non-goals

- Implementing, parsing, or validating Prisma 8's config format; the future Prisma 8 package owns that contract.
- Changing Prisma 8's future config discovery behavior.
- Converting, merging, or synchronizing Prisma 7 and Prisma 8 config contents.
- Removing or deprecating Prisma 7 support for `prisma.config.*`.
- Adding non-executing bootstrap support for legacy data-format configs (`.json`, `.jsonc`, `.json5`, `.yaml`, `.yml`, `.toml`); only the existing supported JavaScript/TypeScript extension family is in scope.
- Warning users when Prisma 7 falls back to `prisma.config.*`.
- Falling back after a discovered Prisma 7 config fails to load or validate.
- Changing explicit `--config` semantics; an explicit path remains authoritative regardless of its filename.
- Renaming `schema.prisma`, Prisma directories, environment variables, package names, or other Prisma domain conventions.

## Place in the larger world

- [`packages/config/src/loadConfigFromFile.ts`](../../packages/config/src/loadConfigFromFile.ts) owns config loading and automatic discovery. Its current c12-backed behavior discovers the `prisma.config.*` extension family and `.config/prisma.*` fallback location.
- [`packages/cli/src/utils/loadConfig.ts`](../../packages/cli/src/utils/loadConfig.ts) turns loader results into CLI diagnostics. It should continue reporting selected-file failures rather than acquiring separate fallback logic.
- [`packages/cli/src/bootstrap/project-state.ts`](../../packages/cli/src/bootstrap/project-state.ts) currently checks `prisma.config.ts` directly for project presence and seed metadata. Its non-executing inspection must select the same effective filename as automatic discovery.
- [`packages/cli/src/Init.ts`](../../packages/cli/src/Init.ts) owns generated config files and initialization guidance.
- [`packages/internals/src/cli/completion-values.ts`](../../packages/internals/src/cli/completion-values.ts) owns the shared default config completion value used by CLI and migrate commands.
- The `prisma` and `@prisma/prisma7` executables in this branch both run the same Prisma 7 implementation. They intentionally remain identical for config discovery and initialization; the future Prisma 8 CLI will be implemented by a different package.

## Cross-cutting requirements

- **Deterministic precedence:** an explicit `--config` path wins; otherwise every supported Prisma 7-specific root candidate precedes every `.config/prisma7.*` candidate, and the complete Prisma 7 family precedes existing legacy discovery.
- **Absence-only fallback:** legacy discovery runs only when no Prisma 7-specific candidate exists. Syntax errors, invalid exports, unsupported content, dependency/import failures, and config-shape validation errors in a selected Prisma 7 file hard-fail.
- **Complete family symmetry:** the version-specific family supports the same JavaScript and TypeScript extensions as the existing config loader in both root and `.config/` locations.
- **Backward compatibility:** a project containing only `prisma.config.*` behaves as it did before this project, including path resolution relative to the selected config and the existing loaded-file diagnostic.
- **Quiet compatibility:** legacy fallback introduces no warning, deprecation message, or other new stderr output.
- **Shared selection semantics:** loader discovery and bootstrap's non-executing project/seed inspection must agree across the supported JavaScript/TypeScript config candidates. Existing c12 behavior for unsupported legacy data formats is not expanded into bootstrap support.
- **Canonical new-project surface:** initialization writes `prisma7.config.ts`, and user-facing default-path examples and completion guidance name that file rather than `prisma.config.ts`.
- **Dual-entrypoint parity:** both CLI entry points in this branch apply the same Prisma 7 config behavior; the policy is not conditional on executable identity.

## Transitional-shape constraints

N/A — this is intended as a single-slice project. The slice must land discovery, bootstrap recognition, initialization, guidance, and compatibility coverage together so no merged state advertises a filename that runtime discovery does not honor.

## Project Definition of Done

The team-DoD floor document is absent in this checkout; the standard repository floor applies. Project-specific conditions:

- [ ] Without `--config`, each supported `prisma7.config.*` extension is discovered at the project root and under `.config/`.
- [ ] When both config families exist, Prisma 7 selects the Prisma 7-specific family according to the documented location and extension ordering.
- [ ] An explicit `--config` path takes precedence over both automatically discovered families.
- [ ] If the selected Prisma 7-specific config cannot be loaded or validated, the command fails with that file's error and does not read a valid legacy config beside it.
- [ ] When no Prisma 7-specific config exists, existing `prisma.config.*` and `.config/prisma.*` discovery behaves unchanged and emits no new warning.
- [ ] Relative schema, migration, Typed SQL, and view paths continue resolving from the selected config file's directory.
- [ ] Bootstrap recognizes the complete Prisma 7-specific family and supported JavaScript/TypeScript legacy flat/index forms for project-state detection and seed inspection, without adding legacy JSON, JSONC, JSON5, YAML, YML, or TOML candidates.
- [ ] Both `prisma init` and `prisma7 init` generate `prisma7.config.ts` with their existing identity-appropriate config-package imports.
- [ ] Shell completion, initialization output, help examples, and concrete default-path guidance use `prisma7.config.ts`; generic references remain phrased as “Prisma config file.”
- [ ] Focused CLI or installed-artifact coverage proves that both Prisma 7 entry points use the same precedence and fallback policy.

## Open Questions

None.

## References

- Design notes: [`design-notes.md`](./design-notes.md)
- Config loader: [`packages/config/src/loadConfigFromFile.ts`](../../packages/config/src/loadConfigFromFile.ts)
- Config loader tests: [`packages/config/src/__tests__/loadConfigFromFile.test.ts`](../../packages/config/src/__tests__/loadConfigFromFile.test.ts)
- CLI config integration: [`packages/cli/src/utils/loadConfig.ts`](../../packages/cli/src/utils/loadConfig.ts)
- Initialization: [`packages/cli/src/Init.ts`](../../packages/cli/src/Init.ts)
- Bootstrap project state: [`packages/cli/src/bootstrap/project-state.ts`](../../packages/cli/src/bootstrap/project-state.ts)
- Completion defaults: [`packages/internals/src/cli/completion-values.ts`](../../packages/internals/src/cli/completion-values.ts)
