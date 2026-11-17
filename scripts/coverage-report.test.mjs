import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  aggregateCoverage,
  checkThresholds,
  formatCoverageReport,
  processCoverageReport,
  runCoverageReport,
  suggestThresholdIncreases,
} from './coverage-report.mjs';

const fullThresholds = { lines: 50, statements: 50, branches: 50, functions: 50 };

function location(line, column = 0) {
  return { start: { line, column }, end: { line, column: column + 1 } };
}

function record({ statements = [], branches = [], functions = [] } = {}) {
  return {
    path: 'ignored-by-postprocessor.ts',
    statementMap: Object.fromEntries(
      statements.map(({ line }, index) => [String(index), location(line)]),
    ),
    s: Object.fromEntries(statements.map(({ hits }, index) => [String(index), hits])),
    branchMap: Object.fromEntries(
      branches.map((_, index) => [
        String(index),
        {
          type: 'if',
          line: index + 1,
          loc: location(index + 1),
          locations: branches[index].map((_, locationIndex) =>
            location(index + 1, locationIndex * 2),
          ),
        },
      ]),
    ),
    b: Object.fromEntries(branches.map((hits, index) => [String(index), hits])),
    fnMap: Object.fromEntries(
      functions.map((_, index) => [
        String(index),
        {
          name: `fn${index}`,
          decl: location(index + 1),
          loc: location(index + 1),
          line: index + 1,
        },
      ]),
    ),
    f: Object.fromEntries(functions.map((hits, index) => [String(index), hits])),
  };
}

function packageConfig(packageDir, thresholds = fullThresholds) {
  return { packageDir, config: { include: [], exclude: [], thresholds } };
}

function rootConfig(warningOnly = [], excludedPackages = []) {
  return { warningOnly, excludedPackages };
}

function warning(overrides = {}) {
  return {
    package: 'group/a',
    reason: 'Coverage recovery needs dedicated tests.',
    addedDate: '2026-01-01',
    expiryDays: 10,
    assignee: 'Ada',
    linear: 'TML-123',
    notes: null,
    ...overrides,
  };
}

function process({
  root,
  report,
  packageConfigs = [packageConfig('packages/group/a')],
  warnings = [],
  excludedPackages = [],
  now = new Date('2026-01-05T12:00:00Z'),
}) {
  return processCoverageReport({
    root,
    report,
    packageConfigs,
    rootConfig: rootConfig(warnings, excludedPackages),
    now,
  });
}

describe('coverage report', () => {
  let root;

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'coverage-report-'));
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('groups absolute and root-relative paths by longest package path', () => {
    const report = {
      [join(root, 'packages/group/a/src/absolute.ts')]: record({
        statements: [{ line: 1, hits: 1 }],
      }),
      'packages/group/a/src/relative.ts': record({ statements: [{ line: 2, hits: 1 }] }),
      'packages/group/a/nested/src/deep.ts': record({ statements: [{ line: 3, hits: 1 }] }),
    };
    const packages = aggregateCoverage({
      root,
      report,
      packageConfigs: [packageConfig('packages/group/a'), packageConfig('packages/group/a/nested')],
    });

    assert.deepEqual(
      packages.map(({ packageDir, files }) => [packageDir, files]),
      [
        [
          'packages/group/a',
          ['packages/group/a/src/absolute.ts', 'packages/group/a/src/relative.ts'],
        ],
        ['packages/group/a/nested', ['packages/group/a/nested/src/deep.ts']],
      ],
    );
  });

  it('assigns cross-package imports to the source owner', () => {
    const packages = aggregateCoverage({
      root,
      report: {
        'packages/group/b/src/imported-by-a.ts': record({ statements: [{ line: 1, hits: 1 }] }),
      },
      packageConfigs: [packageConfig('packages/group/a'), packageConfig('packages/group/b')],
    });

    assert.equal(packages[0].present, false);
    assert.equal(packages[1].present, true);
    assert.deepEqual(packages[1].files, ['packages/group/b/src/imported-by-a.ts']);
  });

  it('accepts Vitest 4 Istanbul locations and metadata', async () => {
    const fixture = JSON.parse(
      await readFile(join(import.meta.dirname, 'fixtures/vitest-4-coverage-final.json'), 'utf8'),
    );
    const [result] = aggregateCoverage({
      root,
      report: fixture,
      packageConfigs: [packageConfig('packages/group/a')],
    });

    assert.equal(result.present, true);
    assert.deepEqual(result.metrics, {
      lines: { total: 1, covered: 1, pct: 100 },
      statements: { total: 1, covered: 1, pct: 100 },
      branches: { total: 2, covered: 1, pct: 50 },
      functions: { total: 1, covered: 1, pct: 100 },
    });
  });

  it('aggregates lines, statements, flattened branches, and functions', () => {
    const [result] = aggregateCoverage({
      root,
      report: {
        'packages/group/a/src/a.ts': record({
          statements: [
            { line: 10, hits: 0 },
            { line: 10, hits: 2 },
            { line: 11, hits: 0 },
          ],
          branches: [
            [0, 3],
            [1, 0, 2],
          ],
          functions: [0, 4],
        }),
        'packages/group/a/src/b.ts': record({
          statements: [{ line: 10, hits: 0 }],
          branches: [[1]],
          functions: [1],
        }),
      },
      packageConfigs: [packageConfig('packages/group/a')],
    });

    assert.deepEqual(result.metrics, {
      lines: { total: 3, covered: 1, pct: (1 / 3) * 100 },
      statements: { total: 4, covered: 1, pct: 25 },
      branches: { total: 6, covered: 4, pct: (2 / 3) * 100 },
      functions: { total: 3, covered: 2, pct: (2 / 3) * 100 },
    });
  });

  it('uses 100 percent for zero totals', () => {
    const [result] = aggregateCoverage({
      root,
      report: { 'packages/group/a/src/types.ts': record() },
      packageConfigs: [packageConfig('packages/group/a')],
    });

    assert.deepEqual(result.metrics, {
      lines: { total: 0, covered: 0, pct: 100 },
      statements: { total: 0, covered: 0, pct: 100 },
      branches: { total: 0, covered: 0, pct: 100 },
      functions: { total: 0, covered: 0, pct: 100 },
    });
  });

  it('compares equality and every optional threshold', () => {
    const metrics = {
      lines: { total: 2, covered: 1, pct: 50 },
      statements: { total: 4, covered: 2, pct: 50 },
      branches: { total: 5, covered: 2, pct: 40 },
      functions: { total: 10, covered: 3, pct: 30 },
    };

    assert.deepEqual(checkThresholds(metrics, fullThresholds), [
      { metric: 'branches', actual: 40, threshold: 50 },
      { metric: 'functions', actual: 30, threshold: 50 },
    ]);
    assert.deepEqual(checkThresholds(metrics, {}), []);
  });

  it('classifies active warnings as nonblocking deficits', () => {
    const result = process({
      root,
      report: {
        'packages/group/a/src/a.ts': record({ statements: [{ line: 1, hits: 0 }] }),
      },
      warnings: [warning()],
      now: new Date('2026-01-11T23:59:59Z'),
    });

    assert.equal(result.ok, true);
    assert.equal(result.packages[0].status, 'warning');
    assert.equal(result.warnings.length, 1);
    assert.equal(result.failures.length, 0);
    assert.match(formatCoverageReport(result), /TECHNICAL DEBT/);
    assert.match(formatCoverageReport(result), /Ada/);
    assert.match(formatCoverageReport(result), /TML-123/);
    assert.match(formatCoverageReport(result), /2026-01-11/);
  });

  it('blocks expired warning entries even when coverage passes', () => {
    const result = process({
      root,
      report: {
        'packages/group/a/src/a.ts': record({ statements: [{ line: 1, hits: 1 }] }),
      },
      warnings: [warning()],
      now: new Date('2026-01-12T00:00:00Z'),
    });

    assert.equal(result.ok, false);
    assert.equal(result.packages[0].status, 'expired-warning');
    assert.equal(result.expiredWarnings.length, 1);
    assert.match(formatCoverageReport(result), /EXPIRED COVERAGE WARNINGS/);
  });

  it('blocks ordinary deficits with metric details', () => {
    const result = process({
      root,
      report: {
        'packages/group/a/src/a.ts': record({
          statements: [{ line: 1, hits: 0 }],
          branches: [[0]],
          functions: [0],
        }),
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.packages[0].status, 'failed');
    assert.deepEqual(
      result.failures[0].deficits.map(({ metric }) => metric),
      ['lines', 'statements', 'branches', 'functions'],
    );
    assert.match(formatCoverageReport(result), /lines: 0\.00% < 50%/);
  });

  it('ignores excluded packages before owner resolution', () => {
    const result = process({
      root,
      report: {
        'packages/group/a/src/a.ts': record({ statements: [{ line: 1, hits: 1 }] }),
        'packages/group/skip/src/skip.ts': record({ statements: [{ line: 1, hits: 0 }] }),
      },
      packageConfigs: [packageConfig('packages/group/a'), packageConfig('packages/group/skip')],
      excludedPackages: ['group/skip'],
    });

    assert.equal(result.ok, true);
    assert.deepEqual(
      result.packages.map(({ packageDir }) => packageDir),
      ['packages/group/a'],
    );
    assert.deepEqual(result.skipped, ['packages/group/skip']);
  });

  it('rejects malformed records', () => {
    const malformed = [
      null,
      { ...record(), s: { 0: 'one' } },
      { ...record({ statements: [{ line: 1, hits: 1 }] }), statementMap: {} },
      {
        ...record({ statements: [{ line: 1, hits: 1 }] }),
        statementMap: { 0: location(0) },
      },
      { ...record({ branches: [[1]] }), b: {} },
      { ...record({ branches: [[1, 0]] }), b: { 0: [1] } },
      { ...record(), b: { 0: [1, -1] } },
      { ...record({ functions: [1] }), f: {} },
      { ...record(), f: { 0: 1.5 } },
    ];

    for (const value of malformed) {
      assert.throws(
        () =>
          aggregateCoverage({
            root,
            report: { 'packages/group/a/src/a.ts': value },
            packageConfigs: [packageConfig('packages/group/a')],
          }),
        /Invalid Istanbul coverage record/,
      );
    }
  });

  it('rejects unowned and outside-root paths', () => {
    assert.throws(
      () =>
        aggregateCoverage({
          root,
          report: { 'packages/unknown/src/a.ts': record() },
          packageConfigs: [packageConfig('packages/group/a')],
        }),
      /no configured package owner/i,
    );
    assert.throws(
      () =>
        aggregateCoverage({
          root,
          report: { [join(root, '..', 'outside.ts')]: record() },
          packageConfigs: [packageConfig('packages/group/a')],
        }),
      /outside repository root/i,
    );
    assert.throws(
      () =>
        aggregateCoverage({
          root,
          report: { '../outside.ts': record() },
          packageConfigs: [packageConfig('packages/group/a')],
        }),
      /outside repository root/i,
    );
  });

  it('blocks absent packages with thresholds without inventing metric deficits', () => {
    const result = process({ root, report: {} });
    const output = formatCoverageReport(result);

    assert.equal(result.ok, false);
    assert.equal(result.packages[0].present, false);
    assert.equal(result.packages[0].status, 'missing');
    assert.equal(result.packages[0].metrics.lines.pct, 100);
    assert.deepEqual(result.packages[0].deficits, []);
    assert.deepEqual(result.failures, [
      { packageDir: 'packages/group/a', reason: 'absent-from-report' },
    ]);
    assert.match(output, /BLOCKING COVERAGE FAILURES/);
    assert.match(output, /Missing from coverage report/);
    assert.doesNotMatch(output, /0\.00% < 50%/);
  });

  it('warns visibly when an active warning-only package is absent', () => {
    const result = process({ root, report: {}, warnings: [warning()] });
    const output = formatCoverageReport(result);

    assert.equal(result.ok, true);
    assert.equal(result.packages[0].status, 'missing-warning');
    assert.deepEqual(result.warnings[0], {
      packageDir: 'packages/group/a',
      reason: 'absent-from-report',
      entry: warning(),
      expiryDate: '2026-01-11',
    });
    assert.match(output, /TECHNICAL DEBT - NONBLOCKING COVERAGE WARNINGS/);
    assert.match(output, /Missing from coverage report/);
    assert.doesNotMatch(output, /0\.00% < 50%/);
  });

  it('warns when an active warning-only package without thresholds is absent', () => {
    const result = process({
      root,
      report: {},
      packageConfigs: [packageConfig('packages/group/a', {})],
      warnings: [warning()],
    });

    assert.equal(result.ok, true);
    assert.equal(result.packages[0].status, 'missing-warning');
    assert.equal(result.warnings[0].reason, 'absent-from-report');
    assert.match(formatCoverageReport(result), /Missing from coverage report/);
  });

  it('keeps absent source-free packages without thresholds at empty 100 percent metrics', () => {
    const result = process({
      root,
      report: {},
      packageConfigs: [packageConfig('packages/group/a', {})],
    });
    const output = formatCoverageReport(result);

    assert.equal(result.ok, true);
    assert.equal(result.packages[0].present, false);
    assert.equal(result.packages[0].status, 'no-threshold');
    assert.equal(result.packages[0].metrics.lines.pct, 100);
    assert.match(output, /ABSENT FROM REPORT/);
    assert.match(output, /No source entries; no thresholds configured/);
    assert.doesNotMatch(output, /NO THRESHOLDS/);
  });

  it('identifies empty thresholds without failing', () => {
    const result = process({
      root,
      report: { 'packages/group/a/src/a.ts': record({ statements: [{ line: 1, hits: 0 }] }) },
      packageConfigs: [packageConfig('packages/group/a', {})],
    });

    assert.equal(result.ok, true);
    assert.equal(result.packages[0].status, 'no-threshold');
    assert.match(formatCoverageReport(result), /NO THRESHOLDS/);
  });

  it('suggests aggregate threshold increases with margin and cap', () => {
    const metrics = {
      lines: { total: 100, covered: 96, pct: 96 },
      statements: { total: 100, covered: 94, pct: 94 },
      branches: { total: 100, covered: 90, pct: 90 },
      functions: { total: 100, covered: 100, pct: 100 },
    };

    assert.deepEqual(
      suggestThresholdIncreases(
        metrics,
        { lines: 80, statements: 90, branches: 86, functions: 90 },
        5,
        95,
      ),
      {
        lines: { current: 80, actual: 96, suggested: 95 },
        functions: { current: 90, actual: 100, suggested: 95 },
      },
    );
  });

  it('renders passing and threshold suggestion summaries', () => {
    const result = process({
      root,
      report: {
        'packages/group/a/src/a.ts': record({
          statements: [{ line: 1, hits: 1 }],
          branches: [[1]],
          functions: [1],
        }),
      },
      packageConfigs: [
        packageConfig('packages/group/a', {
          lines: 80,
          statements: 80,
          branches: 80,
          functions: 80,
        }),
      ],
    });
    const output = formatCoverageReport(result);

    assert.match(output, /PASSING/);
    assert.match(output, /THRESHOLD INCREASE SUGGESTIONS/);
    assert.match(output, /lines: 80 -> 95/);
  });

  it('counts expired-warning deficits in the summary failure total', () => {
    const result = process({
      root,
      report: {
        'packages/group/a/src/a.ts': record({
          statements: [{ line: 1, hits: 0 }],
          branches: [[0]],
          functions: [0],
        }),
      },
      warnings: [warning()],
      now: new Date('2026-01-12T00:00:00Z'),
    });

    assert.equal(result.failures.length, 1);
    assert.match(formatCoverageReport(result), /Failures: 1/);
  });

  it('fails for missing and malformed root reports', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'coverage-report-files-'));
    try {
      await writeFile(
        join(fixture, 'coverage.config.json'),
        JSON.stringify({ warningOnly: [], excludedPackages: [] }),
      );
      await mkdir(join(fixture, 'packages/group/a'), { recursive: true });
      await writeFile(
        join(fixture, 'packages/group/a/coverage.config.json'),
        JSON.stringify({ include: [], exclude: [], thresholds: {} }),
      );

      await assert.rejects(() => runCoverageReport({ root: fixture }), /coverage-final\.json/);

      await mkdir(join(fixture, 'coverage'), { recursive: true });
      await writeFile(join(fixture, 'coverage/coverage-final.json'), '{not json');
      await assert.rejects(() => runCoverageReport({ root: fixture }), /Malformed coverage report/);

      await writeFile(join(fixture, 'coverage/coverage-final.json'), '[]');
      await assert.rejects(
        () => runCoverageReport({ root: fixture }),
        /coverage report must be an object/i,
      );
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });
});
