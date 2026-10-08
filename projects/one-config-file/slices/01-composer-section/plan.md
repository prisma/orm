# Slice 1 plan

Spec: [`spec.md`](./spec.md). Branch in prisma/composer: `one-config-file/composer-section`, from `main`. One implementer, resumed across dispatches. Each dispatch ends with commits on the branch and the slice's tests green; nothing is left uncommitted.

## Dispatch 1 — The section validator holds the configuration

**Outcome.** `family/section.ts` validates `{ extensions, state }` by identifying fields, passes descriptors through by reference, errors on unknown keys and on `configPath` with the migration message, handles the absent section with the best message the engine allows, and merges by taking the nearest file's section whole. Tests written first cover every branch. The exported section type is `PrismaAppConfig` from core.

**Builds on.** Nothing.

**Hands to.** Dispatch 2: a validated `PrismaAppConfig` value with provenance reaching the `deploy`, `dev`, `destroy` and `log` handlers.

## Dispatch 2 — Pipelines and programmatic operations consume the section

**Outcome.** The four handlers pass `{ value, path }` to the pipelines; the handler checks the section's directory for `prisma-composer.config.*` and fails with `CONFIG.LEGACY_FILE`. The programmatic `deploy`, `destroy`, `dev` and `log` on `@prisma/composer/control` take a required `config: { value, path }`. The generated deploy and dev stack files import `prisma.config.ts` and read `.composer`. `load-config.ts`, `check-effect-resolution.ts`, the `executorLoadFailure` effect diagnosis, `CONFIG_FILENAME`, the three old-file messages and the `c12` declarations are gone. Every affected test in `grounding.md` § 4 is updated or deleted with its subject. `packages/` builds.

**Builds on.** Dispatch 1.

**Hands to.** Dispatch 3: a cli package and public packages that read only `prisma.config.ts`.

## Dispatch 3 — Examples, fixtures, CI script, guides, skill and ADRs

**Outcome.** All ten examples, `test/integration` and `website` carry the section in `prisma.config.ts` and have no `prisma-composer.config.ts`; missing `@prisma/cli-engine` dependencies added at the pinned version and the lockfile updated with `pnpm install`; tsconfig includes fixed. `scripts/check-npm-effect-resolution.mjs` asserts by importing Alchemy directly. The guides and the skill describe the section and the programmatic `config` input. ADR-0049 written, ADR-0017 and ADR-0043 amended, the ADR index updated. The slice's done conditions from `spec.md` are run from `examples/orm-demo` and the transcript saved to `wip/slice-01-qa.md` in the Composer clone.

**Builds on.** Dispatch 2.

**Hands to.** Code review, then PR open.

## Dispatch 4 — Review fixes

**Outcome.** Every finding from `drive-code-review` that is a defect is fixed and the review re-run is clean; findings triaged out are listed in the PR.

**Builds on.** Dispatch 3 and the review.

**Hands to.** PR open.
