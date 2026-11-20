Prisma 7 now carries the selected executable name all the way through downstream migrate/db/generate guidance, so actionable output reached through `prisma7` tells users to run `prisma7` while ordinary `prisma` behavior and stable Prisma domain names stay unchanged. This finishes the slice’s unpublished downstream guidance boundary without pulling release packaging into scope.

## Changes

- **Required primitive downstream transport**: `packages/cli/src/bin.ts` and `packages/cli/src/Generate.ts` remain the identity owners and now pass a required `cliCommand` primitive into `@prisma/migrate`, generator orchestration, and lower guidance helpers instead of letting lower layers infer CLI identity or depend on CLI types.
- **Migrate/db help and runtime guidance**: `packages/migrate/src/commands/*`, `packages/migrate/src/bin.ts`, and `packages/migrate/src/utils/errors.ts` make help, unknown-command output, validation guidance, data-loss prompts, and recovery text render the selected executable name, with explicit ordinary-`prisma` call sites preserved for standalone/default flows.
- **Generator diagnostics with invocation-scoped registry**: `packages/internals/src/get-generators/getGenerators.ts`, `packages/internals/src/utils/missingGeneratorMessage.ts`, `packages/client-generator-registry/src/default.ts`, and `packages/client-generator-js/src/resolvePrismaClient.ts` thread the same primitive through missing-model, no-generator, and missing-`@prisma/client` diagnostics, using an invocation-scoped registry instead of ambient shared identity state.
- **Packed evidence and review closure**: `packages/client/tests/e2e/prisma7-compatibility/tests/main.test.ts` extends the installed-artifact proof to cover representative `prisma7 migrate`, `db`, and `generate` guidance with positive `prisma7` and negative `prisma` assertions, and the slice docs/review record the final literal audit and downstream boundary verdict.

## Why

This approach keeps branding ownership at the CLI composition layer and transports only the smallest required primitive downstream, which avoids target branches, lower-package CLI imports, and global identity leakage between invocations or tests. It also preserves intentionally stable Prisma names and concepts — including `Prisma`, `Prisma Migrate`, `schema.prisma`, `prisma.config.ts`, `prisma/`, `.prisma`, `@prisma/client`, `PRISMA_*`, docs URLs, and engine/runtime paths — while producing an identity-complete artifact that a later release-focused slice can package and publish.

## Scope

In scope: downstream actionable guidance reachable from `prisma7 migrate`, `prisma7 db`, and `prisma7 generate`, plus focused dual-identity tests, packed compatibility evidence, and the final classified audit.

Out of scope: release/version rewriting and publication, package-manager acceptance work, generated-client runtime diagnostics that execute later without CLI invocation context, low-level dependency path rewriting, and any renaming of stable Prisma domain names.
