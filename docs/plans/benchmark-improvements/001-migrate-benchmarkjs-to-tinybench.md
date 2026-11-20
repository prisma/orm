# Task: Migrate from Benchmark.js to Tinybench

## Overview

Migrate all benchmark files from `benchmark.js` (legacy, unmaintained) to `tinybench` (modern, maintained). This involves updating the benchmarking library, plugin, and refactoring all benchmark files to use the tinybench API.

## Rationale

- `benchmark.js` is unmaintained (last release 2016)
- `tinybench` is actively maintained with modern ESM support
- CodSpeed provides a `@codspeed/tinybench-plugin` (v5.0.1) which is already at version parity with the benchmark.js plugin
- tinybench has cleaner async/await API without the need for `deferred` pattern

## Scope

### Files to Modify

1. **Root `package.json`** - No direct codspeed dependency here, only uses scripts
2. **`packages/client/package.json`** - Replace `@codspeed/benchmark.js-plugin` and `benchmark` with tinybench equivalents
3. **`packages/client-engine-runtime/package.json`** - Replace dependencies
4. **`packages/get-platform/package.json`** - Replace dependencies

### Benchmark Files to Refactor

1. `packages/client/src/__tests__/benchmarks/query-performance/query-performance.bench.ts`
2. `packages/client/src/__tests__/benchmarks/query-performance/compilation.bench.ts`
3. `packages/client/src/__tests__/benchmarks/huge-schema/huge-schema.bench.ts`
4. `packages/client/src/__tests__/benchmarks/lots-of-relations/lots-of-relations.bench.ts`
5. `packages/client-engine-runtime/bench/interpreter.bench.ts`
6. `packages/get-platform/bench/get-platform.bench.ts`

## Migration Steps

### Step 1: Update Dependencies

For each package with benchmarks, replace:

```json
// Before
"@codspeed/benchmark.js-plugin": "4.0.0",
"@types/benchmark": "2.1.5",
"benchmark": "2.1.4",

// After
"@codspeed/tinybench-plugin": "5.0.1",
"tinybench": "^4.0.1",
```

### Step 2: Refactor Benchmark Files

#### API Changes

**Imports:**

```typescript
// Before
import { withCodSpeed } from '@codspeed/benchmark.js-plugin'
import Benchmark from 'benchmark'

// After
import { withCodSpeed } from '@codspeed/tinybench-plugin'
import { Bench } from 'tinybench'
```

**Suite Creation:**

```typescript
// Before
const suite = withCodSpeed(new Benchmark.Suite('suite-name'))

// After
const bench = withCodSpeed(new Bench({ name: 'suite-name' }))
```

**Adding Sync Benchmarks:**

```typescript
// Before
suite.add('benchmark name', {
  fn: function () {
    doSomething()
  },
})

// After
bench.add('benchmark name', () => {
  doSomething()
})
```

**Adding Async Benchmarks (major simplification):**

```typescript
// Before (deferred pattern)
suite.add('benchmark name', {
  defer: true,
  fn: function (deferred: Benchmark.Deferred) {
    doSomethingAsync()
      .then(() => deferred.resolve())
      .catch((err) => {
        console.error(err)
        process.exit(1)
      })
  },
})

// After (native async/await)
bench.add('benchmark name', async () => {
  await doSomethingAsync()
})
```

**Running and Output:**

```typescript
// Before
suite
  .on('cycle', (event: Benchmark.Event) => {
    console.log(String(event.target))
  })
  .on('complete', () => {
    console.log('Benchmarks complete.')
  })
  .run({ async: true })

// After
await bench.run()
console.table(bench.table())
```

### Step 3: Update Documentation

Update `docs/benchmarking.md` to reflect tinybench API:

- Update code examples
- Update "Adding New Benchmarks" section
- Update troubleshooting section

### Step 4: Run and Verify

```bash
# Run all benchmarks locally
pnpm bench

# Run specific benchmark
pnpm bench query-performance

# Verify CodSpeed integration
CODSPEED_BENCHMARK=true pnpm bench
```

## Verification Checklist

- [ ] All benchmark files use tinybench API
- [ ] No references to `benchmark` or `@codspeed/benchmark.js-plugin` in package.json files
- [ ] `pnpm bench` runs successfully
- [ ] `pnpm bench-stdout-only` runs successfully
- [ ] CI benchmark workflow passes
- [ ] CodSpeed dashboard shows benchmark results
- [ ] Documentation updated with tinybench examples

## Notes

- The `rhysd/github-action-benchmark@v1` action in CI still works with tinybench output format
- Error handling in tinybench is simpler—uncaught exceptions will fail the benchmark
- Consider adding `{ throws: true }` to Bench options for better error visibility
