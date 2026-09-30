# ADR 242 — Public npm surface: single `@prisma` scope with consolidated publish packages

> **Partially superseded by the S5 CLI cutover (2026-08).** The `prisma-next` bin distribution described below is retired: the bin-only shim package is deleted, the facades declare no launcher bins, and `@prisma/orm-toolchain` publishes the `orm` command family (`@prisma/orm-toolchain/cli`) with no bin. The user-facing command is the unified `prisma` binary of `@prisma/cli` (the prisma-cli repository), which mounts the family. The package split and facade structure below stand.

## Decision

An application that uses Prisma Next against Postgres installs **one** package:

```jsonc
// package.json
{
  "dependencies": {
    "@prisma/orm-postgres": "0.16.0"
  }
}
```

That facade pulls in everything else — the framework, the SQL family, the Postgres target, and the CLI tooling — as ordinary, exact-pinned npm dependencies:

```text
@prisma/orm-postgres            facade: wiring + re-exports, installs the stack
├── @prisma/orm-framework       contracts, components, runtime core
├── @prisma/orm-family-sql      SQL-family contract, lanes, runtime
├── @prisma/orm-target-postgres target descriptor + adapter + driver
└── @prisma/orm-toolchain       CLI (bin), emitter, config-loader, LSP
```

Every published package lives under the single `@prisma` scope, apart from the unscoped bin shim. The full public surface is **17 packages** — 3 database facades, 6 extension packs, 7 platform packages, the bin shim, and nothing else. Every other workspace package is `"private": true`: it exists for code organization and layering guardrails, and reaches npm only as a subpath entrypoint of a published package (for example, the SQL runtime is importable as `@prisma/orm-family-sql/runtime`).

| Published package | Role |
|---|---|
| `prisma-next` | bin-only shim carrying the `prisma-next` command (ADR 211 mechanics) |
| `@prisma/orm-postgres`, `orm-sqlite`, `orm-mongo` | database facades — an app installs exactly one |
| `@prisma/orm-extension-postgis`, `-pgvector`, `-paradedb`, `-supabase`, `-arktype-json`, `-middleware-cache` | optional capability packs, additive installs |
| `@prisma/orm-framework` | target-agnostic runtime: contract, components, authoring surface |
| `@prisma/orm-toolchain` | dev/build tooling: CLI (carries the bin), emitter, config-loader, language server, telemetry, vite plugin |
| `@prisma/orm-family-sql`, `@prisma/orm-family-mongo` | family domains |
| `@prisma/orm-target-postgres`, `orm-target-sqlite`, `orm-target-mongo` | concrete targets, each exposing `/target`, `/adapter`, `/driver` entrypoints |

## What an application depends on

One facade, plus whatever extension packs it installs. Nothing else — not `@prisma/orm-family-sql`, not `@prisma/orm-toolchain`, even though the facade brings both in. Those arrive as the facade's own dependencies, and an application that names one directly is claiming a version contract it does not have.

That holds only if the facade has a name for everything an application reaches, so it republishes each of them as one of its own entrypoints:

| What the application reaches for | Facade entrypoint |
|---|---|
| its own wiring: client, config, contract builder, migrations | `@prisma/orm-postgres/{runtime,config,contract-builder,migration}` |
| the types generated files import | `.../{contract,components,family-contract,target,adapter}` |
| the family's runtime and query surfaces | `.../{family-runtime,orm-client,builder,relational-core}` |
| the family's control plane and IR | `.../family` |
| shared helpers and the Vite plugin | `.../{utils,vite-plugin-contract-emit}` |

Each of those is a re-export of the platform package that owns the module, never a copy — the identity rule below governs the facade exactly as it governs a platform shell. Where the facade's own wiring already owns a name, the republished surface takes a qualified one: `runtime` is the facade's Postgres client and `family-runtime` is the SQL family's.

A republished package brings its whole subpath surface, so the list is what applications reach and no more. Two platform surfaces stay out: the toolchain's migration-tooling package (`@prisma/orm-toolchain/migration-tools`) and the target's driver (`@prisma/orm-target-postgres/driver`). Their consumers are extension packs and migration-tooling harnesses, which build against the platform packages anyway, and republishing them would add dozens of subpaths that no application imports.

The facade's own `/migration` entrypoint in the table above is not that surface. It is the facade's own wiring — the small helper a scaffolded migration file imports — and it does not republish the toolchain's migration tooling.

The `prisma-next` command arrives the same way. A package manager puts only a package's *direct* dependencies on `PATH`, so the toolchain's bin is not runnable from an install that reaches the toolchain transitively. Each facade therefore declares its own `prisma-next` bin: a one-line launcher that runs the toolchain's single published copy of the program.

## Who each package is for

The package boundary states the audience, so "is this public API?" needs no documentation lookup:

- **App developers** touch the facades, the extensions, and the `prisma-next` bin. Nothing else appears in a tutorial, and nothing else appears in an application's `package.json`.
- **Generated code** imports only from packages the application directly depends on — never from transitive dependencies, which strict package managers refuse to resolve and which the application has no version contract with. The facade re-exports the contract surfaces as its own entrypoints (`@prisma/orm-postgres/contract`, `@prisma/orm-postgres/components`), and the emitter picks the import root by reading the application's own manifest: a project that depends on a facade is emitted against that facade, one that depends on the platform packages is emitted against those, and one that depends on neither keeps the names it already had. Nothing configures this, because the manifest already states it and a separate setting could only disagree with what is installed.
- **Extension authors** build against the platform packages (`orm-framework`, the families, the targets). So do decomposed installs. Applications reach the same modules through their facade's entrypoints, so the two never end up with separate copies. An extension pack splits those declarations two ways: the framework and its family are ordinary dependencies, and the *target* is a peer, because the target is what carries the codec and operation registries the pack registers into and there must be exactly one copy of those (see Consequences).
- **Nobody** installs a private workspace package; they are not on npm.

Platform package names are strict and symmetric: `orm-family-sql`, not `orm-sql`. These names are typed by tooling and generated code, not by humans running `npm install`, so regularity beats brevity.

## Decomposing a facade

A facade is thin: real wiring code plus exact-pinned dependencies. It bundles nothing. An application that outgrows the default wiring — say it needs a custom Postgres adapter — installs the facade's own dependencies directly and recomposes them:

```ts
import { createSqlExecutionStack } from '@prisma/orm-family-sql/runtime'
import postgresDriver from '@prisma/orm-target-postgres/driver/runtime'
import postgresTarget from '@prisma/orm-target-postgres/target/runtime'
import { myPooledAdapter } from './my-adapter' // replaces @prisma/orm-target-postgres/adapter/runtime

const stack = createSqlExecutionStack({
  target: postgresTarget,
  adapter: myPooledAdapter,
  driver: postgresDriver,
})
```

An application imports the runtime entries, as here, and not the `/target`, `/adapter` or `/driver` aggregates, because each aggregate re-exports every entry of its namespace, the control-plane entries included.

Because the facade's dependencies are ordinary published packages pinned to one lockstep version, the decomposed install reproduces exactly the combination the facade would have provided, minus the part being replaced. (Versioning is lockstep repo-wide — one root version, `workspace:` pins, `scripts/set-version-utils` — and this ADR leaves that model untouched.)

Decomposing means dropping the facade, not adding packages beside it: the platform packages become the application's direct dependencies and the emitter reads that from the manifest. Scaffolding a decomposed project is a different template rather than the same one under a different import root — `prisma-next init` writes an application around a facade's `runtime` entrypoint, which is that facade's own wiring code and has no counterpart in a layout that does the wiring itself.

## Why entrypoints, not bundles: module identity

The runtime relies on shared registries and `instanceof` checks that only work when a given module exists **once** in an application's module graph. Extensions also peer-depend on target packages for the same reason. This yields the core packaging rule:

> Every internal module is published from exactly one package. Consolidation happens by re-exporting internal packages as subpath entrypoints of a single published shell — never by bundling the same code into multiple packages.

So `@prisma/orm-family-sql` is a shell whose entrypoints map 1:1 onto the internal SQL-family packages:

| Internal workspace package (private) | Published entrypoint |
|---|---|
| `packages/1-framework/0-foundation/contract` | `@prisma/orm-framework/contract` |
| `packages/1-framework/1-core/framework-components` | `@prisma/orm-framework/components` |
| `packages/1-framework/2-authoring/psl-parser` | `@prisma/orm-framework/psl-parser` |
| `packages/2-sql/1-core/contract` | `@prisma/orm-family-sql/contract` |
| `packages/2-sql/5-runtime` | `@prisma/orm-family-sql/runtime` |
| `packages/3-targets/6-adapters/postgres` | `@prisma/orm-target-postgres/adapter` |
| `packages/3-targets/7-drivers/postgres` | `@prisma/orm-target-postgres/driver` |
| `packages/1-framework/3-tooling/cli` | `@prisma/orm-toolchain/cli` |

(The complete mapping lives in `docs/reference/Package Naming Conventions.md`.)

A facade's republished entrypoints are the same rule applied twice: `@prisma/orm-postgres/family-runtime` and `@prisma/orm-family-sql/runtime` are two names for one module, because the facade forwards to the platform package rather than carrying its own copy. Only the facade's own wiring source is compiled into the facade.

Internal packages keep their granularity — they remain the unit of code organization and of dependency-direction guardrails. The published shells are an outer skin, not a reorganization of the source tree.

The consolidation boundaries follow the domain directories, and the dependency graph guarantees they compose acyclically: framework ← families ← targets ← facades, extensions on top, tooling depending only on the framework. The families are disjoint (SQL never imports mongo, and vice versa).

## The framework/toolchain split

`packages/1-framework` publishes as two packages, split along its layer boundary:

- `@prisma/orm-framework` — layers `0-foundation`, `1-core`, `2-authoring`: everything application code and emitted contracts reach **at runtime**.
- `@prisma/orm-toolchain` — layer `3-tooling`: the CLI, emitter, config-loader, language server, telemetry, and vite plugin, along with their heavy dependencies (esbuild, prettier, clipanion, vscode-languageserver).

The split exists for deployment weight: a serverless bundle traces the runtime import graph and should not drag in a compiler toolchain.

The split is a necessary condition for that, not yet a sufficient one. Packages in the runtime layers still reach tooling — the families and targets depend on the emitter and migration tooling, and the facades depend on the CLI to carry the `prisma-next` command — so today a deployed application's dependency graph does include `@prisma/orm-toolchain`, and bundle weight still relies on tree-shaking. Making the separation structural requires moving those runtime-bound surfaces out of the tooling layer, which is the emitter-placement question left open below. The package boundary is drawn where it will need to be; the dependencies have yet to follow it.

## The `prisma-next` bin

The unscoped `prisma-next` package is a bin-only shim over `@prisma/orm-toolchain`'s CLI, using the mechanics of ADR 211: verbatim dist copy, mirrored runtime deps, a `bin` field, and no `exports`/`main`/`types` — it is a distribution vehicle for the `prisma-next` command, never an import target. Programmatic consumers import `@prisma/orm-toolchain` subpaths.

The command ships as `prisma-next` everywhere today: the shim package, its `bin` field, and each facade's own launcher all use that one name. Taking over the shorter `prisma` name is a separate, pre-RC roadmap task, tracked as a deferred decision below; nothing in this ADR depends on it landing.

## Repository layout: `packages/9-public/`

Publishability is a directory property. Every publishable package lives under `packages/9-public/`, extending the numbered-layer convention (`9` = the outermost, user-visible layer). Scoped packages nest under an `@prisma/` directory so the on-disk path mirrors the published name:

```text
packages/9-public/
  prisma-next/             # bin-only shim (unscoped)
  @prisma/
    orm-postgres/          # facades (wiring code lives here)
    orm-sqlite/
    orm-mongo/
    orm-extension-postgis/
    ...
    orm-framework/         # platform shells (entrypoint re-exports)
    orm-toolchain/
    orm-family-sql/
    orm-family-mongo/
    orm-target-postgres/
    orm-target-sqlite/
    orm-target-mongo/
```

`pnpm-workspace.yaml` includes the scoped level (`packages/9-public/@prisma/*`). Lint enforces the invariant in both directions: no package outside `9-public` may be publishable, and every package inside it must be. Import-allowlist and dependency-cruiser rules likewise permit only published names in emitted output and in anything a user compiles.

## Consequences

- The npm registry carries 17 Prisma Next packages, each with a stated audience; internals are structurally absent rather than "present but discouraged".
- Generated code and documentation reference only published names; the private workspace names cannot leak because they do not resolve outside the repo. Those names are `@internal/*`, with `@repo/*` for the repository's own tooling — two scopes that cannot be mistaken for a published `@prisma/*` name, which the single old scope could not offer once it stopped matching what shipped.
- Extension packs peer-depend on target packages (e.g. `@prisma/orm-target-postgres`), which are always installed — directly or via a facade — so peer resolution is satisfied in both the facade and decomposed configurations.
- Publishing remains a lockstep, whole-train operation; the release process is unchanged apart from the package list.
- Adding a new database means adding one target package, one facade, and (if it starts a new family) one family package — the public surface grows by two or three packages, not by a per-module count.

## Deferred decisions

1. **Emitter placement.** The emitter sits in the tooling layer, but the SQL family and config-loader depend on it and emitted contracts import it. Either it moves into `orm-framework`, or its type-only surface is split from its code-generating surface. Requires an inventory of what emitted code actually uses.
2. **The `prisma` name.** The shorter `prisma` name is currently published by the classic Prisma ORM. Until the succession is coordinated, the shim and the command both ship as `prisma-next`. Renaming them is a pre-RC roadmap task on its own; nothing else in this ADR depends on the outcome.

Language-server distribution was a third deferred question and is settled: the language server ships inside `orm-toolchain` as code, and publishes no module entrypoint of its own. An editor reaches it by spawning `prisma-next lsp` and speaking the protocol over stdio, which is how a language server is consumed — nothing imports it. A published entrypoint would have been surface with no importer, and the split from the CLI was for code organization rather than API. If a VS Code extension needs a standalone artifact, that is a build output of the extension, not an additional published package.

## Alternatives considered

### A second npm scope for internals (`@prisma-orm/*`)

Publishing the platform/internal packages under a separate scope was attractive as a visual separation of public from internal. Rejected:

- A single scope proves ownership. A second prisma-ish scope trains users to trust lookalike scopes, which is precisely the pattern typosquatters exploit; enterprise supply-chain review also flags unfamiliar scopes.
- Near-collisions are guaranteed confusion: `@prisma/orm-postgres` and `@prisma-orm/postgres` would be different things.
- npm's unpublish policy blocks removing any package that another published package depends on, so a second scope cannot be trialed reversibly once a facade depends on it.
- A second org permanently doubles token, provenance, 2FA, and permission administration.

The underlying itch — too many packages of unclear audience in one scope — is solved better by shrinking and structuring the published set, which this ADR does. Defensively registering the `@prisma-orm` org and leaving it empty is still worthwhile.

### Letting an application name the platform packages too

The facade would carry only its own wiring, and an application would install `@prisma/orm-family-sql` or `@prisma/orm-toolchain` alongside it whenever it needed the ORM client, the SQL builder, or migration tooling. Nothing would have to be republished, and the facade would stay genuinely thin.

Rejected because it gives up the property the facade exists for. An application would again accumulate several Prisma dependencies whose correct combination it has to maintain by hand, and each one is a version contract it can get wrong: upgrading the facade without upgrading the family resolves to two copies of the SQL runtime, and the failure is silent — both copies type-check and behave identically in isolation, and the divergence only shows up as an `instanceof` that stops holding. Republishing costs the facade a generated re-export per surface and nothing at runtime, since a re-export is not a copy.

### Publishing every workspace package

The zero-effort option: keep publishing each internal package under its own name. Rejected because the registry surface then documents nothing — users cannot tell facade from internal, tutorials accrete deep imports of internals, and every internal package name becomes de-facto public API that is breaking to rename. The visible symptom was applications with a dozen-plus direct Prisma dependencies just to talk to one database.

### Bundling internals into each facade

Compile each facade with its internal dependencies inlined (the classic esbuild approach), publishing only the facades. Rejected on correctness: two published packages that both inline the same internal module ship two copies, breaking shared registries, `instanceof`, and extension peer-dependencies. It also forecloses decomposition — a user could not replace the adapter if the adapter were sealed inside the facade.

### One framework package instead of framework + toolchain

Simpler by one package, and "the framework domain as a whole" is a clean conceptual unit. Rejected because the tooling layer's dependencies (a compiler, a formatter, a language server) would then sit in the runtime dependency graph of every deployed application, which serverless deployments pay for directly. The layer boundary already exists in the source tree; publishing along it costs nothing extra now, whereas splitting later would be a breaking change.

### Relaxed platform naming (`orm-sql` instead of `orm-family-sql`)

`orm-sql` reads better, and no SQL facade exists to collide with. Rejected to keep the name grammar uniform (`orm-family-<x>`, `orm-target-<x>`): platform names are consumed by tooling and generated code, where regularity matters and ergonomics do not, and the mongo side needs the full grammar anyway (`orm-mongo` the facade vs `orm-family-mongo` vs `orm-target-mongo`).
