# `orm init` detects a Prisma 7 project — Plan

**Spec:** `projects/orm-init-prisma7-detection/spec.md`
**Tracker:** none, at the operator's request.

## At a glance

Two slices, one per family. Slice 1 delivers the whole Postgres path: detection, the side-by-side setup with consent, the scaffold variant, the next steps, the fixture, and the docs. Slice 2 needs no change to init's logic: init checks the schema with whatever `prisma7Schema` the chosen target package exports (design notes D10), so the Mongo path works once the parallel project's Mongo source ships.

## Composition

### Stack

1. **Slice `01-postgres`** — `slices/01-postgres/` — **all five dispatches built; end-to-end proof green after #30287 merged; dispatches 6 and 7 replaced by the target selection and schema check recorded in D10; PR https://github.com/prisma/orm/pull/30291**
   - **Outcome:** a Prisma 7 Postgres project run through `orm init` ends up as § At a glance in the spec, and `db sign` succeeds against the database its Prisma 7 migrations built.
   - **Builds on:** [PR #30287](https://github.com/prisma/orm/pull/30287) merged (`prisma7Schema` in `@prisma/orm-postgres/config`).
   - **Hands to:** the detection, consent, config-evaluation, and scaffold code paths parameterised by target; the fixture project layout; the next-steps text.
   - **Focus:** `packages/1-framework/3-tooling/cli/src/orm/init*.ts`, `commands/init/`, `config-loader` (raw-export evaluation helper), `test/orm/init-*.test.ts`, `test/fixtures/`, CLI README.

2. **Slice `02-mongo`** — `slices/02-mongo/`
   - **Outcome:** the same for a Prisma 6 Mongo schema, through `@prisma/orm-mongo/config`'s `prisma7Schema`.
   - **Builds on:** slice 1; `projects/prisma7-contract-source/` slice 2 merged.
   - **Hands to:** project close-out.
   - **Focus:** no init logic changes. A Mongo fixture and an end-to-end case; a Mongo variant of the Prisma 7 quick reference (`quick-reference-prisma7.md` shows Postgres examples); checking the next steps against the Mongo source's adoption flow.

## Dependencies (external)

- PR #30287 (parallel project slices 1 and 4). Slice 1 waits for it; the branch is not stacked on it.
- Parallel project slice 2 (Mongo source). Slice 2 waits for it.
- The docs brief hand-off to `prisma/web` is a close-out item, not a slice.

## Sequencing rationale

Slice 2 cannot be tested without the Mongo source and shares every code path with slice 1, so it follows. Nothing else in the project can run in parallel.

## Model tiers

Implementer dispatches: Fable. Reviewer dispatches: Opus 4.8, mid effort. Set by the operator.

## Close-out (required)

- [ ] Verify every project DoD item in `spec.md`.
- [ ] Lift the `git init` boundary and the Prisma 7 path into the CLI README's init section.
- [ ] Hand `docs-brief-module-settings.md` to the `prisma/web` docs owner.
- [ ] Strip repo-wide references to `projects/orm-init-prisma7-detection/**`.
- [ ] Delete `projects/orm-init-prisma7-detection/`.
