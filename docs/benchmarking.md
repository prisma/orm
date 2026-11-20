# Prisma Benchmarking Guide

This document describes the benchmarking infrastructure for Prisma's query compiler and client packages. It covers how to run benchmarks, interpret results, add new benchmarks, and profile performance.

## Overview

Prisma uses [Benchmark.js](https://benchmarkjs.com/) with [CodSpeed](https://codspeed.io/) integration for reliable, continuous performance tracking. Benchmarks are automatically run on CI for every push to `main` and on pull requests.

### Benchmark Categories

1. **End-to-End Query Performance** (`packages/client`)
   - Full query lifecycle with real database (SQLite/better-sqlite3)
   - Tests actual PrismaClient operations
   - Measures complete stack including driver adapter

2. **Query Compilation Performance** (`packages/client`)
   - Wasm query compiler performance
   - JSON protocol to query plan compilation
   - Compiler instantiation overhead

3. **Query Interpreter Performance** (`packages/client-engine-runtime`)
   - Query plan execution overhead
   - Data mapper performance
   - SQL serialization performance
   - Uses mock adapter to isolate interpreter overhead

## Running Benchmarks

### Prerequisites

```bash
# From repository root
pnpm install
pnpm build
```

### Run All Benchmarks

```bash
# Run all benchmarks (outputs to output.txt)
pnpm bench

# Run without file output (for CodSpeed CI)
pnpm bench-stdout-only
```

### Run Specific Benchmarks

```bash
# Filter by pattern
pnpm bench query-performance
pnpm bench compilation
pnpm bench interpreter

# Run a specific benchmark file directly
node -r esbuild-register packages/client/src/__tests__/benchmarks/query-performance/query-performance.bench.ts
node -r esbuild-register packages/client/src/__tests__/benchmarks/query-performance/compilation.bench.ts
node -r esbuild-register packages/client-engine-runtime/bench/interpreter.bench.ts
```

### Run with CodSpeed Locally

```bash
# Set the environment variable to enable CodSpeed mode
CODSPEED_BENCHMARK=true pnpm bench
```

## Benchmark Files

### Query Performance Benchmarks

**Location:** `packages/client/src/__tests__/benchmarks/query-performance/`

| File                         | Description                                  |
| ---------------------------- | -------------------------------------------- |
| `query-performance.bench.ts` | End-to-end query benchmarks with SQLite      |
| `compilation.bench.ts`       | Query compiler benchmarks                    |
| `schema.prisma`              | Benchmark schema with typical web app models |
| `seed-data.ts`               | Data generation utilities                    |
| `prisma.config.ts`           | Prisma configuration for benchmarks          |

### Interpreter Benchmarks

**Location:** `packages/client-engine-runtime/bench/`

| File                   | Description                                  |
| ---------------------- | -------------------------------------------- |
| `interpreter.bench.ts` | Query interpreter and data mapper benchmarks |

### Legacy Benchmarks

**Location:** `packages/client/src/__tests__/benchmarks/`

| File                 | Description                               |
| -------------------- | ----------------------------------------- |
| `huge-schema/`       | Client generation benchmarks (~50 models) |
| `lots-of-relations/` | Client generation with many relations     |

## Benchmark Scenarios

### Query Performance (End-to-End)

These benchmarks test realistic query patterns:

#### Simple Read Operations

- `findUnique by id` - Primary key lookup
- `findUnique by unique field` - Unique constraint lookup
- `findFirst with simple where` - Basic filtering

#### List Operations

- `findMany 10/50/100 records` - Various result sizes
- `findMany with orderBy` - Ordered queries
- `findMany with filter` - Filtered queries
- `findMany with pagination` - Skip/take pagination

#### Relation Loading

- `findUnique with 1:1 include` - One-to-one relations
- `findUnique with 1:N include` - One-to-many relations
- `findMany with nested includes` - Multi-level includes
- `findMany with deep nested includes` - Complex relation trees

#### Write Operations

- `create single record` - Basic inserts
- `create with nested` - Insert with relations
- `update single record` - Updates
- `updateMany` - Bulk updates
- `upsert` - Insert or update

#### Aggregations

- `count all/filtered` - Count queries
- `aggregate sum/avg` - Aggregate functions
- `groupBy with count` - Grouping

#### Realistic Patterns

- `blog post page query` - Post with author, comments, tags
- `blog listing page query` - Paginated post list
- `user profile page query` - User with posts and stats
- `order history query` - Orders with items and products
- `dashboard stats query` - Multiple aggregations

### Query Compilation

These benchmarks measure compiler performance:

- Simple queries (findUnique, findMany)
- Complex filters (OR, AND, nested conditions)
- Queries with includes (1:1, 1:N, nested)
- Write operations (create, update, upsert, delete)
- Aggregations (count, aggregate, groupBy)
- Realistic page queries

### Interpreter Performance

These benchmarks measure execution overhead:

- Query plan interpretation
- Data mapping (10/50/100 rows)
- Nested data mapping
- SQL serialization
- Join operations

## Adding New Benchmarks

### Creating a Query Performance Benchmark

```typescript
// packages/client/src/__tests__/benchmarks/your-benchmark/your.bench.ts
import { withCodSpeed } from '@codspeed/benchmark.js-plugin'
import Benchmark from 'benchmark'

async function runBenchmarks(): Promise<void> {
  // Setup code here...

  const suite = withCodSpeed(new Benchmark.Suite('your-benchmark-name'))

  // Async benchmark
  suite.add('benchmark name', {
    defer: true,
    fn: function (deferred: Benchmark.Deferred) {
      yourAsyncFunction()
        .then(() => deferred.resolve())
        .catch((err) => {
          console.error('Benchmark error:', err)
          process.exit(1)
        })
    },
  })

  // Sync benchmark
  suite.add('sync benchmark', {
    fn: function () {
      yourSyncFunction()
    },
  })

  // Run suite
  await new Promise<void>((resolve) => {
    suite
      .on('cycle', (event: Benchmark.Event) => {
        console.log(String(event.target))
      })
      .on('complete', () => {
        console.log('Benchmarks complete.')
        resolve()
      })
      .run({ async: true })
  })
}

runBenchmarks().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
```

### Creating an Interpreter Benchmark

```typescript
// packages/client-engine-runtime/bench/your.bench.ts
import { withCodSpeed } from '@codspeed/benchmark.js-plugin'
import Benchmark from 'benchmark'
import { QueryInterpreter } from '../src/interpreter/query-interpreter'

// Create mock adapter, define query plans, etc.
// See interpreter.bench.ts for examples
```

### Best Practices

1. **Use descriptive names** - Benchmark names appear in reports
2. **Use `withCodSpeed` wrapper** - Enables CodSpeed integration
3. **Handle errors properly** - Exit with code 1 on failures
4. **Warm up before measuring** - Benchmark.js handles this automatically
5. **Use realistic data sizes** - Match production patterns
6. **Isolate what you're measuring** - Use mocks when appropriate

## Profiling

### CPU Profiling with Node.js Inspector

```bash
# Generate a CPU profile
node --cpu-prof -r esbuild-register packages/client/src/__tests__/benchmarks/query-performance/query-performance.bench.ts

# The profile will be saved as CPU.*.cpuprofile
# Open in Chrome DevTools (chrome://inspect) or VS Code
```

### Memory Profiling

```bash
# Generate heap snapshots
node --heap-prof -r esbuild-register packages/client/src/__tests__/benchmarks/query-performance/query-performance.bench.ts
```

### Using 0x for Flame Graphs

```bash
# Install 0x
npm install -g 0x

# Generate flame graph
0x -o -- node -r esbuild-register packages/client/src/__tests__/benchmarks/query-performance/query-performance.bench.ts
```

### Using Clinic.js

```bash
# Install clinic
npm install -g clinic

# Doctor (general analysis)
clinic doctor -- node -r esbuild-register your-benchmark.bench.ts

# Flame (flame graph)
clinic flame -- node -r esbuild-register your-benchmark.bench.ts

# Bubbleprof (async analysis)
clinic bubbleprof -- node -r esbuild-register your-benchmark.bench.ts
```

## CI Integration

### GitHub Actions Workflow

Benchmarks run automatically via `.github/workflows/benchmark.yml`:

1. **On push to main/release branches**: Results are stored and tracked
2. **On pull requests**: Results compared against baseline
3. **CodSpeed integration**: Provides detailed performance insights

### CodSpeed Dashboard

- View historical trends at [codspeed.io](https://codspeed.io/)
- Get alerts for performance regressions (>200% threshold)
- Compare branches and PRs

### Alert Configuration

```yaml
# From .github/workflows/benchmark.yml
alert-threshold: '200%' # Alert if 2x slower
comment-on-alert: true # Comment on PR
fail-on-alert: true # Fail the check
```

## Data Configuration

The benchmarks use configurable seed data sizes:

```typescript
// From seed-data.ts
const SEED_CONFIGS = {
  small: {
    // Quick iteration
    users: 10,
    postsPerUser: 5,
    // ...
  },
  medium: {
    // Typical benchmark run
    users: 100,
    postsPerUser: 10,
    // ...
  },
  large: {
    // Stress testing
    users: 500,
    postsPerUser: 20,
    // ...
  },
}
```

Modify the config in your benchmark:

```typescript
import { seedDatabase, SEED_CONFIGS } from './seed-data'

// Use small config for debugging
seedResult = await seedDatabase(prisma, SEED_CONFIGS.small)

// Use large config for stress testing
seedResult = await seedDatabase(prisma, SEED_CONFIGS.large)
```

## Troubleshooting

### Benchmark takes too long

- Use smaller seed config for development
- Run specific benchmark patterns
- Increase `timeout_ms` if needed

### Inconsistent results

- Close other applications
- Disable CPU frequency scaling if possible
- Run multiple iterations (Benchmark.js default)

### CodSpeed not detecting benchmarks

- Ensure `CODSPEED_BENCHMARK=true` is set
- Use `withCodSpeed` wrapper
- Check benchmark names don't contain special characters

### Memory issues

- Reduce data size
- Add garbage collection hints: `global.gc && global.gc()`
- Use `--max-old-space-size` flag

## Interpreting Results

### Benchmark.js Output

```
findUnique by id x 15,234 ops/sec ±0.87% (89 runs sampled)
```

- **ops/sec**: Operations per second (higher is better)
- **±X%**: Margin of error
- **runs sampled**: Number of iterations

### Performance Targets

For web application workloads, aim for:

| Operation            | Target          |
| -------------------- | --------------- |
| Simple findUnique    | >10,000 ops/sec |
| findMany (10 rows)   | >5,000 ops/sec  |
| findMany (100 rows)  | >1,000 ops/sec  |
| Complex nested query | >500 ops/sec    |
| Create               | >5,000 ops/sec  |
| Update               | >5,000 ops/sec  |

### Regression Detection

- CI alerts on >100% regression
- Review CodSpeed dashboard for trends
- Compare against baseline branch

## Contributing

When submitting performance-related PRs:

1. Run benchmarks locally before and after changes
2. Include benchmark results in PR description
3. Add new benchmarks for new features
4. Document any expected performance changes

## See Also

- [TESTING.md](../TESTING.md) - General testing documentation
- [AGENTS.md](../AGENTS.md) - Agent knowledge base
- [Benchmark.js docs](https://benchmarkjs.com/)
- [CodSpeed docs](https://docs.codspeed.io/)
