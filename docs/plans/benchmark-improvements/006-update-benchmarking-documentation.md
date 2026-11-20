# Task: Update Benchmarking Documentation

## Overview

Update `docs/benchmarking.md` and related documentation to reflect the current state of the benchmark suite, including any changes from tinybench migration and newly added benchmarks.

## Current State

The `docs/benchmarking.md` file was created as part of the initial benchmark implementation. It needs to be reviewed and updated to ensure accuracy after:

- Benchmark.js to tinybench migration (task 001)
- CodSpeed plugin version bump (task 002)
- Query performance benchmark refinements (task 003)
- Interpreter benchmark refinements (task 004)
- Baseline establishment (task 005)

## Documentation Areas to Update

### 1. Library References

| Section         | Current                 | Update To           |
| --------------- | ----------------------- | ------------------- |
| Overview        | References Benchmark.js | Reference tinybench |
| Installation    | N/A                     | Verify dependencies |
| Code examples   | Benchmark.js API        | tinybench API       |
| Troubleshooting | Benchmark.js specific   | tinybench specific  |

### 2. Code Examples

All code examples need updating for tinybench API:

**Creating a benchmark:**

```typescript
// Update from Benchmark.Suite to Bench
import { withCodSpeed } from '@codspeed/tinybench-plugin'
import { Bench } from 'tinybench'

const bench = withCodSpeed(new Bench({ name: 'my-benchmarks' }))

bench.add('benchmark name', async () => {
  await myAsyncOperation()
})

await bench.run()
console.table(bench.table())
```

**Event handling:**

```typescript
// Update event listener pattern
bench.addEventListener('cycle', (evt) => {
  console.log(evt.task?.name, evt.task?.result)
})
```

### 3. Sections to Review

| Section                   | Review Items                             |
| ------------------------- | ---------------------------------------- |
| **Overview**              | Update library name, verify descriptions |
| **Benchmark Categories**  | Ensure all categories are documented     |
| **Running Benchmarks**    | Verify commands still work               |
| **Benchmark Files**       | Update file list if changed              |
| **Benchmark Scenarios**   | Add any new benchmarks                   |
| **Adding New Benchmarks** | Update code templates                    |
| **Profiling**             | Verify profiling commands                |
| **CI Integration**        | Review workflow accuracy                 |
| **Data Configuration**    | Verify seed configs                      |
| **Troubleshooting**       | Update for tinybench issues              |
| **Interpreting Results**  | Update output format                     |
| **Performance Targets**   | Add baseline measurements (task 005)     |

### 4. New Sections to Add

Consider adding:

- **Migration Guide** - How to migrate existing benchmarks
- **Performance Baselines** - Documented baseline measurements
- **Regression Investigation** - How to debug performance issues
- **Local vs CI Results** - Differences and interpretation
- **CodSpeed Dashboard Guide** - How to use the dashboard

## Specific Updates Required

### Update Import Statements

All code examples should use:

```typescript
import { withCodSpeed } from '@codspeed/tinybench-plugin'
import { Bench } from 'tinybench'
```

### Update Suite Creation

Replace all instances of:

```typescript
const suite = withCodSpeed(new Benchmark.Suite('name'))
```

With:

```typescript
const bench = withCodSpeed(new Bench({ name: 'name' }))
```

### Update Async Pattern

Replace deferred pattern:

```typescript
suite.add('name', {
  defer: true,
  fn: (deferred) => {
    asyncOp().then(() => deferred.resolve())
  },
})
```

With native async:

```typescript
bench.add('name', async () => {
  await asyncOp()
})
```

### Update Output Format

tinybench uses `console.table(bench.table())` which outputs a different format:

```
┌─────────┬───────────────┬─────────────┬───────────────────┬──────────┬─────────┐
│ (index) │   Task Name   │   ops/sec   │ Average Time (ns) │  Margin  │ Samples │
├─────────┼───────────────┼─────────────┼───────────────────┼──────────┼─────────┤
│    0    │ 'benchmark1'  │ '1,234,567' │      810.005      │ '±0.50%' │  617284 │
└─────────┴───────────────┴─────────────┴───────────────────┴──────────┴─────────┘
```

### Update Dependencies List

Document required dependencies:

```json
{
  "devDependencies": {
    "@codspeed/tinybench-plugin": "5.0.1",
    "tinybench": "^4.0.1"
  }
}
```

### Update AGENTS.md

The benchmarking section in `AGENTS.md` should also be reviewed:

- Verify benchmark file paths
- Update library references
- Ensure commands are accurate

## Action Items

### High Priority

1. **Update all code examples** to use tinybench API
2. **Update "Adding New Benchmarks" section** with correct templates
3. **Verify all commands** in "Running Benchmarks" section
4. **Update troubleshooting** for tinybench-specific issues

### Medium Priority

5. **Add performance baselines** section with measurements from task 005
6. **Update file listings** if new benchmark files added
7. **Review profiling commands** for compatibility

### Low Priority

8. **Add CodSpeed dashboard guide** with screenshots
9. **Add regression investigation guide**
10. **Improve formatting and organization**

## Verification Steps

After updates:

```bash
# Verify all documented commands work
pnpm bench
pnpm bench query-performance
pnpm bench compilation
pnpm bench interpreter

# Verify profiling commands work
node --cpu-prof -r esbuild-register packages/client/src/__tests__/benchmarks/query-performance/query-performance.bench.ts
```

## Review Checklist

- [ ] All code examples use tinybench API
- [ ] Import statements are correct
- [ ] Async patterns use native async/await
- [ ] Output format examples are accurate
- [ ] Commands in documentation work
- [ ] File paths are correct
- [ ] Dependencies are documented correctly
- [ ] AGENTS.md benchmarking section updated
- [ ] No references to Benchmark.js remain (except historical context)
- [ ] Performance targets section added (after task 005)

## Dependencies

- Task 001: Migrate to tinybench (required for accurate docs)
- Task 005: Establish baselines (for performance targets section)

## Related Tasks

- Task 001: Migration provides the API changes to document
- Task 003: Query benchmark changes may need documentation
- Task 004: Interpreter benchmark changes may need documentation
- Task 005: Baselines provide data for performance targets

## Notes

- Keep documentation concise and practical
- Focus on "how to" over "what is"
- Include working code examples that can be copy-pasted
- Link to external resources (tinybench docs, CodSpeed docs) rather than duplicating
