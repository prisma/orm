---
changes:
  - id: kept-enum-member-route-removed
    summary: |
      The CLI no longer gives its own way to keep the data of an enum member that keeps its name: the two runs of `db update` through a temporary member, and the dropping of a target's `keepDataAdvice` for members that swap stored values. A target that still reports such a member as data loss gets its question with only the `keepDataAdvice` and `keepDataEdit` it gives. `KeepDataEdit.swapsValues` stays in the type, and nothing reads it.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])swapsValues(?![\w$])'
  - id: mongo-runner-checked-policies-renamed
    summary: |
      The MongoDB runner's execute option `checkedPolicies` is renamed `policiesInForce`, and every contract space's runner now receives it. Code that passes `checkedPolicies` to the runner's `execute` must pass `policiesInForce` instead; the runner ignores the old name. Only that option is renamed: the `checkedPolicies` parameter of `updateMarker` (on `MarkerOperations` and `MongoControlAdapter`) and of `markerSwapFailure` keeps its name, so leave those as they are.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])checkedPolicies(?![\w$])'
---

# The CLI's route for enum members that keep their names is gone

No target in this repository reports an enum member that keeps its name as data loss any more: PostgreSQL, SQLite and MongoDB replace its stored value with no question. The CLI code that gave such a member its own route is removed.

## `kept-enum-member-route-removed`

Before, when a target's `dataLoss` named an enum value whose member the destination still has, the question under `db update` offered two runs: rename the member to a temporary member with an unused stored value, then rename it back. For members whose edits set `swapsValues: true`, or that shared a stored value with another kept member, the CLI also left out the target's `keepDataAdvice`.

Now the question carries the target's `keepDataAdvice`, and the ways to keep the data that the CLI builds from the target's `keepDataEdit`, and nothing else. A target that sets `swapsValues` can stop setting it. A target that still asks about a member that keeps its name should plan the value replacement instead, as the targets here do: the member is the same object on both sides, so there is nothing to ask.

## `mongo-runner-checked-policies-renamed`

8.0.0-rc.25 gave `MongoMigrationRunnerExecuteOptions` an optional `checkedPolicies`, the database's change policies, which guarded the application space's marker write. It is now `policiesInForce`, passed to every contract space's runner: the runner guards the application space's marker with it, and every space's advice offers only routes the policy permits. Rename the option where you pass it to `execute`. Only that option is renamed: the `checkedPolicies` parameter of `updateMarker` (on `MarkerOperations` and `MongoControlAdapter`) and of `markerSwapFailure` keeps its name, so a target that implements those keeps it. Passing `checkedPolicies` through a variable still compiles, but the runner no longer reads it, so the marker write is not guarded.
