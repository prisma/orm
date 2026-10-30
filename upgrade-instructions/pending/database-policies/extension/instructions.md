---
changes:
  - id: runner-records-database-policies
    summary: |
      `MigrationRunnerPerSpaceOptions` (from `@prisma/orm-framework/components/control`) has a new optional field, `databasePolicies`. A target's migration runner that receives it sets `meta.policies` of the space's marker to it in the marker update at the end of the run, inside the run's transaction where the target has one, and leaves the rest of `meta` as it is. A run with no migrations and `databasePolicies` set still writes the marker, and writes no ledger entry. A marker write without `databasePolicies` must leave `meta` unchanged, `initMarker`'s upsert included. The `destination` that `initMarker` and `updateMarker` of `SqlControlAdapter` and `MongoControlAdapter` take is the framework's `MarkerDestination`, which carries the same optional `databasePolicies`; store it with `storedDatabasePolicies` under `DATABASE_POLICIES_META_KEY`. `MigrationRunner.execute` takes a new optional `expectedDatabasePolicies` beside `perSpaceOptions`: the policies the caller checked. Once the runner holds its marker lock, and before it applies the first space, it reads the application space's marker and calls `compareMarkerDatabasePolicies(marker, expectedDatabasePolicies)`. On `moved` it returns `databasePoliciesMovedFailure(expectedDatabasePolicies, comparison.found)` (`MIGRATION.MARKER_CAS_FAILURE` with `meta.reason: 'databasePolicies'`) without running any operation; on `unreadable` it throws `errorMarkerPoliciesCorrupt` (from `@prisma/orm-framework/errors/execution`), whose advice keeps the marker. A SQL target's runner does all of this with one call to `checkDatabasePoliciesHeld(family, driver, expectedDatabasePolicies)` from `@prisma/orm-family-sql/control`; a MongoDB runner uses `checkMarkerPolicies(marker, checked)` from `@prisma/orm-family-mongo/control`. `ControlFamilyInstance.signSpaces` takes the same `expectedDatabasePolicies` beside `spaces` and compares them the same way before it writes any marker, whether or not the application space is among `spaces`; when they no longer hold it returns only a conflict for the application space with `reason: 'databasePolicies'`, `checked` and the `comparison`, and no `contract`. Every other conflict now carries `reason: 'storageHash'`. Likewise, the `MIGRATION.MARKER_CAS_FAILURE` a runner returns when the marker's storage hash moved under it carries `meta.reason: 'storageHash'` beside `space`, `expectedStorageHash`, `foundStorageHash` and `destinationStorageHash`. `MongoControlAdapter.updateMarker` and `MarkerOperations.updateMarker` take an optional fifth argument, `rawPolicies: { value }` (`RawStoredPolicies`), the raw `meta.policies` read, `undefined` when the key was absent; the compare-and-swap then matches only a marker that still stores exactly that. `MarkerOperations` also has a required `markerLocation`, the collection that holds the markers, which the runner names in errors. When that compare-and-swap fails while the storage hash still holds, compare the policies again: unreadable is `errorMarkerPoliciesCorrupt`, moved is the policies failure, and policies that read the same but are stored in another form are a reason to swap again with the raw value found. The SQL family's `insertMarker` takes `MarkerInsert`, a `MarkerDestination` without `databasePolicies`. The marker update is written when anything changed or policies are given; a ledger entry is written only when the run applied a migration edge, as before.
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
