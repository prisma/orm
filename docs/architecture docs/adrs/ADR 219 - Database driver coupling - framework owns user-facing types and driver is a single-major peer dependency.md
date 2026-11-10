# ADR 219 — Database driver coupling: framework owns user-facing types; driver is a single-major peer dependency

## At a glance

Prisma Next's database extensions (`@internal/mongo`, `@internal/postgres`, `@internal/sqlite`, …) couple to their underlying database drivers (`mongodb`, `pg`, `better-sqlite3`, …) under two framework-wide rules:

1. The framework **owns the user-facing type surface**. Users importing database-driver types in application code import them from `@internal/<extension>/*` — never directly from the driver. The framework re-exports those types from the driver; it does not wrap them in framework-owned type identities.
2. The driver is declared as a **single-major peer dependency** on the framework's runtime-consumer packages. Users declare and install the driver themselves; the framework supports exactly one driver major at a time.

Major driver bumps are breaking framework releases following a documented audit cadence (§ Major-bump cadence).

## Context

Every database extension faces the same coupling question: where do users get the driver, and which types do they import for the values the framework returns and accepts? Two architectural questions that have to be decided together — they reinforce each other and produce a single coherent posture.

The questions are coupled because the answer to "which types do users import" constrains the answer to "how do we declare the driver." If the framework owns the user-facing types by re-exporting them, the framework is forced into a single supported driver major (cross-major class realms break the re-export's identity guarantees). If the framework supports multiple majors, it cannot re-export the driver's types — it must wrap them in framework-owned identities or push users at the driver directly. Picking the policy on one question implies the policy on the other.

The policy is framework-wide. Every database extension that wraps a driver — mongo, postgres, sqlite, future additions — adopts the same posture; migration of any extension whose declarations currently diverge is implementation work, not a re-litigation of the policy.

## Decision

### (1) Framework owns the user-facing type surface

When user application code needs a database-driver type, the import path is `@internal/<extension>/*` — never the driver package directly:

```ts
import { ObjectId, MongoClient } from '@internal/mongo/bson';
// not: import { ObjectId, MongoClient } from 'mongodb';
```

The framework re-exports these types from the underlying driver (`@internal/mongo/bson` re-exports `Binary`, `Decimal128`, `Long`, `MongoClient`, `ObjectId`, `Timestamp` directly from `'mongodb'`). It does **not** wrap them in framework-owned type identities; the class realm users see is whichever driver major the framework is currently published against.

**Why re-export instead of wrap.** Wrapping driver types in framework-owned identities would force conversion at every boundary (framework value ↔ driver value), denormalise the type surface (`PrismaObjectId` vs `ObjectId` confusion at runtime), couple the framework's release cadence to maintaining a wrapper layer, and decouple framework-emitted types from the driver's own type evolution (deprecated symbols would persist past upstream removal). Re-exporting keeps the framework's type surface aligned with the driver's per-major shape while still owning the import path.

**Why own the import path.** The framework's codec return types are authoritative for what user application code reads and writes. Users importing driver types directly from `'mongodb'` / `'pg'` / `'better-sqlite3'` would couple their application code to the driver's package identity, defeating the framework's role as the ORM. The re-export barrel makes the framework the single import target for the database-related types user code touches.

### (2) Driver is a single-major peer dependency

The framework's runtime-consumer packages declare the driver in `peerDependencies` with a single-major range:

```jsonc
// packages/3-targets/mongo/9-facade/package.json
{
  "peerDependencies": { "mongodb": "^7.0.0" }
}
```

Users declare the driver in their own `package.json` and choose their install within the supported major:

```jsonc
// user's package.json
{
  "dependencies": {
    "@internal/mongo": "^X.Y.Z",
    "mongodb": "^7.0.0"
  }
}
```

**Why a single major.** A multi-major peer range (`^N || ^N+1`) would force the framework to drop the type re-export (cross-major class realms break `instanceof` checks; the same symbol name resolves to different classes per realm), restructure every nominally-typed driver surface (the typed `mongoClient?: MongoClient` option, etc.) into structural shapes that satisfy both majors, double or triple the test matrix, and multiply maintenance cost on every breaking change in any in-range major. Single major keeps rule (1) coherent.

**Why peer dependency and not regular dependency.** Declaring the driver as a regular `dependency` in the framework's packages hides it from the user's `package.json` and lockfile — the user can see two majors in their tree if any other dependency also installs the driver, with no clear control over which wins. Peer-dep declaration makes the driver visible in the user's own install graph, gives them explicit control over minor / patch within the supported major, and surfaces version conflicts at install time rather than at runtime.

**Non-consumer packages.** Workspace packages that don't `import from '<driver>'` in `src/` (e.g. `@internal/family-mongo`) declare the driver in neither `dependencies` nor `peerDependencies`. `devDependencies: { <driver>: catalog: }` is permitted on a non-consumer package when its own test code imports from the driver — `devDependencies` do not propagate to end-users' install graphs, so they are a build-time concern that doesn't affect the public coupling shape.

**Workspace catalog.** The workspace catalog (`pnpm-workspace.yaml`) pins a concrete version inside the supported major (e.g. `mongodb: ^7.2.0`) for the framework's own dev / test / CI builds. Internal `devDependencies` reference the catalog. The catalog moves to a new minor (or major, on a bump) in lockstep with the peer range.

### (3) Major-bump cadence

When the upstream driver publishes a new major, the framework's adoption follows this cadence:

1. **Extend the surface-area recon to the new major.** Enumerate driver imports and dependency declarations across the workspace; classify each consumer / non-consumer / tests-only-consumer. Recon scans both `src/` AND `test/` — failing to scan tests is a known failure mode ([`drive/calibration/failure-modes.md § F8`](../../../drive/calibration/failure-modes.md#f8-recon-specialist-classifies-dependency-usage-by-src-only-scan)).
2. **Assess breaking-change impact** on the symbols the framework imports and on the types it re-exports through `@internal/<extension>/*` barrels. The driver's release notes are the source of truth.
3. **Bump the peer range and the workspace catalog in a breaking framework release.** Peer range moves to the new single major (`^N+1.0.0`); catalog moves to a concrete `^N+1.x.y` (latest minor at land time).
4. **Document user-visible class-shape changes** in the breaking release's migration note. Class-shape changes in the driver's re-exported types propagate through the `@internal/<extension>/*` barrels to users — that is a public-API commitment the framework owns.
5. **Users bump their own driver install in lockstep.** No compatibility shims, no version-detection branches in the framework's runtime. Multi-major support is deliberately out of scope; if a customer ever requires it, surface as a separate breaking-change project with its own design and migration story.

## Consequences

### Positive

- **Honest user install graph.** Users see the driver in their own `package.json` and lockfile; they install it themselves; version conflicts surface at install time rather than at runtime.
- **Single import target for driver-related types.** Users import everything through `@internal/<extension>/*` paths. The ORM is the only thing they couple to; the driver's package identity is a framework concern.
- **No multi-major complexity.** No version-detection branches, no compatibility shims, no cross-major class-realm bugs. Framework code is published against exactly one driver major at a time.
- **Lockfile coherence.** Workspace catalog pins a concrete minor inside the supported major; the driver's own dev-dependencies (memory-server, etc.) align cleanly with that pin.
- **Type surface tracks driver evolution.** Because the framework re-exports rather than wraps, deprecated driver symbols deprecate in the framework's surface in lockstep — no wrapper-layer drift.

### Negative

- **Forced upgrades on driver major bumps.** Users on the previous catalog accept a forced upgrade in lockstep with the framework's breaking release. There is no "stay on the old driver while using the new framework" path.
- **Public-API breaks on every driver major.** Class-shape changes in the driver's types propagate through the framework's re-export barrels. The framework's migration notes carry these breaks to users (for example, BSON v7's removal of the `new ObjectId(numericTimestamp)` constructor surfaces as a Prisma Next migration-note item).
- **Maintenance cost per driver major.** Each driver major requires the framework to walk the audit cadence (§ 3). Acceptable cost — drivers publish majors at year-plus cadences and the audit is bounded.

## Alternatives considered

- **A. Pin the driver in `dependencies` (driver is the framework's implementation detail).** Rejected because the install-graph honesty argument (peer-dep makes the driver visible in the user's `package.json`) outweighs the surface uniformity argument. Framework packages declaring the driver as a regular dep hide it from user tooling and prevent users from controlling minor / patch within the major.
- **B. Multi-major peer range (`^N || ^N+1`).** Rejected because it forces dropping the type re-export (cross-major class realms break `instanceof` and shape compatibility), forces structural typing of every driver-typed surface, doubles or triples the test matrix, and multiplies maintenance cost on every breaking change in any in-range major. The complexity-cost / value-delivered ratio is wrong.
- **C. Drop the framework-owned type re-exports; users import driver types directly from the driver package.** Rejected because the framework's role as the ORM means it owns the types user code touches. Forcing users to import `ObjectId` from `'mongodb'` (or `Pool` from `'pg'`) directly contradicts the framework's surface-ownership commitment and tightens user-side coupling to the driver beyond what the framework controls. The barrel earns its keep as the framework-owned import path for these classes.
- **D. Wrap driver types with framework-owned identities (`PrismaObjectId`, `PrismaPool`, …).** Rejected because wrapping forces conversion at every boundary, denormalises the type surface, couples the framework's release cadence to maintaining a wrapper layer, and decouples framework-emitted types from the driver's own type evolution (deprecated symbols persist past upstream removal). The framework owns the *import path* but defers the *type identity* to the driver per-supported-major.
- **E. "Pin to latest now, add multi-major support as a follow-up feature later".** Rejected because the framing is incoherent — adding multi-major support is not an additive feature on top of single-major, it requires breaking the type re-export (rule 1) and restructuring every nominally-typed driver surface, both of which are public-API breaks. If multi-major ever becomes necessary, it is correctly framed as a future breaking-change project with its own design.

## References

- [`drive/calibration/failure-modes.md § F8`](../../../drive/calibration/failure-modes.md#f8-recon-specialist-classifies-dependency-usage-by-src-only-scan) — recon-scan-tests discipline for major-bump audits.
- Upstream release notes: [mongodb driver](https://github.com/mongodb/node-mongodb-native/releases), [bson](https://github.com/mongodb/js-bson/releases).
