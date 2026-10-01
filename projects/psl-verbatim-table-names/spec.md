# Project spec — PSL models name their table verbatim

**Supersedes** TML-3248.

## Purpose

Prisma 8's policy is that nothing transforms identifier case implicitly. The PSL interpreter breaks that policy in one place: a model with no `@@map` resolves to a table named after the model with its first letter lowered, so `model UserProfile` creates and reads `"userProfile"`. This project removes that transformation so a model with no `@@map` names its table verbatim, and gets every existing user across the change without losing data.

## At a glance

- `model UserProfile` with no `@@map` maps to table `UserProfile`. Same rule for Mongo collections.
- Fields, native enums, TypeScript authoring, and the Prisma 7 schema source already behave this way. Only the SQL and Mongo PSL interpreters change.
- Every existing schema keeps its current storage by adding `@@map("<current table name>")` to each model that has none. That edit changes no emitted JSON, storage hash, migration chain, or ref. A codemod does it; the repo's own 228 schema files are the first thing it runs on.
- A user who upgrades without running the codemod would otherwise get a migration plan that drops and recreates every affected table. The planner detects that shape and throws with mitigation instructions instead of planning it.
- `contract infer` is fixed as a consequence: with a verbatim default, "the model name differs from the table name" is again exactly the condition for writing `@@map`, so table `"UserProfile"` infers as `model UserProfile` with no `@@map` and verifies clean.

## Non-goals

- No change to how `contract infer` re-cases names. It still turns `user_profile` into `model UserProfile` with `@@map("user_profile")`. Whether it should stay verbatim like Prisma 7 is a separate question.
- No change to the `@@map` attribute itself, to field `@map`, or to native enum naming.
- No silent or automatic rename anywhere. The planner guard is an error with instructions, nothing else.

## Place in the larger world

- The Prisma 7 schema source (`@internal/sql-contract-prisma7`, ADR "Prisma version's schema is a contract source") already uses verbatim names and is untouched.
- TS authoring (`@internal/sql-contract-ts`) defaults its table naming strategy to identity and is untouched.
- The SQL PSL default lives in `buildModelMappings` in `packages/2-sql/2-authoring/contract-psl/src/psl-field-resolution.ts`. The Mongo PSL default lives in `packages/2-mongo-family/2-authoring/contract-psl/src/interpreter.ts` (three call sites of `lowerFirst`). `contract infer`'s `toModelName` in `packages/2-sql/9-family/src/core/psl-contract-infer/name-transforms.ts` is the consumer that must agree with the SQL default.
- Migration planning for Postgres is in `packages/3-targets/3-targets/postgres/src/core/migrations/` (planner and issue-planner). `migration plan`, `migrate`, and `db update` all allow destructive operations by default, so there is no existing check that would stop the drop.
- Release notes and upgrade recipes live under `docs/releases/` and `skills/prisma-8/upgrading/app/upgrades/<from>-to-<to>/`.

## Cross-cutting requirements

1. **One rule, one place.** The SQL and Mongo PSL interpreters each have exactly one function that answers "storage name of a model with no `@@map`", and it returns the model name unchanged. `contract infer` must derive its `@@map` decision from the SQL rule, not from a private copy.
2. **The codemod is the same code for the repo and for users.** It inserts `@@map("<name with first letter lowered>")` into every model block that has no `@@map`, in both SQL and Mongo PSL, preserving formatting elsewhere. It is idempotent.
3. **Storage identity is preserved for every repo fixture.** After the codemod runs over the repo, no emitted `contract.json`, storage hash, migration plan, or ref changes. `pnpm fixtures:check` proves it.
4. **The planner guard is a hard error.** When a plan would drop table `X` and create table `Y` in the same namespace where lowering `Y`'s first letter equals `X`, planning fails with an error that names the release change, the affected models, and the two ways out: add `@@map("X")` to keep the table, or accept the rename knowingly. The guard is target-specific code in the Postgres and SQLite planners, driven by one shared detection helper in the SQL family.
5. **Infer round-trips.** A PascalCase table infers to a model with no `@@map` and verifies clean; a snake_case table still infers with `@@map`. The `LegacyAccount` journey test written for TML-3248 (commit `8e78a70d77` on branch `tml-3248-superseded`) is carried over with its `@@map` assertion inverted.

## Transitional-shape constraints

- Slice 1 lands the default change, the codemod applied to the repo, the planner guard, the infer test, and the complete, execution-validated upgrade fragment together. Landing the default change without the guard would ship a release that drops user tables; landing it without the fragment would ship a breaking change with no upgrade path.
- Slice 2 adds a rename-table migration operation so a model rename no longer plans as drop-and-create. Once it exists, the guard's second remedy points at it instead of a by-hand `ALTER TABLE`.
- Slice 3 fixes the TypeScript authoring DSL's cross-space relation fallback, which lowercases the whole target model name when no table is given. Same class of defect as the PSL default, different surface.
- The guard is temporary. It is removed once the release that introduced it is no longer within the supported upgrade window; record the removal condition in the guard's own test.

## Project DoD

- A fixture database with tables `"UserProfile"`, `user_profile`, and `user` infers, emits, and verifies clean.
- A schema with `model UserProfile` and no `@@map`, planned against a database holding `"userProfile"`, fails with the guard error naming `UserProfile`.
- The same schema after the codemod plans with zero operations against that database.
- `pnpm fixtures:check` passes with no emitted artifact changes after the repo-wide codemod.
- The app upgrade fragment under `upgrade-instructions/pending/psl-verbatim-table-names/` reproduces the repo's own example changes when run against the pre-change examples, per the record-upgrade-instructions skill's validation-by-execution procedure.
- A model rename in PSL plans as a single rename-table operation on Postgres and SQLite, and the rows survive.
- A TS-authored relation to a model in another contract space with no explicit table resolves to that model's actual table name.

## Open questions

None outstanding. Decisions taken in discussion are recorded in `design-notes.md`.

## References

- Prisma 7 engine naming rules: `schema-engine/connectors/sql-schema-connector/src/introspection/sanitize_datamodel_names.rs` in prisma/prisma-engines (model name is the SQL name verbatim; `@@map` only on sanitize, reserved, or duplicate).
- Prior slice TML-3037 (infer round-trip journey) and TML-3248 (the infer symptom).
