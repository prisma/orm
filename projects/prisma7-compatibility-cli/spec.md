# prisma7 compatibility CLI

## Purpose

Let projects adopt Prisma 8 without losing direct, reproducible access to the Prisma 7 CLI in the same dependency graph. This gives users a supported side-by-side migration and compatibility path instead of forcing them to switch versions through transient `npx` invocations, global installs, or lockfile edits.

## At a glance

A project can install both major CLI lines under distinct package and executable names:

```json
{
  "devDependencies": {
    "prisma": "8.0.0",
    "prisma7": "7.5.0",
    "@prisma/client": "7.5.0"
  }
}
```

```text
pnpm prisma  ...  # Prisma 8
pnpm prisma7 ...  # Prisma 7
```

`prisma7@7.5.0` is a small compatibility package with a `prisma7` binary and an exact dependency on `prisma@7.5.0`. It selects a Prisma 7 CLI identity before executing that dependency, so Prisma 7 remains the single implementation while user-facing package references, executable examples, generated config imports, version checks, and update guidance say `prisma7` or `prisma7/config`.

The package-manager topology has been probed with real packed mock packages and a local registry. With direct `prisma@8` and `prisma7@7` dependencies, npm, pnpm, Yarn (node-modules and PnP), and Bun all kept the top-level `prisma` command on v8 while the `prisma7` wrapper resolved its exact v7 dependency. Both installation orders converged without stale binary links.

## Non-goals

- Adding `prisma7` as a second binary of the `prisma` package or relying on npm dependency-alias syntax.
- Forking or duplicating the Prisma 7 CLI implementation, or publishing a self-contained second copy of its build artifacts.
- Extracting a new public `@prisma/cli-core` package solely to support the compatibility wrapper.
- Hiding the nested `prisma@7` implementation from low-level stack traces or resolved filesystem paths; user-actionable diagnostics and version labels still use `prisma7`.
- Changing Prisma 8's package layout, generator architecture, or absence of `@prisma/client`.
- Defining when Prisma 7 releases occur or which npm channels and dist-tags they use; that policy belongs to a separate project. This project only mirrors each actual `prisma@7` publication to `prisma7`.
- Making Prisma 7 and Prisma 8 share or reconcile config files, generated output, schemas, migration directories, or database state automatically; users remain responsible for choosing compatible inputs and explicit `--config` paths where needed.
- Guaranteeing that installing `prisma7` alone never exposes a hoisted `prisma` binary. npm, Yarn's node-modules linker, and Bun may expose the transitive v7 binary when no direct `prisma` dependency occupies that name; the supported side-by-side topology includes direct `prisma@8`.
- Renaming Prisma domain concepts and established surfaces such as Prisma ORM, `schema.prisma`, `prisma.config.ts`, `.prisma`, `PRISMA_*`, `@prisma/client`, or Prisma documentation URLs.

## Place in the larger world

- **`packages/cli` / npm `prisma`** remains the complete Prisma 7 implementation and owns its existing dispatcher, completion entrypoint, config API, preinstall behavior, engine dependencies, Wasm assets, and command implementation. It gains only the distribution-identity seam needed for the normal `prisma` and wrapped `prisma7` entrypoints to render different package and command names.
- **A new `packages/prisma7` workspace package** owns the `prisma7` binary and matching root and `./config` forwarding exports. Its declared `prisma` dependency is exact-versioned when packed, and normal package resolution must be used so npm nesting, pnpm's virtual store, and Yarn PnP all resolve the dependency correctly.
- **`scripts/ci/publish.ts`** owns lockstep version rewriting and publish ordering. It currently discovers workspace packages automatically but only models `@prisma/*` dependencies in its graph and special-cases commit metadata for `prisma`; publishing `prisma7` therefore requires an explicit unscoped dependency/order contract and appropriate metadata handling.
- **Prisma 7 release automation** owns the mirroring contract: every published `prisma@7.x` version is followed by the exact matching `prisma7@7.x` version. The policy that decides when and through which channel Prisma 7 is published is external to this project.
- **Package managers** determine physical placement and binary linking. The supported logical invariant is stronger than any one layout: root `prisma` resolves the project's direct Prisma 8 dependency, while `prisma7` resolves its own declared Prisma 7 dependency.
- **Checkpoint/update infrastructure** does not currently model a distinct `prisma7` release line, so update prompts are suppressed for `prisma7` invocations rather than comparing them against or recommending Prisma 8.

## Cross-cutting requirements

- **Behavioral parity:** except for distribution identity, invoking `prisma7@7.x` has the same command set, arguments, defaults, exit behavior, engine/Wasm assets, and Prisma 7 semantics as invoking the exact matching `prisma@7.x`.
- **Identity consistency:** all actionable user-facing references emitted by the compatibility invocation use `prisma7`: command examples, install/update instructions, generated `prisma7/config` imports, version output labels, global/local mismatch checks, subcommand guidance, and completion-facing invocation text. Branding must be driven by one identity contract rather than independent string substitutions.
- **Domain-name stability:** the identity mechanism changes distribution names only; Prisma product terminology and file/environment conventions remain unchanged.
- **Exact version coupling:** `prisma7@X` always executes `prisma@X`. Floating ranges that could make an installed wrapper execute a different patch are not acceptable.
- **Resolution portability:** the wrapper resolves its declared dependency through Node/package-manager APIs and never assumes a physical `node_modules/prisma7/node_modules/prisma` path.
- **Side-by-side binary safety:** with direct Prisma 8 and `prisma7` dependencies, installation and reinstallation must leave the root `prisma` command on Prisma 8 and `prisma7` on Prisma 7 across supported npm, pnpm, Yarn, and Bun layouts.
- **Normal Prisma stability:** introducing identity selection must not change output, behavior, telemetry, completion, or package exports for ordinary `prisma@7` users.
- **Release mirroring:** every actual `prisma@7` publication produces a same-version `prisma7` publication afterward, regardless of the externally selected release channel. Publications outside the Prisma 7 line must not produce a `prisma7` artifact.

## Transitional-shape constraints

- The identity abstraction lands with the default `prisma` identity and regression coverage before any published wrapper depends on it; no intermediate release may change existing Prisma 7 output accidentally.
- `prisma7` is not published until its binary, forwarding exports, exact dependency, update behavior, and cross-package-manager installation topology work together end to end.
- Publish automation must establish `prisma@7.x` before `prisma7@7.x`; a failed wrapper publication must be retryable without republishing the immutable `prisma@7.x` version.
- Release integration must select `prisma7` from the fact that a Prisma 7 artifact is being published, not merely from workspace discovery, so non-v7 publication cannot create a same-version compatibility artifact.

## Project Definition of Done

The team-DoD floor document is absent in this checkout; the standard repository floor applies. Project-specific conditions:

- [ ] A fixture project can install direct `prisma@8`, `prisma7@7`, and `@prisma/client@7`, then invoke both `prisma` and `prisma7` and observe the intended major version from each.
- [ ] Clean simultaneous installs and both sequential installation orders pass for npm, pnpm, Yarn node-modules, Yarn PnP, and Bun without the Prisma 7 dependency replacing the root Prisma 8 command.
- [ ] `prisma7` command help, initialization output, generated config imports, version output, mismatch warnings, completion guidance, and update guidance consistently use `prisma7`, while corresponding `prisma` snapshots and behavior remain unchanged.
- [ ] `prisma7/config` and the package's supported root type/runtime exports resolve to the exact Prisma 7 implementation under npm, pnpm, Yarn PnP, and Bun.
- [ ] Published-package inspection proves `prisma7@X` contains an exact dependency on `prisma@X`, and release automation proves `prisma` publishes first and can survive/recover from a later `prisma7` publication failure.
- [ ] For every exercised `prisma@7` publication path, release automation publishes the exact matching `prisma7` version afterward; an exercised non-v7 publication path produces no `prisma7` artifact.
- [ ] Update/version-check prompts are suppressed for `prisma7`, with coverage proving the compatibility invocation never consults or recommends the Prisma 8 `prisma` release line.

## Open Questions

None.

## References

- Prisma CLI package manifest: [`packages/cli/package.json`](../../packages/cli/package.json)
- Prisma CLI build and dispatcher: [`packages/cli/helpers/build.ts`](../../packages/cli/helpers/build.ts), [`packages/cli/src/bin-dispatcher.ts`](../../packages/cli/src/bin-dispatcher.ts)
- Publishing pipeline: [`scripts/ci/publish.ts`](../../scripts/ci/publish.ts)
- Identity-sensitive current surfaces: [`packages/cli/src/Version.ts`](../../packages/cli/src/Version.ts), [`packages/cli/src/Init.ts`](../../packages/cli/src/Init.ts), [`packages/cli/src/utils/global-local-version-mismatch.ts`](../../packages/cli/src/utils/global-local-version-mismatch.ts), [`packages/cli/src/utils/printUpdateMessage.ts`](../../packages/cli/src/utils/printUpdateMessage.ts)
- Package-manager probe: real packed mock packages tested with npm 11.16.0, pnpm 11.13.1/11.18.0, Yarn 4.14.1 (node-modules and PnP), and Bun 1.3.13 during design discussion
