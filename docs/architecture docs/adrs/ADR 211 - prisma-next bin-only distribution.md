# ADR 211 — `prisma-next` bin-only distribution

> **Superseded by the S5 CLI cutover (2026-08).** Nothing published ships a `prisma-next` bin anymore: the shim package described here is deleted, `@prisma/orm-toolchain` publishes the `orm` command family at `@prisma/orm-toolchain/cli` and no bin, and the facades forward no launcher. The only user-facing binary is the unified `prisma` CLI (the prisma-cli repository), which mounts the family. A workspace-local `prisma` bin remains on `@internal/cli` for this repository's own examples and tests. The rest of this document is kept for the record.

> **Amended after [ADR 242](ADR%20242%20-%20Public%20npm%20surface%20-%20single%20%40prisma%20scope%20with%20consolidated%20publish%20packages.md).** `@internal/cli` is no longer published, so the shim can no longer copy its dist or mirror its dependencies. The shim now lives at `packages/9-public/prisma-next/` and is a launcher: its single dependency is `@prisma/orm-toolchain`, and its committed bin file delegates to the toolchain's published CLI entrypoint (`@prisma/orm-toolchain/bin/prisma-next`) — the same delegation the database facades use for their own `prisma-next` bins. This is the "Flavor 2" upgrade this ADR anticipated under *What this enables*: internals are bundled (into the toolchain shell) and no longer published. What survives unchanged: the shim is bin-only (no `exports`, no `main`, no `types`), stays in version lockstep, and a drift-lint (`scripts/lint-sync.mjs` in the shim package) enforces the invariants. Programmatic consumers now import from `@prisma/orm-toolchain` subpaths instead of `@internal/cli`. The rest of this document is the original decision, kept for the record.

## At a glance

The user-facing CLI ships under the unscoped npm name `prisma-next` (`pnpm dlx prisma-next init`, `npx prisma-next ...`). The package is a thin **bin-only** shim whose `dist/` is a verbatim copy of `@internal/cli`'s `dist/`. It declares no `exports`, no `main`, and no `types` — `import 'prisma-next'` from any path is a hard resolution failure. Programmatic consumers (advanced config wiring, build integrations, extension authors) keep importing from `@internal/cli` and its subpaths (`/config-types`, `/control-api`, `/commands/*`, `/config-loader`).

## Context

`@internal/cli` is the internal name of the CLI package and is imported by ~21 internal packages and several example apps under that scoped address. The user-facing install command should be the ergonomic `prisma-next` (matching the bin name and the convention for CLI-first packages: `eslint`, `prettier`, `prisma`, the `typescript` binary). Two options were considered:

1. **Rename the CLI package in place** (`@internal/cli` → `prisma-next`). Updates ~30+ internal references, broadens import-allowlist enforcement to an unscoped name, and dilutes the `@internal/*` scope convention.
2. **A bin-only re-export shim** that spawns or re-imports `@internal/cli`'s installed dist at runtime. Adds runtime indirection and ships two installed packages where the end user only ever invokes one.
3. **A bin-only shim whose dist is a verbatim copy of `@internal/cli`'s dist** at build time. No runtime indirection. The CLI package keeps its scoped name; only the public distribution gets the unscoped one.

Option 3 is the chosen shape.

## Decision

`packages/1-framework/3-tooling/prisma-next/` is a sibling package to `@internal/cli` whose only build step is "clear `dist/`, copy `@internal/cli/dist/` over, re-apply `chmod 755` to the bin entries". It declares:

- `name: "prisma-next"`, `bin: { "prisma-next": "./dist/cli.js" }`.
- `dependencies` mirrored exactly from `@internal/cli`'s runtime deps so `node_modules` resolution from inside the copied `dist/` finds every transitive `@internal/*` runtime dep from the shim's own install.
- `version` kept in lockstep with `@internal/cli`'s version.
- **No** `exports`, **no** `main`, **no** `types` — the shim is a CLI distribution vehicle, never an import target. Any `import 'prisma-next'` (or any subpath) raises `ERR_PACKAGE_PATH_NOT_EXPORTED`.

A drift-lint script enforces the invariants above (deps/bin/version must equal the CLI's; `exports`/`main`/`types` must not be present) and is wired into the workspace lint flow.

The CLI's `init` command installs `prisma-next` (not `@internal/cli`) as the user's devDependency, so a freshly initialised project's `package.json` reflects the public distribution name.

## Consequences

### What stays scoped

- `@internal/cli` continues to be published. Internal workspace consumers depend on it, and external advanced users importing programmatic APIs (`@internal/cli/config-types`, `/control-api`, `/commands/*`, `/config-loader`) need it. Programmatic APIs deliberately keep the scoped address — that name is the stability contract for those subpaths.
- Every internal `@internal/*` package keeps its scoped name. Renames are out of scope for this decision.
- Other facade packages (`@internal/postgres/config`, `@internal/mongo/config`) remain the documented import target for application-level config. The asymmetry is deliberate: the CLI command is distributed under the ergonomic public name; programmatic surfaces stay scoped to signal they participate in the internal stability contract.

### What this enables

- **Curated public README.** The shim's `README.md` is the user-facing description on npm; the CLI's README stays as architecture/contributor documentation with a short reframing notice.
- **Internal-package labelling.** Pure-internal packages (`@internal/config`, `/contract`, `/emitter`, `/migration-tools`, `/utils`, `/errors`, `/framework-components`, `/psl-printer`) carry a short README notice identifying them as implementation detail of `prisma-next` so casual readers don't misread the public surface.
- **A future "Flavor 2" upgrade path** in which internal `@internal/*` runtime deps are bundled into the shim's `dist/` and no longer published. The shim's public surface (bin only, no exports) makes that upgrade non-breaking within the `0.x` line.

### What is explicitly **not** done

- The shim does not get any library exports — not now, not later. Adding any second public import surface here would require running stability management in parallel with `@internal/cli` for the same APIs; that is the entire reason the asymmetry exists.
- `@internal/cli` is not deprecated on npm. Both packages are published; one is the CLI command, the other is the programmatic-API import target.
- The CLI's `bin` name is unchanged (it has always been `prisma-next`). This decision aligns the npm package name with the bin name; it does not introduce a new bin.
- Automated changelog/release tooling and the operational publish-ordering checklist are out of scope.

## References

- [CLI subsystem](../subsystems/11.%20CLI.md)
- [Package Naming Conventions](../../reference/Package%20Naming%20Conventions.md)
- One-package-install user journey (settled): emitted `package.json` carries `prisma-next` as devDep, target facade as dep, every other `@internal/*` arrives transitively
- Linear: [TML-2265 — Publish `@internal/cli` as `prisma-next`](https://linear.app/prisma-company/issue/TML-2265/publish-prisma-nextcli-as-prisma-next)
