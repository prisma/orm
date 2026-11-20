# Task: Bump CodSpeed Plugin to Major Version 5.x

## Overview

Update `@codspeed/benchmark.js-plugin` from version `4.0.0` to `5.0.1` across all packages that use it. This is a prerequisite if staying with benchmark.js, or can be skipped if migrating directly to tinybench (see task 001).

## Current State

The following packages use `@codspeed/benchmark.js-plugin` at version `4.0.0`:

| Package                         | File                                          |
| ------------------------------- | --------------------------------------------- |
| `@prisma/client`                | `packages/client/package.json`                |
| `@prisma/client-engine-runtime` | `packages/client-engine-runtime/package.json` |
| `@prisma/get-platform`          | `packages/get-platform/package.json`          |

## Target Version

- **Current**: `@codspeed/benchmark.js-plugin@4.0.0`
- **Target**: `@codspeed/benchmark.js-plugin@5.0.1`

## Breaking Changes in v5.x

Based on the CodSpeed changelog, the major version bump includes:

1. **Node.js version requirements** - May require Node.js 18+ (verify against prisma's `^20.19 || ^22.12 || >=24.0` requirement)
2. **API compatibility** - The `withCodSpeed` wrapper API remains the same
3. **Internal instrumentation changes** - Should be transparent to users

## Migration Steps

### Step 1: Update Dependencies

For each package, update the version in `package.json`:

```json
{
  "devDependencies": {
    "@codspeed/benchmark.js-plugin": "5.0.1"
  }
}
```

Packages to update:

- `packages/client/package.json`
- `packages/client-engine-runtime/package.json`
- `packages/get-platform/package.json`

### Step 2: Regenerate Lockfile

```bash
pnpm install
```

This will update `pnpm-lock.yaml` with the new versions.

### Step 3: Verify Locally

```bash
# Run all benchmarks
pnpm bench

# Test CodSpeed integration locally
CODSPEED_BENCHMARK=true pnpm bench
```

### Step 4: Verify CI

- Push changes to a PR
- Verify the benchmark workflow in `.github/workflows/benchmark.yml` passes
- Check CodSpeed dashboard for results

## Verification Checklist

- [ ] `packages/client/package.json` updated to `5.0.1`
- [ ] `packages/client-engine-runtime/package.json` updated to `5.0.1`
- [ ] `packages/get-platform/package.json` updated to `5.0.1`
- [ ] `pnpm-lock.yaml` regenerated
- [ ] `pnpm bench` runs successfully locally
- [ ] CI benchmark workflow passes
- [ ] CodSpeed dashboard shows results from new version

## Relationship to Other Tasks

- **If migrating to tinybench (task 001)**: This task can be skipped entirely, as tinybench uses `@codspeed/tinybench-plugin@5.0.1` instead
- **If staying with benchmark.js**: Complete this task first before any other benchmark work

## Rollback Plan

If issues arise, revert the version changes:

```bash
git checkout -- packages/client/package.json packages/client-engine-runtime/package.json packages/get-platform/package.json
pnpm install
```

## Notes

- The CodSpeed GitHub Action (`CodSpeedHQ/action@v3`) in `.github/workflows/benchmark.yml` is compatible with plugin v5.x
- No code changes should be required—only dependency version updates
- The `rhysd/github-action-benchmark@v1` action for storing results is unaffected by this change
