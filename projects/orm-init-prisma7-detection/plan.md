# `orm init` detects a Prisma 7 project — Plan

**Spec:** `projects/orm-init-prisma7-detection/spec.md`
**Tracker:** none, at the operator's request.

## At a glance

Two slices, one per family. Slice 1 delivers the whole Postgres path: detection, the side-by-side setup with consent, the scaffold variant, the next steps, the fixture, and the docs. Slice 2 reuses everything and turns the Mongo refusal into support once the parallel project's Mongo source exists.

## Composition

### Stack

1. **Slice `01-postgres`** — `slices/01-postgres/` — **all five dispatches built; end-to-end proof green after #30287 merged; PR https://github.com/prisma/orm/pull/30291**
   - **Outcome:** a Prisma 7 Postgres project run through `orm init` ends up as § At a glance in the spec, and `db sign` succeeds against the database its Prisma 7 migrations built.
   - **Builds on:** [PR #30287](https://github.com/prisma/orm/pull/30287) merged (`prisma7Schema` in `@prisma/orm-postgres/config`).
   - **Hands to:** the detection, consent, config-evaluation, and scaffold code paths parameterised by target; the fixture project layout; the next-steps text.
   - **Focus:** `packages/1-framework/3-tooling/cli/src/orm/init*.ts`, `commands/init/`, `config-loader` (raw-export evaluation helper), `test/orm/init-*.test.ts`, `test/fixtures/`, CLI README.

2. **Slice `02-mongo`** — `slices/02-mongo/`
   - **Outcome:** the same for a Prisma 6 Mongo schema, through `@prisma/orm-mongo/config`'s `prisma7Schema`.
   - **Builds on:** slice 1; `projects/prisma7-contract-source/` slice 2 merged.
   - **Hands to:** project close-out.
   - **Focus:** the target branch in the config template and the provider check; a Mongo fixture; the Mongo next steps (`db update --advance-ref db` instead of `db sign`, per the parallel project).

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
