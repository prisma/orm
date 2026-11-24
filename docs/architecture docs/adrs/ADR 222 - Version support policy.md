# ADR 222 — Version support policy for Prisma Next

**Status:** Accepted — PostgreSQL floor amended by [ADR 248](ADR%20248%20-%20PostgreSQL%20floor%20lowered%20to%2015.md); the CLI's copy of the server floors removed by [ADR 325](ADR%20325%20-%20init%20gets%20everything%20about%20a%20target%20from%20the%20target%20package.md); the rule "We raise floors freely", to the latest GA release we test against, superseded from `8.0.0` by [ADR 329](ADR%20329%20-%20An%20application%20built%20on%20Prisma%208%20upgrades%20within%20the%20major%20without%20changes.md#supported-versions-of-what-prisma-runs-on), under which a floor rises only in a new major or when its maker ends support for a version
**Date:** 2026-05-31
**Linear:** TML-1810, TML-1809

---

## Decision

Prisma Next adopts an explicit version support policy with a single governing principle: **the supported floor for each dependency is the latest GA release we test against.** We raise floors freely and only lower them when a concrete user need justifies it. A declared floor must never claim broader compatibility than our own test infrastructure actually exercises.

The ratified floor table:

| Dimension | Floor | Enforcement |
|---|---|---|
| Node.js | `>=24` | `engines.node` on every publishable package |
| TypeScript | `>=5.9` | optional `peerDependencies.typescript` on every publishable package + source-of-truth constant + drift test |
| PostgreSQL (server) | `15` (lowered from `17` by [ADR 248](ADR%20248%20-%20PostgreSQL%20floor%20lowered%20to%2015.md)) | `POSTGRES_MIN_SERVER_VERSION` exported by `@internal/target-postgres/server-version` + `postgres:15` CI service containers + `docker-compose.yaml` |
| MongoDB (server) | `8.0` | `MONGO_MIN_SERVER_VERSION` exported by `@internal/target-mongo/server-version`; MMS 11.x downloads 8.2.x by default |
| Bun | `>=1.2` | documented; runtime detection already exists |
| Deno | `>=2.0` | documented; runtime detection already exists |

Additional constraints (documented, no enforcement overhead needed):

- **Module system**: ESM-only. No CommonJS entry points are published.
- **Consumer `tsconfig`**: `strict: true` is required, with `moduleResolution: "bundler"`, or `"nodenext"` or `"node16"` in a package whose `package.json` sets `"type": "module"` (each paired with a `module` value TypeScript accepts; Node 18 and Node 20 projects use `"node16"` resolution). The `prisma orm init` CLI configures these automatically.

---

## Context

Two issues drove this ADR. First, the repo had accumulated version drift: some packages declared `engines.node: ">=20"` while the root was `>=24`, and the DB server floors pre-dated the versions we actually test against (PostgreSQL 14, MongoDB 6.0 — both were current at project start but are now significantly behind). Second, there was no policy articulating how floors are chosen or changed, making it hard to reason about whether a given floor was deliberate or accidental.

The guiding insight: **lowering a floor is backwards-compatible; raising one is not.** Starting aggressive and lowering on demonstrated need costs nothing in compatibility. Starting conservative and being forced to raise costs users a dependency upgrade. We therefore start aggressive.

---

## Why these specific floors

**Node.js 24**: This is the current Active LTS line. Node 22 reached LTS in October 2024; Node 24 is the successor, released April 2025. `tsdown` infers the JS output target from `engines.node`, so the declaration is load-bearing, not advisory: packages with `>=20` would produce wider-compat output than the codebase actually requires or tests.

**TypeScript 5.9**: The latest GA release at the time this policy was ratified, and the version pinned in the workspace catalog. TypeScript peer declarations are optional because TypeScript is a dev-time tool — plain-JS consumers must not be forced to install it. The optional peer allows type-checking consumers to get type information without requiring it universally.

**PostgreSQL 15**: The floor was ratified at 17 (the latest GA release at the time, superseding our previous floor of 14) and lowered to 15 by [ADR 248](ADR%20248%20-%20PostgreSQL%20floor%20lowered%20to%2015.md), which records the feature audit and market context behind the change. The floor is exercised by the `postgres:15` service containers in `.github/workflows/ci.yml`, so it is directly tied to what CI runs.

**MongoDB 8.0**: Released August 2024. Our test infra uses `mongodb-memory-server` 11.x (catalog-pinned at 11.1.0), which downloads MongoDB 8.2.x by default. The floor is therefore honest — it reflects the exact major version our integration tests run against. The `mongodb` npm driver v7 supports server 8.0; no driver upgrade is required.

**Bun ≥1.2 / Deno ≥2.0**: These are the first releases of each runtime that we have successfully tested against. Runtime detection already exists in the codebase; no enforcement beyond documentation is needed for now.

---

## How the policy is enforced

### Node.js engines

Every publishable package declares `"engines": { "node": ">=24" }`. This is enforced structurally: `tsdown` uses the `engines.node` field to set its output target, so a package that omits or understates this will produce different (and potentially unintended) JavaScript output.

### TypeScript peer

Every publishable package declares:

```json
"peerDependencies": { "typescript": ">=5.9" },
"peerDependenciesMeta": { "typescript": { "optional": true } }
```

The workspace-level source of truth is `MIN_TYPESCRIPT_PEER` in `scripts/validate-typescript-peer.mjs`. A lint check (`pnpm lint:manifests`) asserts that every publishable package's peer declaration matches this constant. When raising the TypeScript floor, the correct sequence is:

1. Update `MIN_TYPESCRIPT_PEER` in `scripts/validate-typescript-peer.mjs`.
2. Run `pnpm lint:manifests` to identify affected packages.
3. Update each package's `peerDependencies.typescript` accordingly.
4. Run `pnpm install` to reconcile the lockfile.

### DB server versions

Each target package is the authoritative source of truth for its database server floor: a constant in its `src/core/server-version.ts`, exported from its `server-version` entry point (`POSTGRES_MIN_SERVER_VERSION`, `MONGO_MIN_SERVER_VERSION`). A target's `package.json` carries no Prisma configuration or metadata; Prisma 8 reads configuration only from `prisma.config.ts`.

`prisma orm init` takes the floor from the target package too. Since [ADR 325](ADR%20325%20-%20init%20gets%20everything%20about%20a%20target%20from%20the%20target%20package.md), the package's init contribution reads the constant for its `serverRequirement`, and the CLI keeps no copy. There is nothing to drift, so there is no drift test.

The correct sequence for raising a DB floor:

1. Update the constant in the target package's `src/core/server-version.ts`.
2. Update the test infrastructure to match the new floor. For PostgreSQL, that is the service-container image tags in `.github/workflows/ci.yml` and the `docker-compose.yaml` image tag. For MongoDB, it is the `mongod` version the tests download: `mongodb-memory-server`, pinned in the `pnpm-workspace.yaml` catalog, downloads its own default, so a raised floor needs a version that runs at least the floor.

---

## Consequences

- The `prisma-next init` scaffold's `.env.example` and the "Requirements" section of `prisma-next.md` reflect accurate, tested server floors (PostgreSQL 15 per [ADR 248](ADR%20248%20-%20PostgreSQL%20floor%20lowered%20to%2015.md), MongoDB 8.0) rather than the out-of-date values that preceded this ADR.
- Consumers running PostgreSQL 14 or older, or MongoDB 6.x–7.x, are outside our supported range; PostgreSQL 15 and 16 are supported. Given that PostgreSQL 14 reaches end of life in November 2026 and MongoDB 6.x is well behind the current release, this is an acceptable trade-off.
- The TypeScript optional peer declaration allows downstream tooling (IDEs, LSPs, type-checking pipelines) to surface correct minimum version requirements without forcing a hard install dependency.
- Raising any floor in the future requires updating the corresponding source-of-truth field (see the sequences above). The TypeScript drift check makes silent drift impossible in CI; the server floors have one source each.
