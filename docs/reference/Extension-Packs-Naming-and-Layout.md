# Extension Packs — Naming and Layout Conventions

Purpose: define a consistent convention for naming, placing, and describing extension packs across domains.

## NPM Package Name
- Use `@internal/extension-<name>` as the private workspace name of each extension pack in this repo; Prisma publishes it as `@prisma/orm-extension-<name>`
  - Examples: `@internal/extension-pgvector`, `@internal/extension-postgis`, `@internal/extension-views`
- Include domain only when necessary to avoid ambiguity (rare): `@internal/extension-sql-views`
- Packages published by someone other than Prisma follow [ADR 308](../architecture%20docs/adrs/ADR%20308%20-%20Community%20packages%20are%20named%20prisma-orm-name.md)

## Filesystem Location

Extension packs live under `packages/3-extensions/` with domain-specific subfolders when needed:

```
packages/
  3-extensions/              # Domain 3: Extensions
    pgvector/                # pgvector extension pack
    sql/                     # SQL-specific extensions (if needed)
      <name>/
    framework/               # Framework-wide packs (if any)
      <name>/
```

**Examples:**
- `packages/3-extensions/pgvector/` → `@internal/extension-pgvector`
- `packages/3-extensions/sql/views/` → `@internal/extension-sql-views` (future)

## Minimal Source Layout

Extension packs use multi-plane entrypoints to separate control (migration) and runtime code:

```
packages/3-extensions/<name>/
  package.json
  README.md
  tsdown.config.ts
  src/
    core/                # Shared plane code
      types.ts           # Type definitions
      codecs.ts          # Codec definitions (if applicable)
    types/               # Additional type definitions (shared plane)
    exports/             # Entry points
      control.ts         # Migration plane (control plane descriptors)
      runtime.ts         # Runtime plane (runtime factories)
      codec-types.ts     # Re-export codec types (shared plane)
      operation-types.ts # Re-export operation types (shared plane)
```

## Package Exports

Extension packs expose multiple entrypoints via `package.json` exports:

```json
{
  "exports": {
    "./control": {
      "types": "./dist/exports/control.d.ts",
      "import": "./dist/exports/control.js"
    },
    "./runtime": {
      "types": "./dist/exports/runtime.d.ts",
      "import": "./dist/exports/runtime.js"
    },
    "./codec-types": {
      "types": "./dist/exports/codec-types.d.ts",
      "import": "./dist/exports/codec-types.js"
    },
    "./operation-types": {
      "types": "./dist/exports/operation-types.d.ts",
      "import": "./dist/exports/operation-types.js"
    }
  }
}
```

## Architecture Config

Extension packs require multiple entries in `architecture.config.json` to map each plane:

```json
{
  "glob": "packages/3-extensions/<name>/src/core/**",
  "domain": "extensions",
  "layer": "adapters",
  "plane": "shared"
},
{
  "glob": "packages/3-extensions/<name>/src/types/**",
  "domain": "extensions",
  "layer": "adapters",
  "plane": "shared"
},
{
  "glob": "packages/3-extensions/<name>/src/exports/control.ts",
  "domain": "extensions",
  "layer": "adapters",
  "plane": "migration"
},
{
  "glob": "packages/3-extensions/<name>/src/exports/runtime.ts",
  "domain": "extensions",
  "layer": "adapters",
  "plane": "runtime"
},
{
  "glob": "packages/3-extensions/<name>/src/exports/codec-types.ts",
  "domain": "extensions",
  "layer": "adapters",
  "plane": "shared"
},
{
  "glob": "packages/3-extensions/<name>/src/exports/operation-types.ts",
  "domain": "extensions",
  "layer": "adapters",
  "plane": "shared"
}
```

## Integration Points
- **Authoring/Targets**: packs contribute ops/types manifests via control plane entrypoint
- **Lanes/Runtime**: packs expose codecs and are auto-registered via runtime entrypoint
- **Tooling (Migration Plane)**: optional planner/preflight hooks via control plane

## Guardrails
- Packs import only via documented SPI of framework/sql packages
- No pack may import from `test/**` or `examples/**`
- Domain boundaries remain enforced via `architecture.config.json`
- Control plane code cannot import from runtime plane (enforced by dependency cruiser)

## Rationale
This convention keeps imports clear and consistent, keeps the repo navigable, and scales across domains. The `extension-` prefix is preferred over shorter alternatives (like `ext-`) for clarity and discoverability. The numbered directory prefix (`3-extensions/`) indicates that extensions are in domain 3, which can import from domains 1 (framework) and 2 (sql/document).

## Related Documentation
- [Package Naming Conventions](./Package%20Naming%20Conventions.md)
- [ADR 112 - Target Extension Packs](../architecture%20docs/adrs/ADR%20112%20-%20Target%20Extension%20Packs.md)
- `.cursor/rules/multi-plane-packages.mdc` - Multi-plane package patterns