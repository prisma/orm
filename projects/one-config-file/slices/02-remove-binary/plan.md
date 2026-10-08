# Slice 2 plan

Spec: [`spec.md`](./spec.md). Branch in prisma/composer: `one-config-file/remove-binary`, stacked on `one-config-file/composer-section` until slice 1 merges, then rebased onto `main`. Same implementer as slice 1, resumed.

## Dispatch 1 — The examples and CI run the real host

**Outcome.** Every example, `test/integration` and `website` depend on the `prisma` package at the host's current published version and import `definePrismaConfig` from `prisma/config`. A root `pnpm.overrides` entry points `@prisma/composer-cli` at the workspace. Example scripts run `bun node_modules/.bin/prisma deploy|dev`. A repo-private destroy script under `scripts/` calls the programmatic `destroy` with the example's config. `.github/actions/deploy-verify-destroy`, `scripts/destroy-guard.sh`, `deploy-docs.yml` and the cron canary use `prisma` and that script. The four integration tests that spawned the binary spawn `prisma` instead. `check-cli-engine-pin.mjs` still passes. The binary still exists at the end of this dispatch, unused by anything in the repo.

**Builds on.** Slice 1.

**Hands to.** Dispatch 2: nothing in the repo runs the binary.

## Dispatch 2 — The binary is deleted

**Outcome.** The cli package's `bin.ts`, `cli.ts`, `family/engine-cli.ts`, `family/runtime.ts`, `commands/destroy.ts`, `commands/log.ts`, `target.ts`, the pass-through `orm` section family, their tests, the tsdown `bin` entry, `ComposerOperations.destroy`/`.log` and the control double's counterparts are deleted. `@prisma/composer-cli` declares no `bin`; `check-cli-engine-pin.mjs` and `check-npm-effect-resolution.mjs` no longer expect `dist/bin.mjs` or run `--help`. The `/control` exports `destroy` and `log` keep their tests. Stale comments corrected. `packages/` builds and every check from slice 1 passes.

**Builds on.** Dispatch 1.

**Hands to.** Dispatch 3: a repo with no binary and no reference to it in code.

## Dispatch 3 — The name is gone and a check keeps it out

**Outcome.** Every `prisma-composer` command mention in `README.md`, `docs/guides/`, `skills/`, `skills-contrib/`, `examples/**`, `website/`, `test/`, `packages/**` messages and comments, and `.github/` is rewritten to the `prisma` form or to the programmatic operation, with the guide and skill passages the spec names (teardown and logs as operations with an example each, login required, the stale `[dev] logs` line removed). The staged skill copy is regenerated. The CI check script and its test exist and are wired into the lint job, with the allowlist for the migration passages. `pnpm bump-minor` is run last, taking the repo to 0.26.0.

**Builds on.** Dispatch 2.

**Hands to.** Code review, then PR open.

## Dispatch 4 — Review fixes

**Outcome.** Every in-scope finding fixed and verified.
