# Project plan — PSL models name their table verbatim

**Spec:** `projects/psl-verbatim-table-names/spec.md`

## Slices

### Slice 1 — Verbatim default, codemod over the repo, planner guard, infer test

- **Outcome:** a model with no `@@map` names its table or collection verbatim in SQL and Mongo PSL; every repo schema carries an explicit `@@map` so no emitted artifact changes; the Postgres and SQLite planners refuse a drop-and-create pair that is this release's rename; `contract infer` writes `@@map` exactly when the model name differs from the table name and the PascalCase journey verifies clean; the app upgrade fragment is complete and validated by execution against the repo's examples.
- **Builds on:** nothing.
- **Hands to:** the codemod as a reusable script, the guard error code and message, and the upgrade fragment.
- **PR:** https://github.com/prisma/orm/pull/30317
- **Branch:** `psl-verbatim-table-names`.

### Slice 2 — Rename-table migration operation

- **Outcome:** a PSL model whose table name changes plans as one rename-table operation on Postgres and SQLite instead of a drop and a create, and the guard's second remedy points at that path. How the planner learns a rename is intended is settled in this slice's spec before implementation.
- **Builds on:** slice 1 (guard and error text).
- **Hands to:** the rename op and the intent mechanism.
- **Branch:** to be cut from `main` after slice 1 merges.

### Slice 3 — TS DSL cross-space relation table fallback

- **Outcome:** a TS-authored relation to a model in another contract space with no explicit table resolves to that model's real table name, never a lowercased model name.
- **Builds on:** nothing in this project; parallel to slice 2.
- **Hands to:** nothing further.

Slice 2 and slice 3 are independent of each other and run in parallel after slice 1 merges.

## Follow-ups filed outside this project

- Whether `contract infer` should keep names verbatim like Prisma 7 instead of re-casing to PascalCase.
- Mongo has no planner guard; the operator chose not to address it in this project.

## Close-out (required)

- Verify every Project DoD item in `spec.md`.
- Migrate the naming rule into `docs/` (the Data Contract subsystem doc and an ADR recording the verbatim default, the temporary guard, and the rename operation).
- Strip repo-wide references to `projects/psl-verbatim-table-names/**`.
- Delete `projects/psl-verbatim-table-names/`.
