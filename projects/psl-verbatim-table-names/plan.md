# Project plan — PSL models name their table verbatim

**Spec:** `projects/psl-verbatim-table-names/spec.md`

## Slices

### Slice 1 — Verbatim default, codemod over the repo, planner guard, infer test

- **Outcome:** a model with no `@@map` names its table or collection verbatim in SQL and Mongo PSL; every repo schema carries an explicit `@@map` so no emitted artifact changes; the Postgres and SQLite planners refuse a drop-and-create pair that is this release's rename; `contract infer` writes `@@map` exactly when the model name differs from the table name and the PascalCase journey verifies clean.
- **Builds on:** nothing.
- **Hands to:** the codemod as a reusable script (repo-relative path recorded in the PR), the guard error code and message, and the release-note bullet points.
- **Linear:** to be created.
- **Branch:** `psl-verbatim-table-names`.

### Slice 2 — Upgrade recipe and release notes

- **Outcome:** the next release's notes list the breaking change first; the app upgrade recipe under `skills/prisma-8/upgrading/app/upgrades/` runs the codemod and explains the guard error.
- **Builds on:** slice 1's codemod path and error text.
- **Hands to:** nothing further.
- **Linear:** to be created.

Slice 2 depends on slice 1 and is sequenced after it.

## Follow-ups filed outside this project

- Rename-table migration operation, so model renames stop being drop-and-create.
- Whether `contract infer` should keep names verbatim like Prisma 7 instead of re-casing to PascalCase.

## Close-out (required)

- Verify every Project DoD item in `spec.md`.
- Migrate the naming rule into `docs/` (the Data Contract subsystem doc and an ADR recording the verbatim default and the temporary guard).
- Strip repo-wide references to `projects/psl-verbatim-table-names/**`.
- Delete `projects/psl-verbatim-table-names/`.
