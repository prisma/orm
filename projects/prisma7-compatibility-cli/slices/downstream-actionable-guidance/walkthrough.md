## Sources

- Slice spec: [projects/prisma7-compatibility-cli/slices/downstream-actionable-guidance/spec.md](projects/prisma7-compatibility-cli/slices/downstream-actionable-guidance/spec.md)
- Slice plan: [projects/prisma7-compatibility-cli/slices/downstream-actionable-guidance/plan.md](projects/prisma7-compatibility-cli/slices/downstream-actionable-guidance/plan.md)
- Review: [projects/prisma7-compatibility-cli/reviews/code-review.md](projects/prisma7-compatibility-cli/reviews/code-review.md)
- Commit range: `origin/v7...HEAD`
- Commits read: `7bc4e37a97`, `b7fa50bea3`, `451c633d10`, `cc07b4f32a`, `2695ccd8a9`, `4f08193fc8`, `4354a9a36e`

## Intent

Make downstream guidance identity-complete for the unpublished `prisma7` distribution without teaching lower packages what `prisma7` is. The CLI remains the only owner of executable identity, and lower packages now accept a primitive command name only where they need to render actionable user instructions.

## Change map

- **Implementation**:
  - [packages/cli/src/bin.ts](packages/cli/src/bin.ts) — threads the selected executable into migrate, db, and generate construction; lines 100-134.
  - [packages/migrate/src/commands/MigrateCommand.ts](packages/migrate/src/commands/MigrateCommand.ts) — instance-bound help/unknown-command rendering for `migrate`; lines 6-103.
  - [packages/migrate/src/commands/DbCommand.ts](packages/migrate/src/commands/DbCommand.ts) — instance-bound help/unknown-command rendering for `db`; lines 6-75.
  - [packages/migrate/src/utils/errors.ts](packages/migrate/src/utils/errors.ts) — runtime recovery/error strings now format full commands from `cliCommand`; lines 18-74.
  - [packages/migrate/src/utils/handleEvaluateDataloss.ts](packages/migrate/src/utils/handleEvaluateDataloss.ts) — unexecutable-step recovery now points at the selected executable; lines 6-31.
  - [packages/internals/src/utils/validatePrismaConfigWithDatasource.ts](packages/internals/src/utils/validatePrismaConfigWithDatasource.ts) — config validation now takes the full command string; lines 22-38.
  - [packages/internals/src/cli/checkUnsupportedDataProxy.ts](packages/internals/src/cli/checkUnsupportedDataProxy.ts) — unsupported-data-proxy guidance now echoes the caller-provided command; lines 8-31.
  - [packages/internals/src/get-generators/getGenerators.ts](packages/internals/src/get-generators/getGenerators.ts) — generator orchestration requires `cliCommand` and uses it for missing-model guidance; lines 56-78 and 128-136.
  - [packages/internals/src/utils/missingGeneratorMessage.ts](packages/internals/src/utils/missingGeneratorMessage.ts) — no-generator and missing-model diagnostics now render the selected executable; lines 6-59.
  - [packages/client-generator-registry/src/default.ts](packages/client-generator-registry/src/default.ts) — registry creation becomes invocation-scoped while keeping `defaultRegistry` explicitly ordinary; lines 6-18.
  - [packages/client-generator-js/src/resolvePrismaClient.ts](packages/client-generator-js/src/resolvePrismaClient.ts) — missing-client recovery reruns the selected executable, while low-level package resolution stays pinned to stable package names; lines 14-25 and 34-49.
- **Tests (evidence)**:
  - [packages/migrate/src/**tests**/MigrateCommand.test.ts](packages/migrate/src/__tests__/MigrateCommand.test.ts) — dual-identity help and unknown-command coverage for `migrate`; lines 39-53.
  - [packages/migrate/src/**tests**/DbCommand.test.ts](packages/migrate/src/__tests__/DbCommand.test.ts) — dual-identity help and unknown-command coverage for `db`; lines 39-53.
  - [packages/migrate/src/**tests**/runtime-guidance.test.ts](packages/migrate/src/__tests__/runtime-guidance.test.ts) — config validation, warning, non-interactive, and recovery guidance prove both names; lines 7-53.
  - [packages/internals/src/**tests**/getGenerators/getGenerators.test.ts](packages/internals/src/__tests__/getGenerators/getGenerators.test.ts) — missing-model guidance proves `prisma7` and the ordinary control; lines 657-758.
  - [packages/cli/src/**tests**/commands/Generate.test.ts](packages/cli/src/__tests__/commands/Generate.test.ts) — no-generator guidance uses the selected executable; lines 31-44.
  - [packages/client-generator-js/tests/resolvePrismaClient.test.ts](packages/client-generator-js/tests/resolvePrismaClient.test.ts) — missing-client recovery rerun command uses `prisma7` and keeps `prisma` explicit for the control; lines 15-40.
  - [packages/client-generator-registry/src/default.test.ts](packages/client-generator-registry/src/default.test.ts) — invocation-scoped registry keeps the same provider shape; lines 5-15.
  - [packages/client/tests/e2e/prisma7-compatibility/tests/main.test.ts](packages/client/tests/e2e/prisma7-compatibility/tests/main.test.ts) — packed installed-command proof for help, migrate/db/generate guidance, and negative ordinary-`prisma` checks; lines 286-558.

## The story

1. The branch turns executable identity into an explicit handoff: `packages/cli` decides whether the user invoked `prisma` or `prisma7`, then passes only that primitive downstream.
2. Migrate and db help stop being effectively static text and become instance-rendered surfaces, so help, examples, unknown-command output, and later recovery paths all speak with the same executable name.
3. Runtime guidance in migrate/db is then normalized around full command strings, which preserves existing package-manager/executor formatting while swapping only the executable token that users must rerun.
4. Generator diagnostics get the same treatment, but only for messages causally emitted by the current CLI invocation; the registry is made invocation-scoped so `prisma7` guidance cannot leak through shared mutable state.
5. The slice closes with packed installed-artifact proof that representative `prisma7 migrate`, `prisma7 db`, and `prisma7 generate` flows all surface actionable `prisma7` commands while stable Prisma names and the ordinary `prisma` control remain intact.

## Behavior changes & evidence

- **Required executable-name handoff from the CLI to lower layers**: lower packages no longer infer identity from `process.argv`, import CLI distribution code, or reach for ambient global state; they receive the selected executable name from the CLI-owned composition boundary.
  - **Why**: the slice spec requires the CLI to remain the identity owner, with lower packages depending only on a primitive string.
  - **Implementation**:
    - [packages/cli/src/bin.ts](packages/cli/src/bin.ts) — lines 100-134.
    - [packages/migrate/src/bin.ts](packages/migrate/src/bin.ts) — lines 46-66 keep the standalone migrate entrypoint explicitly ordinary by passing `'prisma'`.
  - **Tests**:
    - [packages/migrate/src/**tests**/MigrateCommand.test.ts](packages/migrate/src/__tests__/MigrateCommand.test.ts) — lines 39-53.
    - [packages/migrate/src/**tests**/DbCommand.test.ts](packages/migrate/src/__tests__/DbCommand.test.ts) — lines 39-53.

- **Migrate/db help and recovery now render the selected executable end-to-end**: help, examples, unknown-command output, validation errors, non-interactive guidance, data-loss guidance, and unexecutable-step recovery now point users at `prisma7 ...` when the command was reached through `prisma7`.
  - **Why**: actionable follow-up commands are part of the product surface; if they stay ordinary while the executable changes, the distribution feels internally inconsistent and can misdirect users.
  - **Implementation**:
    - [packages/migrate/src/commands/MigrateCommand.ts](packages/migrate/src/commands/MigrateCommand.ts) — lines 6-103.
    - [packages/migrate/src/commands/DbCommand.ts](packages/migrate/src/commands/DbCommand.ts) — lines 6-75.
    - [packages/migrate/src/utils/errors.ts](packages/migrate/src/utils/errors.ts) — lines 18-74.
    - [packages/migrate/src/utils/handleEvaluateDataloss.ts](packages/migrate/src/utils/handleEvaluateDataloss.ts) — lines 6-31.
    - [packages/internals/src/utils/validatePrismaConfigWithDatasource.ts](packages/internals/src/utils/validatePrismaConfigWithDatasource.ts) — lines 22-38.
    - [packages/internals/src/cli/checkUnsupportedDataProxy.ts](packages/internals/src/cli/checkUnsupportedDataProxy.ts) — lines 8-31.
  - **Tests**:
    - [packages/migrate/src/**tests**/runtime-guidance.test.ts](packages/migrate/src/__tests__/runtime-guidance.test.ts) — lines 7-53.
    - [packages/client/tests/e2e/prisma7-compatibility/tests/main.test.ts](packages/client/tests/e2e/prisma7-compatibility/tests/main.test.ts) — lines 295-315 and 537-558 prove `migrate status` config recovery and `db push` data-loss recovery through the packed `prisma7` binary.

- **Generator diagnostics are now invocation-scoped and identity-aware**: `generate` carries `cliCommand` into `getGenerators`, missing-generator and missing-model guidance renders the selected executable, and the built-in JS client generator gets a per-invocation registry so missing-`@prisma/client` recovery also points back at the active executable.
  - **Why**: generator diagnostics belong to the current CLI invocation, but generated-client runtime failures may occur later with no CLI context; the slice needed the former without spilling into the latter.
  - **Implementation**:
    - [packages/cli/src/Generate.ts](packages/cli/src/Generate.ts) — lines 149-170 and 319-328 pass the selected command into config validation, registry creation, and generator orchestration.
    - [packages/internals/src/get-generators/getGenerators.ts](packages/internals/src/get-generators/getGenerators.ts) — lines 56-78 and 128-136 require and consume `cliCommand`.
    - [packages/internals/src/utils/missingGeneratorMessage.ts](packages/internals/src/utils/missingGeneratorMessage.ts) — lines 6-59.
    - [packages/client-generator-registry/src/default.ts](packages/client-generator-registry/src/default.ts) — lines 6-18.
    - [packages/client-generator-js/src/resolvePrismaClient.ts](packages/client-generator-js/src/resolvePrismaClient.ts) — lines 14-25 and 34-49.
  - **Tests**:
    - [packages/cli/src/**tests**/commands/Generate.test.ts](packages/cli/src/__tests__/commands/Generate.test.ts) — lines 31-44.
    - [packages/internals/src/**tests**/getGenerators/getGenerators.test.ts](packages/internals/src/__tests__/getGenerators/getGenerators.test.ts) — lines 657-758.
    - [packages/client-generator-js/tests/resolvePrismaClient.test.ts](packages/client-generator-js/tests/resolvePrismaClient.test.ts) — lines 15-40.
    - [packages/client-generator-registry/src/default.test.ts](packages/client-generator-registry/src/default.test.ts) — lines 5-15.

- **Packed installed-command proof now covers the downstream boundary, not just CLI-owned surfaces**: the compatibility E2E extends the existing installed `prisma7` scenario to assert representative migrate, db, and generate guidance, including opposite-identity negatives.
  - **Why**: the slice done condition called for proof against a packed installed artifact, not only unit tests around constructors and helpers.
  - **Implementation**:
    - [packages/client/tests/e2e/prisma7-compatibility/tests/main.test.ts](packages/client/tests/e2e/prisma7-compatibility/tests/main.test.ts) — lines 286-315 create real installed-command scenarios; lines 537-558 assert downstream guidance.
  - **Tests**:
    - [packages/client/tests/e2e/prisma7-compatibility/tests/main.test.ts](packages/client/tests/e2e/prisma7-compatibility/tests/main.test.ts) — lines 286-558.

## Compatibility / migration / risk

- The behavioral contract is intentionally narrow: only actionable command/package guidance emitted during the active CLI or generator invocation changes.
- Stable Prisma domain names remain stable: `Prisma`, `schema.prisma`, `prisma.config.ts`, `prisma/`, `.prisma`, `@prisma/client`, docs URLs, environment variables, and low-level package resolution stay ordinary.
- The default ordinary path remains explicit, not implicit: standalone migrate and the exported `defaultRegistry` still pass `'prisma'`, which keeps existing consumers from inheriting `prisma7` accidentally.
- The main risk was identity leakage through shared generator state; the shift from a module-global default registry in CLI generate flows to `createDefaultRegistry(this.identity)` per invocation is the guardrail against that.

## Non-goals / intentionally out of scope

- Rebranding Prisma domain terminology, file names, package names, engine paths, or docs links.
- Propagating identity into generated-client runtime diagnostics that can fire later without an originating CLI invocation context.
- Adding a shared branding framework, global/env identity channel, CLI imports in lower packages, or protocol/RPC surface expansion.
- Release/publication work, package-manager acceptance, or broader Prisma 8 behavior beyond preserving the explicit ordinary-`prisma` control.
