## Sources

- Commit range: `cf2bc1f4b2...be55dae684`
- Project intent: [projects/prisma7-config/spec.md](projects/prisma7-config/spec.md)
- Review ledger: [projects/prisma7-config/reviews/code-review.md](projects/prisma7-config/reviews/code-review.md)

## Intent

Let Prisma 7 and Prisma 8 coexist without competing for the same automatically discovered config file. Prisma 7 gains a canonical `prisma7.config.*` namespace while preserving existing `prisma.config.*` projects as a quiet compatibility path.

## Change map

- **Config selection and loading**:
  - [packages/config/src/loadConfigFromFile.ts](packages/config/src/loadConfigFromFile.ts)
  - [packages/config/src/index.ts](packages/config/src/index.ts)
- **Bootstrap parity**:
  - [packages/cli/src/bootstrap/project-state.ts](packages/cli/src/bootstrap/project-state.ts)
- **Init and guidance**:
  - [packages/cli/src/Init.ts](packages/cli/src/Init.ts)
  - [packages/internals/src/cli/completion-values.ts](packages/internals/src/cli/completion-values.ts)
  - [packages/internals/src/cli/getSchema.ts](packages/internals/src/cli/getSchema.ts)
  - [packages/migrate/src/**tests**/config-guidance.test.ts](packages/migrate/src/__tests__/config-guidance.test.ts)
- **Tests as evidence**:
  - [packages/config/src/**tests**/loadConfigFromFile.test.ts](packages/config/src/__tests__/loadConfigFromFile.test.ts)
  - [packages/cli/src/bootstrap/**tests**/project-state.vitest.ts](packages/cli/src/bootstrap/__tests__/project-state.vitest.ts)
  - [packages/cli/src/**tests**/Init.vitest.ts](packages/cli/src/__tests__/Init.vitest.ts)
  - [packages/client/tests/e2e/prisma7-compatibility/tests/main.test.ts](packages/client/tests/e2e/prisma7-compatibility/tests/main.test.ts)

## The story

1. Define one deterministic Prisma 7 discovery order: all root `prisma7.config.*` candidates, then all `.config/prisma7.*` candidates, then the existing c12-backed legacy search.
2. Make the selected versioned file authoritative. Only absence reaches legacy discovery; a broken versioned config reports its own path and error instead of silently loading another contract.
3. Share supported JavaScript/TypeScript selection with bootstrap without importing project code. Project detection and seed inspection cover the versioned family and supported legacy flat and `index.*` forms, without adding legacy data-format candidates.
4. Teach the new convention everywhere a user creates or is directed to a concrete default file. Both CLI identities generate `prisma7.config.ts`, while retaining their respective config-package imports.
5. Verify the contract at the installed-package boundary through both Prisma 7 entrypoints, rather than relying only on loader unit tests.

## Behavior changes & evidence

- **Prisma 7-specific files take precedence across the full supported family**: automatic discovery checks `prisma7.config.{js,ts,mjs,cjs,mts,cts}` at the root, then `.config/prisma7.*`, before legacy candidates. Explicit config paths still win, and paths declared inside either versioned location remain relative to the selected file.
  - **Why**: Prisma 7 needs an independent namespace, but should retain the loader's existing extension and path-resolution behavior.
  - **Implementation**:
    - [packages/config/src/loadConfigFromFile.ts](packages/config/src/loadConfigFromFile.ts)
  - **Tests**:
    - [packages/config/src/**tests**/loadConfigFromFile.test.ts](packages/config/src/__tests__/loadConfigFromFile.test.ts)

- **Fallback is absence-only and quiet**: a selected versioned file that cannot load or validate now hard-fails with that file's attribution. When no versioned candidate exists, legacy `prisma.config.*` discovery continues without a new warning; when neither family exists, the default config remains unchanged.
  - **Why**: falling through after a versioned-file error could conceal a migration problem by loading a potentially different Prisma 8 contract, while warning on normal legacy use would disrupt backward-compatible automation.
  - **Implementation**:
    - [packages/config/src/loadConfigFromFile.ts](packages/config/src/loadConfigFromFile.ts)
  - **Tests**:
    - [packages/config/src/**tests**/loadConfigFromFile.test.ts](packages/config/src/__tests__/loadConfigFromFile.test.ts)
    - [packages/client/tests/e2e/prisma7-compatibility/tests/main.test.ts](packages/client/tests/e2e/prisma7-compatibility/tests/main.test.ts)

- **Bootstrap matches supported runtime selection without executing config**: project-state detection and seed inspection use the exported non-executing selector instead of checking only `prisma.config.ts`. Its legacy mirror covers supported JavaScript/TypeScript flat and `index.*` candidates in c12 order, while deliberately excluding JSON, JSONC, JSON5, YAML, YML, and TOML. `package.json` remains the first source for seed commands.
  - **Why**: bootstrap must not initialize over an existing project or inspect seed metadata from a lower-precedence file, and it must not execute arbitrary project config merely to detect state.
  - **Implementation**:
    - [packages/config/src/loadConfigFromFile.ts](packages/config/src/loadConfigFromFile.ts)
    - [packages/cli/src/bootstrap/project-state.ts](packages/cli/src/bootstrap/project-state.ts)
  - **Tests**:
    - [packages/config/src/**tests**/loadConfigFromFile.test.ts](packages/config/src/__tests__/loadConfigFromFile.test.ts)
    - [packages/cli/src/bootstrap/**tests**/project-state.vitest.ts](packages/cli/src/bootstrap/__tests__/project-state.vitest.ts)

- **New projects and concrete guidance use `prisma7.config.ts`**: `prisma init` and `prisma7 init` write only the versioned filename. Generated contents continue to import from `prisma/config` or `@prisma/prisma7/config` according to CLI identity, and completion, Studio/Validate examples, schema errors, migrate help, seed instructions, and initialization output point to the same filename. Generic references remain “Prisma config file.”
  - **Why**: generated files and guidance must advertise the filename runtime discovery actually prefers.
  - **Implementation**:
    - [packages/cli/src/Init.ts](packages/cli/src/Init.ts)
    - [packages/cli/src/Studio.ts](packages/cli/src/Studio.ts)
    - [packages/cli/src/Validate.ts](packages/cli/src/Validate.ts)
    - [packages/internals/src/cli/completion-values.ts](packages/internals/src/cli/completion-values.ts)
    - [packages/internals/src/cli/getSchema.ts](packages/internals/src/cli/getSchema.ts)
    - [packages/migrate/src/commands/DbSeed.ts](packages/migrate/src/commands/DbSeed.ts)
  - **Tests**:
    - [packages/cli/src/**tests**/Init.vitest.ts](packages/cli/src/__tests__/Init.vitest.ts)
    - [packages/cli/src/completions/completion-command.test.ts](packages/cli/src/completions/completion-command.test.ts)
    - [packages/migrate/src/**tests**/config-guidance.test.ts](packages/migrate/src/__tests__/config-guidance.test.ts)

- **The packed distribution proves both entrypoints share the contract**: the compatibility E2E runs precedence, versioned-file failure, exact quiet legacy fallback, and init assertions through installed `.bin/prisma7` and the packed transitive `prisma/build/index.js` entry. It also checks each identity's generated import while preserving the existing generated-client smoke coverage.
  - **Why**: source-level tests alone cannot prove package topology and both shipped entrypoints expose the same behavior.
  - **Tests**:
    - [packages/client/tests/e2e/prisma7-compatibility/tests/main.test.ts](packages/client/tests/e2e/prisma7-compatibility/tests/main.test.ts)

## Compatibility / migration / risk

- Existing projects that only contain `prisma.config.*` need no rename and receive no new fallback warning; the installed E2E locks the existing loaded-file diagnostic exactly.
- An explicit `--config` path remains authoritative regardless of filename.
- A present but invalid `prisma7.config.*` intentionally blocks legacy fallback. Fix or remove that file to resume legacy discovery.
- Bootstrap's non-executing legacy selector mirrors the supported JavaScript/TypeScript portion of c12 3.3.4 discovery; parity tests cover flat/index locations and ordering, and exclusion tests ensure data-format candidates are not added.
- The review ledger records all 12 acceptance criteria as passing with no open findings, backed by the linked loader, bootstrap, init/guidance, and packed E2E tests.

## Non-goals / intentionally out of scope

- Prisma 8 config parsing, validation, or discovery behavior.
- Config conversion, merging, synchronization, or deprecation warnings.
- Changes to explicit `--config` semantics or unrelated Prisma filenames and terminology.
