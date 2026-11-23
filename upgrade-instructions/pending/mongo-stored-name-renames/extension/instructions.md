---
changes:
  - id: kept-enum-member-route-removed
    summary: |
      The CLI no longer gives its own way to keep the data of an enum member that keeps its name: the two runs of `db update` through a temporary member, and the dropping of a target's `keepDataAdvice` for members that swap stored values. A target that still reports such a member as data loss gets its question with only the `keepDataAdvice` and `keepDataEdit` it gives. `KeepDataEdit.swapsValues` stays in the type, and nothing reads it.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])swapsValues(?![\w$])'
---

# The CLI's route for enum members that keep their names is gone

No target in this repository reports an enum member that keeps its name as data loss any more: PostgreSQL, SQLite and MongoDB replace its stored value with no question. The CLI code that gave such a member its own route is removed.

## `kept-enum-member-route-removed`

Before, when a target's `dataLoss` named an enum value whose member the destination still has, the question under `db update` offered two runs: rename the member to a temporary member with an unused stored value, then rename it back. For members whose edits set `swapsValues: true`, or that shared a stored value with another kept member, the CLI also left out the target's `keepDataAdvice`.

Now the question carries the target's `keepDataAdvice`, and the ways to keep the data that the CLI builds from the target's `keepDataEdit`, and nothing else. A target that sets `swapsValues` can stop setting it. A target that still asks about a member that keeps its name should plan the value replacement instead, as the targets here do: the member is the same object on both sides, so there is nothing to ask.
