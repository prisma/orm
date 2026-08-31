# Testing

- Core guide: `docs/Testing Guide.md`
- Language: `.cursor/rules/omit-should-in-tests.mdc`
- Patterns: `.cursor/rules/vitest-expect-typeof.mdc`, `.cursor/rules/test-file-organization.mdc`, `.cursor/rules/test-import-patterns.mdc`

## Test Commands

```bash
pnpm test:packages      # Unit tests for packages only
pnpm test:integration   # Integration tests (pretest builds first)
pnpm test:e2e           # End-to-end tests
pnpm test:all           # All tests (packages + examples + integration + e2e)
pnpm coverage:packages        # Build package prerequisites, then run package coverage once at the root
pnpm coverage:packages:merge  # CI fan-in: merge native shard blobs into one coverage report
pnpm coverage:report          # Report package policy results from the existing root coverage output
```

Package coverage policies live in `coverage.config.json` beside each package's `vitest.config.ts`. A local root run executes all package Vitest projects in one process. CI executes four native Vitest shards with partial-run thresholds disabled, uploads their blobs, and has `Coverage` verify and merge all four before applying thresholds. A lightweight final `Test` job requires package shards, coverage, and examples to pass while preserving the required status name. Each entry in `coverage/coverage-final.json` is attributed to the package that owns the entry's source path. Examples do not contribute to package coverage. Root warning-only entries relax thresholds only; Vitest assertion failures always block.

> Integration tests (`test/integration`) run against each package's built `dist`, not its source. After changing a package's source, rebuild it (e.g. `pnpm --filter <pkg> build`) before running a bare `vitest` filter, or the test will exercise stale output. The full `pnpm test:integration` pretest builds automatically, so this only bites targeted runs.

## CI

CI runs on pull requests via GitHub Actions (`.github/workflows/ci.yml`):

- **typecheck** + **lint**: Run in parallel, no dependencies
- **build**: Compiles all packages
- **test-packages**: Runs package tests and coverage across four Vitest shards, uploading one blob per shard; requires Postgres
- **test-examples**: Tests examples concurrently with the package shards; requires Postgres
- **coverage**: Downloads and verifies every shard blob, merges coverage, and applies package thresholds
- **test** (`Test`): Preserves the required check name as a lightweight final gate over package shards, coverage, and examples
- **test-e2e**: Runs after build and requires Postgres

Environment: Node 24.16.0, pnpm 10, Postgres 15. `TEST_TIMEOUT_MULTIPLIER=2` in CI.
