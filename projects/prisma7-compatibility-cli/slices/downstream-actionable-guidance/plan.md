## Dispatch plan

### Dispatch 1: make migrate help identity-explicit

- **Outcome:** Every `migrate` and `db` command factory that renders help requires a CLI executable name, and its usage, examples, help errors, and unknown-command output render that name; all ordinary call sites pass `'prisma'` explicitly.
- **Builds on:** The slice spec's required primitive handoff and the CLI-owned identity selected in `packages/cli/src/bin.ts`.
- **Hands to:** Instance-bound migrate/db command help with no hidden ordinary-identity fallback and focused dual-identity proof for command-group and representative leaf help paths.
- **Focus:** Tests first; migrate/db command construction, static-to-instance help conversion, CLI and standalone migrate composition, ordinary test call-site migration, and help-only actionable literals. Runtime recovery messages and generator diagnostics remain for later dispatches.
- **Validation gate:** `pnpm --filter @prisma/migrate build`; migrate package typecheck/test scripts covering command help; affected CLI typecheck/tests; root dependency lint; Prettier; `git diff --check`; mandatory transient-ID scan.

### Dispatch 2: propagate identity through migrate runtime guidance

- **Outcome:** Runtime errors, warnings, successful next steps, and recovery instructions emitted by `migrate`/`db` subcommands render the required executable name while package-manager executor formatting and ordinary Prisma output remain unchanged.
- **Builds on:** Dispatch 1's identity-explicit command instances and ordinary call-site migration.
- **Hands to:** An exhaustively identity-aware `@prisma/migrate` user-guidance surface, including utilities and nested error construction, with representative behavior tests.
- **Focus:** Tests first; dynamic `getCommandWithExecutor` inputs, plain command literals in runtime messages, utility/error parameters, data-loss handling, and a classified migrate literal audit. Keep Prisma domain terminology, comments, docs, paths, and disabled `DbDrop` scope classified rather than blindly replaced.
- **Validation gate:** `pnpm --filter @prisma/migrate build`; affected migrate tests and snapshots; affected CLI tests; root dependency lint; Prettier; `git diff --check`; mandatory transient-ID scan.

### Dispatch 3: propagate identity through generator diagnostics

- **Outcome:** Missing-model and missing-`@prisma/client` diagnostics causally emitted by `prisma7 generate` recommend the selected executable, using invocation-scoped primitive transport with no CLI import or ambient global state.
- **Builds on:** The CLI-owned `Generate` identity seam and the spec's boundary between active-invocation diagnostics and later generated-client runtime errors.
- **Hands to:** Identity-aware generator orchestration and built-in client-generator recovery messages, with ordinary Prisma callers explicit and lower package layering preserved.
- **Focus:** Tests first; required `cliCommand` transport through `getGenerators`; missing-model message renderers; invocation-scoped default-registry/client-generator configuration; missing-client recovery command; all call-site migrations. Do not add identity to generator RPC protocol/options unless evidence shows a user-facing consumer requires it; do not alter generated-client runtime diagnostics or low-level resolved paths.
- **Validation gate:** builds and local typecheck/test scripts for `@prisma/internals`, client generator registry, client generator JS, and `prisma`; focused generator diagnostic tests; root dependency lint; Prettier; `git diff --check`; mandatory transient-ID scan.

### Dispatch 4: prove the complete downstream boundary

- **Outcome:** The packed compatibility E2E exercises representative installed `prisma7 migrate`, `db`, and `generate` guidance, ordinary Prisma regressions remain green, and an exhaustive classified audit finds no unclassified actionable distribution literal in the slice scope.
- **Builds on:** Dispatch 2's migrate guidance and Dispatch 3's generator diagnostics.
- **Hands to:** A complete unpublished Prisma7 artifact ready for `release-mirroring-and-package-proof`, plus reviewable evidence and an explicit classification of intentional ordinary-Prisma references.
- **Focus:** Real-command evidence over new mock-heavy identity suites; command-local inline snapshots or concise assertions as appropriate; retain the existing packed generate/db-push/client smoke; classify stable domain names, inactive/generated-runtime surfaces, comments, and low-level paths. Fix only audit escapees inside the slice contract.
- **Validation gate:** Prisma, Prisma7, migrate, internals, client-generator-registry, and client-generator-js builds; exact workspace typecheck; affected package tests; packed `prisma7-compatibility` E2E; root lint, dependency lint, and Prettier; `git diff --check`; mandatory transient-ID scan.

### Dispatch 5: close full-suite constructor migration

- **Outcome:** Full migrate and cross-platform package suites use the required `DbPull` executable contract instead of constructing instances with an undefined runtime identity.
- **Builds on:** Dispatch 1's required factories and CI evidence that legacy tests bypassed the private TypeScript constructor at runtime.
- **Hands to:** Green Migrate jobs on all Node versions and green macOS/Windows package suites without weakening the required production API.
- **Focus:** Mechanically migrate every direct `new DbPull()` test/helper call to `DbPull.new('prisma')`; audit all other required migrate command classes for direct-constructor bypasses; preserve existing ordinary snapshots and do not add a fallback/default merely to accommodate tests.
- **Validation gate:** exhaustive direct-constructor grep; full `@prisma/migrate` test command with available databases/engines; affected cross-platform package tests where locally reproducible; migrate/CLI builds and exact workspace typecheck; Prettier; `git diff --check`; mandatory transient-ID scan.

### Dispatch 6: close current review comments

- **Outcome:** Every current PR review thread is resolved with required rejection evidence, opposite-identity negatives, identity-aware `DbDrop` help, and side-effect-free unsupported-URL validation ordering.
- **Builds on:** Dispatch 5's green constructor contract and the five current CodeRabbit findings against changed test/command surfaces.
- **Hands to:** A review-complete PR with focused tests proving each corrected behavior and no weakened identity contract.
- **Focus:** Require the ordinary missing-client test to reject; strengthen DbCommand/DbExecute negative assertions; replace the duplicate incorrect `.resolves.toThrow()` case with a resolved-Error assertion; render dormant `DbDrop` help from required `cliCommand`; reject unsupported Data Proxy reset URLs before datasource parsing/output. Keep changes minimal and do not broaden dormant `DbDrop` wiring.
- **Validation gate:** focused client-generator and migrate tests; migrate/client-generator builds; exact workspace typecheck; Prettier; `git diff --check`; mandatory transient-ID scan.
