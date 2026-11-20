# Task: Clean Up Legacy Benchmark Code

## Overview

Remove deprecated patterns, unused code, and clean up the benchmark infrastructure after completing the migration to tinybench and refinements to the benchmark suite.

## Rationale

- Legacy Benchmark.js patterns may remain after migration
- Unused helper functions and type definitions should be removed
- Code organization can be improved for maintainability
- Consistent coding style across all benchmark files

## Scope

### Files to Review for Cleanup

1. **Benchmark Files**
   - `packages/client/src/__tests__/benchmarks/query-performance/query-performance.bench.ts`
   - `packages/client/src/__tests__/benchmarks/query-performance/compilation.bench.ts`
   - `packages/client/src/__tests__/benchmarks/huge-schema/huge-schema.bench.ts`
   - `packages/client/src/__tests__/benchmarks/lots-of-relations/lots-of-relations.bench.ts`
   - `packages/client-engine-runtime/bench/interpreter.bench.ts`
   - `packages/get-platform/bench/get-platform.bench.ts`

2. **Helper Files**
   - `packages/client/src/__tests__/benchmarks/query-performance/seed-data.ts`
   - `packages/client/src/__tests__/benchmarks/huge-schema/builder.ts`
   - `packages/client/src/__tests__/benchmarks/lots-of-relations/builder.ts`

3. **Package Configuration**
   - Remove unused `@types/benchmark` if still present
   - Remove `benchmark` package if not needed
   - Clean up any duplicate dependencies

## Cleanup Tasks

### 1. Remove Legacy Patterns

| Pattern                             | Action                              |
| ----------------------------------- | ----------------------------------- |
| `@ts-nocheck` comments              | Remove and fix type errors properly |
| `// eslint-disable` comments        | Remove and fix linting issues       |
| Deferred callback pattern           | Replace with async/await            |
| Manual error handling in benchmarks | Use framework's error handling      |
| Unused imports                      | Remove dead imports                 |

### 2. Remove Unused Code

Check for and remove:

- [ ] Unused helper functions in benchmark files
- [ ] Deprecated wrapper functions (e.g., `deferredBench`, `syncBench`)
- [ ] Commented-out code blocks
- [ ] Unused type definitions
- [ ] Dead code paths

### 3. Standardize Code Style

Apply consistent patterns across all benchmark files:

**File structure:**

```typescript
// 1. Imports
import { withCodSpeed } from '@codspeed/tinybench-plugin'
import { Bench } from 'tinybench'

// 2. Constants/Configuration
const BENCHMARK_CONFIG = { ... }

// 3. Helper functions
function setupBenchmark() { ... }

// 4. Benchmark definitions
async function runBenchmarks() {
  const bench = withCodSpeed(new Bench({ name: '...' }))
  // ...
}

// 5. Entry point
runBenchmarks().catch(console.error)
```

**Naming conventions:**

- Benchmark names: `category: specific operation`
- Helper functions: `camelCase`
- Constants: `UPPER_SNAKE_CASE`

### 4. Remove Duplicate Type Definitions

Check for duplicated types across files:

- Query plan types
- Result structure types
- Configuration types

Consider extracting shared types to:

- `packages/client/src/__tests__/benchmarks/shared/types.ts`
- Or importing from existing packages

### 5. Clean Up Dependencies

After tinybench migration, verify these are removed:

```json
// Should NOT be present after migration
"@codspeed/benchmark.js-plugin": "...",
"@types/benchmark": "...",
"benchmark": "..."
```

## Specific Files to Clean

### huge-schema.bench.ts

Current issues:

- `@ts-nocheck` at top of file
- Manual error handling with `process.exit(1)`
- Mixed patterns for sync/async

Actions:

- [ ] Remove `@ts-nocheck`, fix type errors
- [ ] Use tinybench native error handling
- [ ] Simplify benchmark structure

### lots-of-relations.bench.ts

Current issues:

- `@ts-nocheck` at top of file
- `@ts-ignore` and `eslint-disable` comments

Actions:

- [ ] Remove suppressions, fix underlying issues
- [ ] Modernize to tinybench patterns

### interpreter.bench.ts

Current issues:

- Large inline query plan definitions
- Helper functions that may be obsolete after tinybench migration

Actions:

- [ ] Consider extracting query plans to separate file
- [ ] Remove `deferredBench`/`syncBench` helpers
- [ ] Use async functions directly

### query-performance.bench.ts

Current issues:

- Large inline schema creation SQL
- Mixed patterns for benchmark definition

Actions:

- [ ] Consider schema setup improvements
- [ ] Standardize benchmark registration pattern
- [ ] Review helper functions for relevance

### compilation.bench.ts

Current issues:

- Large inline datamodel string
- Large inline query definitions

Actions:

- [ ] Consider extracting query definitions to separate file
- [ ] Review for consistency with other benchmarks

## Verification Steps

After cleanup:

```bash
# Verify no type errors
pnpm tsc --noEmit

# Verify linting passes
pnpm lint

# Verify all benchmarks still work
pnpm bench

# Verify formatting
pnpm format --check
```

## Cleanup Checklist

- [ ] All `@ts-nocheck` comments removed
- [ ] All `@ts-ignore` comments removed or justified
- [ ] All `eslint-disable` comments removed or justified
- [ ] No unused imports
- [ ] No dead code
- [ ] No duplicate type definitions
- [ ] Consistent file structure across benchmarks
- [ ] Consistent naming conventions
- [ ] Legacy dependencies removed from package.json
- [ ] `pnpm lint` passes
- [ ] `pnpm build` succeeds
- [ ] `pnpm bench` runs successfully

## Code Quality Standards

After cleanup, all benchmark files should:

1. **Pass type checking** without suppressions
2. **Pass linting** without disables
3. **Follow project conventions** (kebab-case files, camelCase functions)
4. **Be self-documenting** with clear names and minimal comments
5. **Handle errors gracefully** using framework patterns
6. **Be maintainable** with clear structure and organization

## Dependencies

- Task 001: Migrate to tinybench (must complete first)
- Task 003: Review query benchmarks (may identify more cleanup)
- Task 004: Review interpreter benchmarks (may identify more cleanup)

## Related Tasks

- Task 001: Migration introduces new patterns to follow
- Task 006: Documentation should reflect clean code patterns

## Notes

- Do NOT remove code that appears unused without verifying
- Some patterns may be intentional for CodSpeed compatibility
- Test thoroughly after each cleanup change
- Consider incremental cleanup rather than big-bang changes
- Keep git commits small and focused for easy review/revert
