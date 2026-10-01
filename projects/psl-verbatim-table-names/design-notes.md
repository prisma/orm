# Design notes — PSL models name their table verbatim

## Principles

- Prisma 8 never transforms identifier case implicitly. A different storage name is always spelled with `@@map` or `@map`.
- Upgrades never lose data by default. A breaking storage-name change ships with a check that refuses the destructive plan and a mechanical fix that keeps storage identical.

## The model

The storage name of a model with no `@@map` is the model name. This was already true for fields, native enums, TypeScript authoring, and the Prisma 7 schema source; the SQL and Mongo PSL interpreters were the exception, lowering the first letter.

## Alternatives considered

- **Keep the lowered-first-letter default and fix only `contract infer`** (the original TML-3248 fix). Rejected: it leaves a default nobody knew about, that matches no convention, and that contradicts every other authoring surface.
- **Have infer always write `@@map`.** Rejected for the same reason; it papers over the default instead of removing it.
- **Detect the rename in the planner and emit a table rename.** Rejected: a structural-match heuristic would fire on genuine drops and creates, and carry rows into the wrong table. The planner detects and refuses; the codemod keeps existing tables, and slice 2 adds a rename operation the operator requests explicitly with `--rename`.
- **Regenerate all repo fixtures with the new names.** Rejected: adding `@@map` to existing repo schemas keeps every emitted artifact byte-identical and exercises the user codemod on real schemas.

## Decisions taken in discussion (2026-09-16)

- Operator and Serhii: model names without `@@map` are verbatim; nothing transforms case.
- Operator: the planner intervenes by throwing with mitigation instructions, never by renaming.
- Operator: repo fixtures get `@@map` added rather than being regenerated.
- Orchestrator, unchallenged: infer keeps re-casing snake_case tables to PascalCase model names with an explicit `@@map`; the guard lives in the planner, not in `db verify`, because verify already prints both names side by side.

## Decision taken 2026-09-17: renames are stated in hand-written migrations

Slice 2 first added a `--rename <from>=<to>` flag to `migration plan` and `migration new`. The documented design for stating renames is a planner hint in the contract source (`@hint(was: ...)`, Data Contract and Migration System subsystem docs, ADR 001), so the flag was a second, undocumented mechanism. The operator removed it. Until hints exist, a rename is stated with `this.renameTable(...)` in a migration created by `migration new`, which also computes the companion constraint and index renames from the migration's contracts.

