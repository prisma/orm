#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type } from 'arktype';

import {
  classifyWarning,
  discoverCoverageConfigs,
  loadRootCoverageConfig,
} from './coverage-config.js';

class CoverageReportError extends Error {}

const StatementMap = type({
  '[string]': type({
    start: type({
      line: 'number.integer >= 1',
    }),
  }),
});
const HitMap = type({ '[string]': 'number.integer >= 0' });
const BranchHitMap = type({ '[string]': type('number.integer >= 0').array() });
const BranchMap = type({
  '[string]': type({
    locations: type('unknown').array(),
  }),
});
const FunctionMap = type({ '[string]': 'unknown' });

const IstanbulCoverageRecord = type({
  path: 'string',
  statementMap: StatementMap,
  s: HitMap,
  branchMap: BranchMap,
  b: BranchHitMap,
  fnMap: FunctionMap,
  f: HitMap,
});

const METRICS = ['lines', 'statements', 'branches', 'functions'];

function assertSameKeys(left, right, description) {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (
    leftKeys.length !== rightKeys.length ||
    leftKeys.some((key, index) => key !== rightKeys[index])
  ) {
    throw new CoverageReportError(`Invalid Istanbul coverage record: ${description} keys differ`);
  }
}

function validateCoverageRecord(value, filePath) {
  let record;
  try {
    record = IstanbulCoverageRecord.assert(value);
  } catch (error) {
    throw new CoverageReportError(`Invalid Istanbul coverage record for ${filePath}: ${error}`, {
      cause: error,
    });
  }

  assertSameKeys(record.statementMap, record.s, `${filePath} statementMap/s`);
  assertSameKeys(record.branchMap, record.b, `${filePath} branchMap/b`);
  assertSameKeys(record.fnMap, record.f, `${filePath} fnMap/f`);

  for (const [branchId, hits] of Object.entries(record.b)) {
    if (record.branchMap[branchId].locations.length !== hits.length) {
      throw new CoverageReportError(
        `Invalid Istanbul coverage record: ${filePath} branch ${branchId} locations/hits differ`,
      );
    }
  }

  return record;
}

function normalizeReportPath(root, reportPath) {
  if (reportPath.length === 0 || reportPath.includes('\0')) {
    throw new CoverageReportError(`Invalid coverage report path: ${JSON.stringify(reportPath)}`);
  }
  const absoluteRoot = resolve(root);
  const absolutePath = isAbsolute(reportPath)
    ? resolve(reportPath)
    : resolve(absoluteRoot, reportPath);
  const pathFromRoot = relative(absoluteRoot, absolutePath);
  if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw new CoverageReportError(`Covered path is outside repository root: ${reportPath}`);
  }
  return pathFromRoot.split(sep).join('/');
}

function emptyCount() {
  return { total: 0, covered: 0 };
}

function percentage(count) {
  return {
    ...count,
    pct: count.total === 0 ? 100 : (count.covered / count.total) * 100,
  };
}

function recordMetrics(record) {
  const statements = {
    total: Object.keys(record.s).length,
    covered: Object.values(record.s).filter((hits) => hits > 0).length,
  };
  const branchHits = Object.values(record.b).flat();
  const branches = {
    total: branchHits.length,
    covered: branchHits.filter((hits) => hits > 0).length,
  };
  const functions = {
    total: Object.keys(record.f).length,
    covered: Object.values(record.f).filter((hits) => hits > 0).length,
  };
  const linesByNumber = new Map();
  for (const [statementId, location] of Object.entries(record.statementMap)) {
    const line = location.start.line;
    const covered = record.s[statementId] > 0;
    linesByNumber.set(line, covered || (linesByNumber.get(line) ?? false));
  }
  const lines = {
    total: linesByNumber.size,
    covered: [...linesByNumber.values()].filter(Boolean).length,
  };
  return { lines, statements, branches, functions };
}

function addMetrics(target, source) {
  for (const metric of METRICS) {
    target[metric].total += source[metric].total;
    target[metric].covered += source[metric].covered;
  }
}

function packagePathSort(left, right) {
  return left.packageDir.localeCompare(right.packageDir);
}

function isWithinPackage(sourcePath, packageDir) {
  return sourcePath === packageDir || sourcePath.startsWith(`${packageDir}/`);
}

export function aggregateCoverage({ root, report, packageConfigs, skippedPackageDirs = [] }) {
  if (report === null || typeof report !== 'object' || Array.isArray(report)) {
    throw new CoverageReportError('Coverage report must be an object keyed by source path');
  }

  const owners = [...packageConfigs].sort(
    (left, right) => right.packageDir.length - left.packageDir.length,
  );
  const aggregateByPackage = new Map(
    packageConfigs.map(({ packageDir, config }) => [
      packageDir,
      {
        packageDir,
        thresholds: config.thresholds,
        files: [],
        present: false,
        counts: Object.fromEntries(METRICS.map((metric) => [metric, emptyCount()])),
      },
    ]),
  );

  for (const [reportPath, value] of Object.entries(report)) {
    const sourcePath = normalizeReportPath(root, reportPath);
    if (skippedPackageDirs.some((packageDir) => isWithinPackage(sourcePath, packageDir))) {
      continue;
    }
    const owner = owners.find(({ packageDir }) => isWithinPackage(sourcePath, packageDir));
    if (!owner) {
      throw new CoverageReportError(
        `Covered path has no configured package owner: ${sourcePath || reportPath}`,
      );
    }
    const record = validateCoverageRecord(value, sourcePath);
    const aggregate = aggregateByPackage.get(owner.packageDir);
    aggregate.present = true;
    aggregate.files.push(sourcePath);
    addMetrics(aggregate.counts, recordMetrics(record));
  }

  return [...aggregateByPackage.values()].sort(packagePathSort).map((aggregate) => ({
    packageDir: aggregate.packageDir,
    thresholds: aggregate.thresholds,
    files: aggregate.files.sort(),
    present: aggregate.present,
    metrics: Object.fromEntries(
      METRICS.map((metric) => [metric, percentage(aggregate.counts[metric])]),
    ),
  }));
}

export function checkThresholds(metrics, thresholds) {
  const deficits = [];
  for (const metric of METRICS) {
    const threshold = thresholds[metric];
    if (threshold !== undefined && metrics[metric].pct < threshold) {
      deficits.push({ metric, actual: metrics[metric].pct, threshold });
    }
  }
  return deficits;
}

export function suggestThresholdIncreases(metrics, thresholds, margin = 5, cap = 95) {
  const suggestions = {};
  for (const metric of METRICS) {
    const current = thresholds[metric];
    if (current === undefined || metrics[metric].pct < current + margin) continue;
    const suggested = Math.min(cap, Math.floor(metrics[metric].pct));
    if (suggested > current) {
      suggestions[metric] = { current, actual: metrics[metric].pct, suggested };
    }
  }
  return suggestions;
}

export function processCoverageReport({ root, report, packageConfigs, rootConfig, now }) {
  const excluded = new Set(rootConfig.excludedPackages.map((path) => `packages/${path}`));
  const configuredPackages = packageConfigs.filter(({ packageDir }) => !excluded.has(packageDir));
  const warningByPackage = new Map(
    rootConfig.warningOnly.map((entry) => [`packages/${entry.package}`, entry]),
  );
  const expiredWarnings = rootConfig.warningOnly
    .map((entry) => ({ entry, ...classifyWarning(entry, now) }))
    .filter(({ active }) => !active);
  const expiredPackages = new Set(expiredWarnings.map(({ entry }) => `packages/${entry.package}`));
  const warnings = [];
  const failures = [];

  const packages = aggregateCoverage({
    root,
    report,
    packageConfigs: configuredPackages,
    skippedPackageDirs: [...excluded],
  }).map((packageResult) => {
    const deficits = checkThresholds(packageResult.metrics, packageResult.thresholds);
    const warningEntry = warningByPackage.get(packageResult.packageDir);
    const warningState = warningEntry ? classifyWarning(warningEntry, now) : null;
    const hasThresholds = Object.keys(packageResult.thresholds).length > 0;
    let status = hasThresholds ? 'passed' : 'no-threshold';

    if (!packageResult.present && warningState?.active) {
      status = 'missing-warning';
      warnings.push({
        packageDir: packageResult.packageDir,
        reason: 'absent-from-report',
        entry: warningEntry,
        expiryDate: warningState.expiryDate,
      });
    } else if (!packageResult.present && hasThresholds) {
      status = expiredPackages.has(packageResult.packageDir) ? 'expired-warning' : 'missing';
      failures.push({
        packageDir: packageResult.packageDir,
        reason: 'absent-from-report',
      });
    } else if (expiredPackages.has(packageResult.packageDir)) {
      status = 'expired-warning';
      if (deficits.length > 0) {
        failures.push({ packageDir: packageResult.packageDir, deficits });
      }
    } else if (deficits.length > 0 && warningState?.active) {
      status = 'warning';
      warnings.push({
        packageDir: packageResult.packageDir,
        deficits,
        entry: warningEntry,
        expiryDate: warningState.expiryDate,
      });
    } else if (deficits.length > 0) {
      status = 'failed';
      failures.push({ packageDir: packageResult.packageDir, deficits });
    }

    const suggestions =
      status === 'passed' && packageResult.present
        ? suggestThresholdIncreases(packageResult.metrics, packageResult.thresholds)
        : {};
    return { ...packageResult, deficits, status, suggestions };
  });

  return {
    ok: failures.length === 0 && expiredWarnings.length === 0,
    packages,
    failures,
    warnings,
    expiredWarnings,
    skipped: [...excluded].sort(),
  };
}

function formatDeficits(deficits, indent) {
  return deficits
    .map(
      ({ metric, actual, threshold }) =>
        `${indent}${metric}: ${actual.toFixed(2)}% < ${threshold}%`,
    )
    .join('\n');
}

export function formatCoverageReport(result) {
  const lines = ['='.repeat(80), 'COVERAGE REPORT SUMMARY', '='.repeat(80), ''];

  if (result.expiredWarnings.length > 0) {
    lines.push('EXPIRED COVERAGE WARNINGS - BLOCKING', '-'.repeat(80));
    for (const { entry, expiryDate } of result.expiredWarnings) {
      lines.push(`  packages/${entry.package}`);
      lines.push(`    Reason: ${entry.reason}`);
      lines.push(`    Added: ${entry.addedDate} | Expired: ${expiryDate}`);
      if (entry.assignee) lines.push(`    Assignee: ${entry.assignee}`);
      if (entry.linear) lines.push(`    Linear: ${entry.linear}`);
    }
    lines.push(
      '  Action required: remove the exception after recovery or extend it with justification.',
      '',
    );
  }

  if (result.warnings.length > 0) {
    lines.push('TECHNICAL DEBT - NONBLOCKING COVERAGE WARNINGS', '-'.repeat(80));
    for (const warning of result.warnings) {
      lines.push(`  ${warning.packageDir}`);
      lines.push(`    Reason: ${warning.entry.reason}`);
      lines.push(`    Added: ${warning.entry.addedDate} | Expires: ${warning.expiryDate}`);
      if (warning.entry.assignee) lines.push(`    Assignee: ${warning.entry.assignee}`);
      if (warning.entry.linear) lines.push(`    Linear: ${warning.entry.linear}`);
      if (warning.reason === 'absent-from-report') {
        lines.push('    Missing from coverage report');
      } else {
        lines.push(formatDeficits(warning.deficits, '    '));
      }
    }
    lines.push('');
  }

  if (result.failures.length > 0) {
    lines.push('BLOCKING COVERAGE FAILURES', '-'.repeat(80));
    for (const failure of result.failures) {
      lines.push(`  ${failure.packageDir}`);
      if (failure.reason === 'absent-from-report') {
        lines.push('    Missing from coverage report');
      } else {
        lines.push(formatDeficits(failure.deficits, '    '));
      }
    }
    lines.push('');
  }

  const passing = result.packages.filter(({ status }) => status === 'passed');
  if (passing.length > 0) {
    lines.push(
      'PASSING',
      '-'.repeat(80),
      ...passing.map(({ packageDir }) => `  ${packageDir}`),
      '',
    );
  }

  const noThreshold = result.packages.filter(
    ({ present, status }) => present && status === 'no-threshold',
  );
  if (noThreshold.length > 0) {
    lines.push(
      'NO THRESHOLDS',
      '-'.repeat(80),
      ...noThreshold.map(({ packageDir }) => `  ${packageDir}`),
      '',
    );
  }

  const absentWithoutThresholds = result.packages.filter(
    ({ present, status }) => !present && status === 'no-threshold',
  );
  if (absentWithoutThresholds.length > 0) {
    lines.push(
      'ABSENT FROM REPORT',
      '-'.repeat(80),
      '  No source entries; no thresholds configured (empty metrics are 100%):',
      ...absentWithoutThresholds.map(({ packageDir }) => `  ${packageDir}`),
      '',
    );
  }

  const suggestions = result.packages.filter(
    ({ suggestions: packageSuggestions }) => Object.keys(packageSuggestions).length > 0,
  );
  if (suggestions.length > 0) {
    lines.push('THRESHOLD INCREASE SUGGESTIONS', '-'.repeat(80));
    for (const packageResult of suggestions) {
      lines.push(`  ${packageResult.packageDir}`);
      for (const metric of METRICS) {
        const suggestion = packageResult.suggestions[metric];
        if (suggestion) {
          lines.push(
            `    ${metric}: ${suggestion.current} -> ${suggestion.suggested} (actual ${suggestion.actual.toFixed(2)}%)`,
          );
        }
      }
    }
    lines.push('');
  }

  if (result.skipped.length > 0) {
    lines.push(
      'SKIPPED BY ROOT POLICY',
      '-'.repeat(80),
      ...result.skipped.map((packageDir) => `  ${packageDir}`),
      '',
    );
  }

  const statusCounts = Object.fromEntries(
    [
      'passed',
      'failed',
      'missing',
      'warning',
      'missing-warning',
      'expired-warning',
      'no-threshold',
    ].map((status) => [
      status,
      result.packages.filter((packageResult) => packageResult.status === status).length,
    ]),
  );
  lines.push('='.repeat(80));
  lines.push(
    `Total: ${result.packages.length} | Passed: ${statusCounts.passed} | Failures: ${result.failures.length} | Warnings: ${statusCounts.warning + statusCounts['missing-warning']} | Expired: ${result.expiredWarnings.length} | No thresholds: ${statusCounts['no-threshold']} | Skipped: ${result.skipped.length}`,
  );
  lines.push('='.repeat(80));
  return `${lines.join('\n')}\n`;
}

async function loadCoverageJson(root) {
  const reportPath = join(root, 'coverage', 'coverage-final.json');
  let source;
  try {
    source = await readFile(reportPath, 'utf8');
  } catch (error) {
    throw new CoverageReportError(`Missing coverage report: ${reportPath}`, { cause: error });
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new CoverageReportError(`Malformed coverage report: ${reportPath}`, { cause: error });
  }
}

export async function runCoverageReport({ root = resolve(process.cwd()), now = new Date() } = {}) {
  const rootConfig = loadRootCoverageConfig(root);
  const packageConfigs = discoverCoverageConfigs(root);
  const report = await loadCoverageJson(root);
  return processCoverageReport({ root, report, packageConfigs, rootConfig, now });
}

export async function main() {
  const result = await runCoverageReport();
  process.stdout.write(formatCoverageReport(result));
  if (!result.ok) process.exitCode = 1;
  return result;
}

const isDirectExecution =
  process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  main().catch((error) => {
    console.error(`Coverage report failed: ${error.message}`);
    process.exitCode = 1;
  });
}
