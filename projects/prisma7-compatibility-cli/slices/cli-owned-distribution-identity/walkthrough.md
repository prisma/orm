## Sources

- Commit range: `origin/v7...HEAD`
- Branch: `prisma7-cli-identity`
- Intent: [slice spec](projects/prisma7-compatibility-cli/slices/cli-owned-distribution-identity/spec.md), [slice plan](projects/prisma7-compatibility-cli/slices/cli-owned-distribution-identity/plan.md)
- Parent context: [project spec](projects/prisma7-compatibility-cli/spec.md), [project plan](projects/prisma7-compatibility-cli/plan.md)
- Review closure: [code review](projects/prisma7-compatibility-cli/reviews/code-review.md)

## Intent

Complete the CLI-owned `prisma7` identity slice by making identity selection explicit at CLI composition boundaries and proving the shipped behavior from packed artifacts. Product behavior stays within the CLI-owned identity seam, with only the workspace alias resolver adapted to bundle the new package entrypoints; stable Prisma domain names remain unchanged, and lower-package identity work is still follow-up scope.

## Change map

- **Implementation**:
  - [packages/cli/src/bin.ts](packages/cli/src/bin.ts) and [packages/cli/src/completions/completion-entry.ts](packages/cli/src/completions/completion-entry.ts) — infer identity only at the real executable entrypoints and pass it onward.
  - [packages/cli/src/CLI.ts](packages/cli/src/CLI.ts), [packages/cli/src/Init.ts](packages/cli/src/Init.ts), [packages/cli/src/Generate.ts](packages/cli/src/Generate.ts), [packages/cli/src/Version.ts](packages/cli/src/Version.ts), [packages/cli/src/bootstrap/Bootstrap.ts](packages/cli/src/bootstrap/Bootstrap.ts), [packages/cli/src/bootstrap/completion-output.ts](packages/cli/src/bootstrap/completion-output.ts), [packages/cli/src/init/ppg-output.ts](packages/cli/src/init/ppg-output.ts), [packages/cli/src/completions/Completions.ts](packages/cli/src/completions/Completions.ts), [packages/cli/src/SubCommand.ts](packages/cli/src/SubCommand.ts), [packages/cli/src/postgres/link/completion-output.ts](packages/cli/src/postgres/link/completion-output.ts), and [packages/cli/src/utils/global-local-version-mismatch.ts](packages/cli/src/utils/global-local-version-mismatch.ts) — render the selected executable across CLI-owned help, setup, diagnostics, and completion surfaces, and skip update consultation for `prisma7`.
  - [packages/cli/src/DebugInfo.ts](packages/cli/src/DebugInfo.ts), [packages/cli/src/Format.ts](packages/cli/src/Format.ts), [packages/cli/src/Status.ts](packages/cli/src/Status.ts), [packages/cli/src/Studio.ts](packages/cli/src/Studio.ts), [packages/cli/src/Validate.ts](packages/cli/src/Validate.ts), [packages/cli/src/mcp/MCP.ts](packages/cli/src/mcp/MCP.ts), [packages/cli/src/platform/$.ts](packages/cli/src/platform/$.ts), [packages/cli/src/postgres/PostgresCommand.ts](packages/cli/src/postgres/PostgresCommand.ts), [packages/cli/src/postgres/link/Link.ts](packages/cli/src/postgres/link/Link.ts), and [scripts/run-studio.ts](scripts/run-studio.ts) — require explicit identity wherever behavior depends on it.
  - [tsconfig.build.bundle.json](tsconfig.build.bundle.json) and [helpers/compile/plugins/resolvePathsPlugin.ts](helpers/compile/plugins/resolvePathsPlugin.ts) — resolve exact and wildcard Prisma package aliases to explicit files or package entrypoints during bundling.
- **Tests (evidence)**:
  - [packages/client/tests/e2e/prisma7-compatibility/tests/main.test.ts](packages/client/tests/e2e/prisma7-compatibility/tests/main.test.ts)
  - [packages/client/tests/e2e/prisma7-compatibility/\_steps.ts](packages/client/tests/e2e/prisma7-compatibility/_steps.ts)
  - [packages/cli/src/bootstrap/**tests**/Bootstrap.vitest.ts](packages/cli/src/bootstrap/__tests__/Bootstrap.vitest.ts)
  - [helpers/compile/plugins/resolvePathsPlugin.test.ts](helpers/compile/plugins/resolvePathsPlugin.test.ts)
  - [packages/cli/src/**tests**/commands/CLI.test.ts](packages/cli/src/__tests__/commands/CLI.test.ts)
  - [packages/cli/src/**tests**/commands/Generate.test.ts](packages/cli/src/__tests__/commands/Generate.test.ts)
  - [packages/cli/src/**tests**/Init.vitest.ts](packages/cli/src/__tests__/Init.vitest.ts)
  - [packages/cli/src/completions/completion-command.test.ts](packages/cli/src/completions/completion-command.test.ts)
  - [packages/cli/src/postgres/**tests**/PostgresCommand.vitest.ts](packages/cli/src/postgres/__tests__/PostgresCommand.vitest.ts)

## The story

1. Keep identity inference at the true executable boundary: `bin.ts` and the separate completion entrypoint decide between `prisma` and `prisma7`, and everything downstream receives that value explicitly.
2. Move every CLI-owned user-facing surface onto the selected executable without renaming stable Prisma domain surfaces such as `prisma/schema.prisma`, `prisma.config.ts`, or `@prisma/client`.
3. Replace slice-local mock evidence with one packed installed-artifact scenario whose command-local inline snapshots stay beside the invocation, while completion branding uses concise assertions instead of snapshotting the generated script.

## Behavior changes & evidence

- **Identity selection is now explicit at CLI-owned composition boundaries**: identity-sensitive constructors, factories, and helpers no longer silently fall back to ordinary Prisma; real entrypoints choose the identity once, and ordinary callers/tests pass `'prisma'` explicitly.
  - **Why**: this makes the seam mechanically auditable and keeps executable inference confined to the places where `process.argv[1]` is actually meaningful.
  - **Implementation**:
    - [packages/cli/src/bin.ts](packages/cli/src/bin.ts)
    - [packages/cli/src/completions/completion-entry.ts](packages/cli/src/completions/completion-entry.ts)
    - [packages/cli/src/platform/$.ts](packages/cli/src/platform/$.ts)
    - [packages/cli/src/postgres/PostgresCommand.ts](packages/cli/src/postgres/PostgresCommand.ts)
    - [packages/cli/src/postgres/link/Link.ts](packages/cli/src/postgres/link/Link.ts)
    - [scripts/run-studio.ts](scripts/run-studio.ts)
  - **Tests**:
    - [packages/cli/src/**tests**/commands/CLI.test.ts](packages/cli/src/__tests__/commands/CLI.test.ts)
    - [packages/cli/src/**tests**/commands/Generate.test.ts](packages/cli/src/__tests__/commands/Generate.test.ts)
    - [packages/cli/src/**tests**/Init.vitest.ts](packages/cli/src/__tests__/Init.vitest.ts)
    - [packages/cli/src/completions/completion-command.test.ts](packages/cli/src/completions/completion-command.test.ts)
    - [packages/cli/src/postgres/**tests**/PostgresCommand.vitest.ts](packages/cli/src/postgres/__tests__/PostgresCommand.vitest.ts)

- **CLI-owned help, setup, completion, and version surfaces now render the selected executable while stable Prisma names stay put**: the compatibility invocation says `prisma7` for commands and config imports it owns, but it leaves Prisma product terminology and domain-stable file/package names unchanged.
  - **Why**: the wrapper needs a coherent shell without pretending that every `prisma` string in the repository is a distribution label.
  - **Implementation**:
    - [packages/cli/src/CLI.ts](packages/cli/src/CLI.ts)
    - [packages/cli/src/Init.ts](packages/cli/src/Init.ts)
    - [packages/cli/src/Version.ts](packages/cli/src/Version.ts)
    - [packages/cli/src/Generate.ts](packages/cli/src/Generate.ts)
    - [packages/cli/src/bootstrap/completion-output.ts](packages/cli/src/bootstrap/completion-output.ts)
    - [packages/cli/src/init/ppg-output.ts](packages/cli/src/init/ppg-output.ts)
    - [packages/cli/src/completions/Completions.ts](packages/cli/src/completions/Completions.ts)
    - [packages/cli/src/SubCommand.ts](packages/cli/src/SubCommand.ts)
    - [packages/cli/src/postgres/link/completion-output.ts](packages/cli/src/postgres/link/completion-output.ts)
  - **Tests**:
    - [packages/client/tests/e2e/prisma7-compatibility/tests/main.test.ts](packages/client/tests/e2e/prisma7-compatibility/tests/main.test.ts)
    - [packages/cli/src/**tests**/Init.vitest.ts](packages/cli/src/__tests__/Init.vitest.ts)
    - [packages/cli/src/completions/completion-command.test.ts](packages/cli/src/completions/completion-command.test.ts)

- **Local execution and workspace alias resolution follow the selected distribution on every platform**: Bootstrap selects the bare local shim on Unix and the `.cmd` shim on Windows, while the build resolver handles both exact package aliases and wildcard config subpaths.
  - **Why**: explicit identity plumbing must survive both Windows package-manager shims and esbuild's tsconfig-path adaptation.
  - **Implementation / evidence**:
    - [packages/cli/src/bootstrap/Bootstrap.ts](packages/cli/src/bootstrap/Bootstrap.ts) and [packages/cli/src/bootstrap/**tests**/Bootstrap.vitest.ts](packages/cli/src/bootstrap/__tests__/Bootstrap.vitest.ts)
    - [tsconfig.build.bundle.json](tsconfig.build.bundle.json), [helpers/compile/plugins/resolvePathsPlugin.ts](helpers/compile/plugins/resolvePathsPlugin.ts), and [helpers/compile/plugins/resolvePathsPlugin.test.ts](helpers/compile/plugins/resolvePathsPlugin.test.ts)

- **Packed compatibility proof now lives in one deterministic installed-artifact scenario**: the slice removes four mock-heavy identity suites and the slice-added mock assertions, then exercises real packed `prisma7` commands with command-local inline snapshots. Completion branding is asserted directly without snapshotting the generated shell script.
  - **Why**: the reviewable proof should come from shipped commands, not constructor-level mock scaffolding, and each command's evidence should remain next to its invocation.
  - **Implementation / evidence**:
    - [packages/client/tests/e2e/prisma7-compatibility/tests/main.test.ts](packages/client/tests/e2e/prisma7-compatibility/tests/main.test.ts) runs `prisma7 --help`, `validate --help`, text/JSON `--version`, `complete zsh`, `init`, `generate`, and `db push`, then TypeScript-checks and runs the generated client smoke.
    - [packages/client/tests/e2e/prisma7-compatibility/\_steps.ts](packages/client/tests/e2e/prisma7-compatibility/_steps.ts) keeps that proof inside the existing single packed scenario.

## Compatibility / migration / risk

- Ordinary `prisma` behavior is preserved, but call sites and existing tests now pass `'prisma'` explicitly instead of relying on constructor defaults.
- Stable Prisma domain surfaces remain unchanged, including `prisma/schema.prisma`, `prisma.config.ts`, `@prisma/client`, docs URLs, and protocol names.
- Inline-snapshot normalization is intentionally narrow: it replaces cwd/temp/bin paths and projects `--version` output down to stable identity-bearing fields and metadata key/label sets.
- The packed proof is limited to command-visible behavior; it does not claim direct executable-boundary observation of checkpoint suppression or mismatch lookup internals.

## Follow-ups / open questions

- Propagate the selected executable through lower-package migrate, internals, and generator-owned guidance in `downstream-actionable-guidance`.
- Handle release mirroring and publication workflow in the later release slice.

## Non-goals / intentionally out of scope

- No lower-package identity propagation in this slice.
- No generic branding framework or backwards-compat identity shim.
- No release automation, publish ordering, or package-publication work.
