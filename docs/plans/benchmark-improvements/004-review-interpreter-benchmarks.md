# Task: Review and Refine Interpreter Benchmarks

## Overview

Review the interpreter benchmarks in `packages/client-engine-runtime/bench/interpreter.bench.ts` to ensure they accurately measure the performance overhead of the query interpreter and data mapper components in isolation from database I/O.

## Current State

The interpreter benchmark suite includes:

- Mock driver adapter (`MockDriverAdapter`) that returns pre-defined results
- Query plan definitions for various operations (SELECT, findUnique, JOIN, SEQUENCE, deep nested JOIN)
- Data mapper benchmarks with varying row counts
- SQL serializer benchmarks

## Review Areas

### 1. Mock Adapter Fidelity

Review `MockDriverAdapter` implementation:

| Aspect           | Current State              | Review Items                       |
| ---------------- | -------------------------- | ---------------------------------- |
| Provider         | `sqlite`                   | Consider testing other providers   |
| Result format    | Basic column/row structure | Verify matches real adapter output |
| Transaction mock | Minimal implementation     | Ensure representative overhead     |
| Error handling   | Not tested                 | Add error path benchmarks?         |

Questions to address:

- [ ] Does the mock adapter accurately represent real adapter call overhead?
- [ ] Should we parameterize provider type for comparison?
- [ ] Is the mock transaction implementation representative?

### 2. Query Plan Coverage

Review query plan definitions:

| Plan                 | Description             | Review Items                  |
| -------------------- | ----------------------- | ----------------------------- |
| `SIMPLE_SELECT_PLAN` | Basic SELECT query      | ✅ Good baseline              |
| `FIND_UNIQUE_PLAN`   | Single record lookup    | Check arg types match runtime |
| `JOIN_PLAN`          | 1:N relationship join   | Verify join structure         |
| `SEQUENCE_PLAN`      | Multi-step query        | Add more sequence variations  |
| `DEEP_JOIN_PLAN`     | Nested joins (3 levels) | Good for complex queries      |

Missing query plans to consider:

- [ ] Aggregate query plans
- [ ] Write operation plans (INSERT, UPDATE, DELETE)
- [ ] Plans with WHERE clauses and filtering
- [ ] Plans with ordering and pagination

### 3. Data Mapper Benchmarks

Current data mapper coverage:

| Benchmark                  | Rows                | Nesting  | Review        |
| -------------------------- | ------------------- | -------- | ------------- |
| `dataMapper: 10 rows`      | 10                  | Flat     | Baseline      |
| `dataMapper: 50 rows`      | 50                  | Flat     | Medium        |
| `dataMapper: 100 rows`     | 100                 | Flat     | Large         |
| `dataMapper: nested 5x3`   | 5 users × 3 posts   | 2 levels | Small nested  |
| `dataMapper: nested 10x5`  | 10 users × 5 posts  | 2 levels | Medium nested |
| `dataMapper: nested 20x10` | 20 users × 10 posts | 2 levels | Large nested  |

Missing scenarios:

- [ ] Deeply nested data (3+ levels)
- [ ] Wide rows (many columns)
- [ ] Sparse data (many nulls)
- [ ] Different data types (DateTime, Decimal, BigInt)

### 4. Serializer Benchmarks

Current serializer coverage:

| Benchmark                       | Rows | Columns | Review  |
| ------------------------------- | ---- | ------- | ------- |
| `serializer: 10 rows x 3 cols`  | 10   | 3       | Minimal |
| `serializer: 50 rows x 8 cols`  | 50   | 8       | Medium  |
| `serializer: 100 rows x 8 cols` | 100  | 8       | Large   |

Consider adding:

- [ ] Very wide rows (20+ columns)
- [ ] Very large result sets (1000+ rows)
- [ ] Different data type serialization

### 5. Benchmark Isolation

Verify measurements are isolated:

- [ ] Mock adapter has minimal overhead
- [ ] No actual database calls
- [ ] Memory allocation patterns are consistent
- [ ] GC doesn't affect measurements

## Action Items

### High Priority

1. **Verify query plan accuracy:**
   - Compare plan structures with actual compiler output
   - Ensure `args`, `argTypes`, and `structure` fields are accurate
   - Test with real query compiler to validate plans

2. **Add write operation benchmarks:**
   - INSERT query plan and interpreter execution
   - UPDATE query plan and interpreter execution
   - DELETE query plan and interpreter execution

3. **Add aggregate benchmarks:**
   - COUNT query plan
   - SUM/AVG/MIN/MAX plans
   - GROUP BY plans

### Medium Priority

4. **Expand data type coverage:**
   - DateTime handling
   - Decimal precision
   - BigInt serialization
   - JSON/JSONB mapping (for PostgreSQL)

5. **Add edge case benchmarks:**
   - Empty result sets
   - Single column results
   - Very wide rows (50+ columns)
   - Deep nesting (4+ levels)

### Low Priority

6. **Provider-specific benchmarks:**
   - Test interpreter with different provider configurations
   - Measure provider-specific code path overhead

7. **Memory benchmarks:**
   - Track allocation counts
   - Measure GC pressure for large result sets

## Validation Steps

After refinements:

```bash
# Run interpreter benchmarks
pnpm bench interpreter

# Verify no regressions
pnpm bench

# Profile for accuracy
node --cpu-prof -r esbuild-register packages/client-engine-runtime/bench/interpreter.bench.ts
```

## Output Expectations

After review and refinements:

- Interpreter benchmarks should cover 20-30 scenarios
- Each benchmark should run in < 100ms per iteration
- Results should be stable (±3% variance between runs)
- Clear separation between interpreter, mapper, and serializer overhead

## Code Structure Recommendations

Consider refactoring the benchmark file:

- Extract query plan definitions to separate file
- Create helper functions for common patterns
- Add benchmark metadata/descriptions

## Dependencies

- None (can be done independently)

## Related Tasks

- Task 001: Migrate to tinybench (simpler async handling)
- Task 003: Review query performance benchmarks (ensure consistency)
