---
changes:
  - id: runner-records-database-policies
    summary: |
      `MigrationRunnerPerSpaceOptions` (from `@prisma/orm-framework/components/control`) has a new optional field, `databasePolicies`. A target's migration runner that receives it sets `meta.policies` of the space's marker to it in the marker update at the end of the run, inside the run's transaction where the target has one, and leaves the rest of `meta` as it is. A run with no migrations and `databasePolicies` set still writes the marker, and writes no ledger entry. A marker write without `databasePolicies` must leave `meta` unchanged, `initMarker`'s upsert included. The `destination` that `initMarker` and `updateMarker` of `SqlControlAdapter` and `MongoControlAdapter` take is the framework's `MarkerDestination`, which carries the same optional `databasePolicies`; store it with `storedDatabasePolicies` under `DATABASE_POLICIES_META_KEY`. The options also have `expectedDatabasePolicies`: the policies the caller checked. After the runner reads the marker under its lock, it fails the run with `MIGRATION.MARKER_CAS_FAILURE` when `markerHoldsDatabasePolicies(marker, expectedDatabasePolicies)` is false. `MongoControlAdapter.updateMarker` and `MarkerOperations.updateMarker` take an optional fifth argument, `unchangedPolicies`, which narrows the compare-and-swap to a marker still recording the policies read. The marker update is written when anything changed or policies are given; a ledger entry is written only when the run applied a migration edge, as before.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '(?<![\s\S])(?![\s\S]*databasePolicies)(?=[\s\S]*\b(?:SqlControlAdapter|MongoControlAdapter|MigrationRunner)\b)[\s\S]*\b(?:initMarker|updateMarker)\s*[(:]'
---

# A migration runner records the database's policies in the marker

```ts
// In the runner's marker update
const destination = {
  storageHash,
  profileHash,
  invariants: plan.providedInvariants,
  ...(options.databasePolicies === undefined ? {} : { databasePolicies: options.databasePolicies }),
};

// Do not skip the marker write when nothing ran but policies are to be recorded
const nothingToRecord =
  isSelfEdge && operationsExecuted === 0 && invariantsAlreadyHeld && options.databasePolicies === undefined;
```

In the control adapter, write `meta.policies` when `destination.databasePolicies` is set, and never reset `meta` otherwise: an upsert that used to set `meta` to `{}` on conflict leaves `meta` alone unless it records policies.
