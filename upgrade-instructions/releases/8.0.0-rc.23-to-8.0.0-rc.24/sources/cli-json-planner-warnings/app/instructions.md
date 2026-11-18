---
changes:
  - id: planner-warnings-json-field
    summary: |
      In `--json` output, `db update` and `db init` list the planner's warnings under `plannerWarnings` instead of `warnings`, as `migration plan` does.
---

# The CLI's `--json` output lists planner warnings under `plannerWarnings`

## `planner-warnings-json-field`

A script that reads the planner's warnings from the `--json` result of `db update` or `db init` reads `plannerWarnings` instead of `warnings`. Each entry is unchanged: `kind`, `summary` and `why`. `migration plan --json` lists them under `plannerWarnings` too, and its `warnings` keeps its own messages, such as a default origin that forks the migration graph.
