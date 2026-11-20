# Task: Establish Performance Baselines

## Overview

Run the complete benchmark suite to establish initial performance baselines. Document expected performance ranges for all benchmark categories and configure alerting thresholds in CI.

## Rationale

- New benchmarks have been added but no baseline measurements exist
- CodSpeed needs historical data to detect regressions
- Performance targets should be documented for reference
- CI alerting thresholds need validation

## Current State

- Benchmark infrastructure is in place
- CI workflow configured with 200% alert threshold
- No documented baseline measurements
- CodSpeed dashboard may be empty or have limited history

## Steps

### Step 1: Local Baseline Collection

Run benchmarks locally on a consistent machine to establish rough baselines:

```bash
# Ensure clean build
pnpm clean
pnpm install
pnpm build

# Run full benchmark suite 3 times
for i in 1 2 3; do
  echo "=== Run $i ===" >> baseline-results.txt
  pnpm bench >> baseline-results.txt 2>&1
done
```

### Step 2: Document Expected Ranges

Create a baseline document with expected performance ranges:

| Category              | Benchmark                        | Expected ops/sec | Acceptable Range |
| --------------------- | -------------------------------- | ---------------- | ---------------- |
| **Query Performance** |                                  |                  |                  |
| Read                  | findUnique by id                 | TBD              | ±20%             |
| Read                  | findMany 10 records              | TBD              | ±20%             |
| Read                  | findMany with includes           | TBD              | ±20%             |
| Write                 | create single record             | TBD              | ±20%             |
| Write                 | updateMany                       | TBD              | ±20%             |
| Aggregation           | count                            | TBD              | ±15%             |
| Complex               | blog post page query             | TBD              | ±25%             |
| **Compilation**       |                                  |                  |                  |
| Simple                | compile findUnique simple        | TBD              | ±15%             |
| Complex               | compile findMany nested includes | TBD              | ±20%             |
| Realistic             | compile blog post page           | TBD              | ±20%             |
| Setup                 | instantiate query compiler       | TBD              | ±25%             |
| **Interpreter**       |                                  |                  |                  |
| Execution             | interpreter: simple select       | TBD              | ±10%             |
| Execution             | interpreter: join (1:N)          | TBD              | ±15%             |
| Mapping               | dataMapper: 100 rows             | TBD              | ±10%             |
| Serialization         | serializer: 100 rows             | TBD              | ±10%             |
| **Client Generation** |                                  |                  |                  |
| Generation            | ~50 Models                       | TBD              | ±30%             |
| Generation            | 100 models with relations        | TBD              | ±30%             |

### Step 3: CI Baseline Run

Trigger CI benchmark workflow to establish CodSpeed baseline:

1. Merge benchmark changes to main branch
2. Verify workflow completes successfully
3. Check CodSpeed dashboard for initial measurements
4. Verify `rhysd/github-action-benchmark` stores results

### Step 4: Validate Alert Thresholds

Review and potentially adjust CI alert thresholds:

```yaml
# Current setting in .github/workflows/benchmark.yml
alert-threshold: '200%' # Alert if 2x slower
```

Consider adjusting based on observed variance:

- If benchmarks are stable (±10%), consider lowering to 150%
- If benchmarks are noisy (±30%), keep at 200% or increase
- Different thresholds for different benchmark categories (not currently supported)

### Step 5: Document in benchmarking.md

Update `docs/benchmarking.md` with baseline information:

- Add "Performance Targets" section with expected ranges
- Add "Historical Baselines" section with initial measurements
- Document how to interpret CodSpeed results
- Add guidance for investigating regressions

## Measurements to Capture

### Environment Information

Document the environment used for baselines:

- Node.js version
- OS and architecture
- CPU model and core count
- Memory available
- CI runner specs (for CI baselines)

### Statistical Metrics

For each benchmark, capture:

- ops/sec (operations per second)
- Mean time per operation
- Standard deviation / margin of error
- Sample count
- Min/max observed values

## Verification Checklist

- [ ] Local benchmarks run successfully 3+ times
- [ ] Results documented with environment info
- [ ] CI workflow passes on main branch
- [ ] CodSpeed dashboard shows initial data
- [ ] github-action-benchmark results page populated
- [ ] `docs/benchmarking.md` updated with baselines
- [ ] Alert thresholds validated and adjusted if needed

## Expected Outputs

1. **baseline-results.txt** - Raw local benchmark output (3 runs)
2. **Updated docs/benchmarking.md** - Performance targets section
3. **CodSpeed dashboard** - Initial measurements visible
4. **GitHub Pages benchmark** - Historical data initialized

## Timeline Considerations

- Local baseline collection: 30-60 minutes (3 full runs)
- CI baseline: Requires merge to main (coordinate with team)
- Documentation: 1-2 hours
- Total: Half day to full day

## Dependencies

- Benchmarks must be implemented and passing (current state)
- CI workflow must be functional
- CodSpeed token must be configured in repository secrets

## Related Tasks

- Task 001: Migrate to tinybench (run baselines after migration)
- Task 003: Review query benchmarks (may add new benchmarks)
- Task 004: Review interpreter benchmarks (may add new benchmarks)

## Notes

- Baselines should be re-established after significant infrastructure changes
- Consider running baselines on multiple machines for comparison
- CI baselines are most valuable as they're consistent environment
- Local baselines useful for quick regression checks during development
