# Benchmark Improvements Task Index

## Overview

This directory contains executable task plans for improving Prisma's query and compilation performance benchmark suite. The tasks cover migration to modern tooling, benchmark refinement, documentation, and establishing performance baselines.

## Task Summary

| ID  | Task                                                                                | Priority | Status  | Dependencies             |
| --- | ----------------------------------------------------------------------------------- | -------- | ------- | ------------------------ |
| 001 | [Migrate from Benchmark.js to Tinybench](./001-migrate-benchmarkjs-to-tinybench.md) | High     | Planned | None                     |
| 002 | [Bump CodSpeed Plugin to v5.x](./002-bump-codspeed-plugin-version.md)               | Medium   | Planned | None (skip if doing 001) |
| 003 | [Review Query Performance Benchmarks](./003-review-query-performance-benchmarks.md) | Medium   | Planned | None                     |
| 004 | [Review Interpreter Benchmarks](./004-review-interpreter-benchmarks.md)             | Medium   | Planned | None                     |
| 005 | [Establish Performance Baselines](./005-establish-performance-baselines.md)         | High     | Planned | 001, 003, 004            |
| 006 | [Update Benchmarking Documentation](./006-update-benchmarking-documentation.md)     | Medium   | Planned | 001, 005                 |
| 007 | [Clean Up Legacy Benchmark Code](./007-cleanup-legacy-benchmark-code.md)            | Low      | Planned | 001                      |

## Recommended Execution Order

### Phase 1: Migration (Required First)

1. **Task 001** - Migrate from Benchmark.js to Tinybench
   - Updates all benchmark files to use modern async/await patterns
   - Replaces deprecated library with actively maintained alternative
   - CodSpeed plugin automatically updated to v5.x

### Phase 2: Refinement (Can Parallelize)

2. **Task 003** - Review Query Performance Benchmarks
3. **Task 004** - Review Interpreter Benchmarks
   - These can be done in parallel
   - Focus on coverage, accuracy, and real-world patterns

### Phase 3: Baseline & Documentation

4. **Task 005** - Establish Performance Baselines
   - Run after benchmark refinements are complete
   - Documents expected performance ranges
   - Configures CI alerting thresholds

5. **Task 006** - Update Benchmarking Documentation
   - Reflects tinybench migration
   - Includes baseline measurements
   - Updates all code examples

### Phase 4: Cleanup

6. **Task 007** - Clean Up Legacy Benchmark Code
   - Removes deprecated patterns
   - Applies consistent code style
   - Final polish

## Current State Analysis

### What's Been Implemented

- ✅ End-to-end query performance benchmarks (`query-performance.bench.ts`)
- ✅ Query compilation benchmarks (`compilation.bench.ts`)
- ✅ Interpreter and data mapper benchmarks (`interpreter.bench.ts`)
- ✅ Comprehensive schema with web app models
- ✅ Configurable seed data (small/medium/large)
- ✅ CI workflow with CodSpeed integration
- ✅ Documentation (`docs/benchmarking.md`)
- ✅ AGENTS.md updated with benchmarking section

### What's Missing or Needs Improvement

- ❌ Using legacy Benchmark.js (unmaintained since 2016)
- ❌ CodSpeed plugin is outdated (4.0.0 → 5.0.1)
- ❌ Some query patterns not covered (raw queries, cursor pagination)
- ❌ No documented performance baselines
- ❌ Some benchmark files have `@ts-nocheck` and other suppressions
- ❌ Inconsistent async patterns (deferred callbacks vs async/await)

## Quick Reference

### Run All Benchmarks

```bash
pnpm bench
```

### Run Specific Benchmarks

```bash
pnpm bench query-performance
pnpm bench compilation
pnpm bench interpreter
```

### Benchmark Locations

| Benchmark            | Location                                                                                |
| -------------------- | --------------------------------------------------------------------------------------- |
| Query Performance    | `packages/client/src/__tests__/benchmarks/query-performance/query-performance.bench.ts` |
| Compilation          | `packages/client/src/__tests__/benchmarks/query-performance/compilation.bench.ts`       |
| Interpreter          | `packages/client-engine-runtime/bench/interpreter.bench.ts`                             |
| Client Generation    | `packages/client/src/__tests__/benchmarks/huge-schema/huge-schema.bench.ts`             |
| Relations Generation | `packages/client/src/__tests__/benchmarks/lots-of-relations/lots-of-relations.bench.ts` |
| Platform Detection   | `packages/get-platform/bench/get-platform.bench.ts`                                     |

### Key Dependencies

| Current                               | Target                             |
| ------------------------------------- | ---------------------------------- |
| `@codspeed/benchmark.js-plugin@4.0.0` | `@codspeed/tinybench-plugin@5.0.1` |
| `benchmark@2.1.4`                     | `tinybench@^4.0.1`                 |

## Notes

- Task 002 (bump CodSpeed version) can be skipped if completing Task 001 (tinybench migration)
- Performance baselines should be re-established after any significant benchmark changes
- All tasks should be verified in CI before marking complete
- Keep tasks small and focused for easier review and iteration
