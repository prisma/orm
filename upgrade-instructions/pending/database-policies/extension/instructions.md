---
changes:
  - id: runner-records-database-policies
    summary: |
      `MigrationRunnerPerSpaceOptions` (from `@prisma/orm-framework/components/control`) has a new optional field, `databasePolicies`. A target's migration runner that receives it sets `meta.policies` of the space's marker to it in the marker update at the end of the run, inside the run's transaction where the target has one, and leaves the rest of `meta` as it is. A run with no migrations and `databasePolicies` set still writes the marker, and writes no ledger entry. A marker write without `databasePolicies` must leave `meta` unchanged, `initMarker`'s upsert included. The `destination` that `initMarker` and `updateMarker` of `SqlControlAdapter` and `MongoControlAdapter` take carries the same optional `databasePolicies`.
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
