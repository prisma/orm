import assert from 'node:assert/strict';
import { glob, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  classifyWarning,
  composeCoverageConfig,
  discoverCoverageConfigs,
  loadPackageCoverageConfig,
  rebasePackageGlob,
} from './coverage-config.js';

const packagePolicy = {
  include: ['src/**/*.{ts,tsx}'],
  exclude: ['dist/**', '**/*.test.ts'],
  thresholds: { lines: 90, branches: 80, functions: 70, statements: 60 },
};

async function writeJson(root, path, value) {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeProject(root, packageDir, policy = packagePolicy) {
  await writeJson(root, `${packageDir}/coverage.config.json`, policy);
  await writeFile(join(root, packageDir, 'vitest.config.ts'), 'export default { test: {} };\n');
}

async function writeRootPolicy(root, value = { warningOnly: [], excludedPackages: [] }) {
  await writeJson(root, 'coverage.config.json', value);
}

function warning(overrides = {}) {
  return {
    package: 'group/a',
    reason: 'Coverage recovery needs dedicated tests.',
    addedDate: '2026-01-01',
    expiryDays: 10,
    assignee: null,
    linear: null,
    notes: null,
    ...overrides,
  };
}

describe('coverage config', () => {
  let root;

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'coverage-config-'));
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('discovers package policies in deterministic order', async () => {
    await writeProject(root, 'packages/z');
    await writeProject(root, 'packages/a');

    const configs = discoverCoverageConfigs(root);

    assert.deepEqual(
      configs.map(({ packageDir }) => packageDir),
      ['packages/a', 'packages/z'],
    );
  });

  it('rebases package globs without expanding braces', () => {
    assert.equal(
      rebasePackageGlob('packages/group/a', 'src/**/*.{ts,tsx}'),
      'packages/group/a/src/**/*.{ts,tsx}',
    );
  });

  it('composes includes, excludes, empty thresholds, and full thresholds', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'coverage-compose-'));
    try {
      await writeRootPolicy(fixture);
      await writeProject(fixture, 'packages/group/a', packagePolicy);
      await writeProject(fixture, 'packages/group/b', {
        include: [],
        exclude: [],
        thresholds: {},
      });

      assert.deepEqual(composeCoverageConfig(fixture, new Date('2026-01-01T12:00:00Z')), {
        include: ['packages/group/a/src/**/*.{ts,tsx}'],
        exclude: ['packages/group/a/dist/**', 'packages/group/a/**/*.test.ts'],
        thresholds: {
          'packages/group/a/**': packagePolicy.thresholds,
          'packages/group/b/**': {},
        },
      });
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('keeps warnings active through the expiry date', () => {
    assert.deepEqual(classifyWarning(warning(), new Date('2026-01-11T23:59:59Z')), {
      expiryDate: '2026-01-11',
      active: true,
    });
    assert.deepEqual(classifyWarning(warning(), new Date('2026-01-12T00:00:00Z')), {
      expiryDate: '2026-01-11',
      active: false,
    });
  });

  it('omits active-warning thresholds but retains expired thresholds', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'coverage-warning-'));
    try {
      await writeProject(fixture, 'packages/group/a');
      await writeProject(fixture, 'packages/group/b');
      await writeRootPolicy(fixture, {
        warningOnly: [warning(), warning({ package: 'group/b', addedDate: '2025-01-01' })],
        excludedPackages: [],
      });

      assert.deepEqual(
        composeCoverageConfig(fixture, new Date('2026-01-11T12:00:00Z')).thresholds,
        { 'packages/group/b/**': packagePolicy.thresholds },
      );
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('omits excluded packages from collection and composition', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'coverage-excluded-'));
    try {
      await writeProject(fixture, 'packages/group/a');
      await writeProject(fixture, 'packages/group/b');
      await writeRootPolicy(fixture, {
        warningOnly: [],
        excludedPackages: ['group/a'],
      });

      assert.deepEqual(composeCoverageConfig(fixture, new Date('2026-01-01T12:00:00Z')), {
        include: ['packages/group/b/src/**/*.{ts,tsx}'],
        exclude: ['packages/group/b/dist/**', 'packages/group/b/**/*.test.ts'],
        thresholds: { 'packages/group/b/**': packagePolicy.thresholds },
      });
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('rejects malformed, unknown, unsafe, and out-of-range package policies', async () => {
    const invalid = [
      { include: [], exclude: [] },
      { include: [], exclude: [], thresholds: {}, extra: true },
      { include: ['/src/**'], exclude: [], thresholds: {} },
      { include: ['src\\**'], exclude: [], thresholds: {} },
      { include: ['../src/**'], exclude: [], thresholds: {} },
      { include: ['{src,..}/**'], exclude: [], thresholds: {} },
      { include: [], exclude: [], thresholds: { lines: -1 } },
      { include: [], exclude: [], thresholds: { lines: 101 } },
      { include: [], exclude: [], thresholds: { lines: 90.5 } },
      { include: [], exclude: [], thresholds: { unknown: 90 } },
    ];

    for (const [index, policy] of invalid.entries()) {
      const path = join(root, `invalid-${index}.json`);
      await writeFile(path, JSON.stringify(policy));
      assert.throws(() => loadPackageCoverageConfig(path));
    }
  });

  it('accepts threshold boundaries', async () => {
    const path = join(root, 'boundaries.json');
    const policy = {
      include: [],
      exclude: [],
      thresholds: { lines: 0, branches: 100, functions: 0, statements: 100 },
    };
    await writeFile(path, JSON.stringify(policy));

    assert.deepEqual(loadPackageCoverageConfig(path), policy);
  });

  it('rejects malformed warning entries and unsafe excluded packages', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'coverage-root-invalid-'));
    try {
      const invalid = [
        { warningOnly: [{ ...warning(), unknown: true }], excludedPackages: [] },
        { warningOnly: [warning({ addedDate: '2026-02-30' })], excludedPackages: [] },
        { warningOnly: [warning({ package: './group/a' })], excludedPackages: [] },
        { warningOnly: [warning({ package: 'group/./a' })], excludedPackages: [] },
        { warningOnly: [], excludedPackages: ['../group/a'] },
        { warningOnly: [], excludedPackages: ['packages/group/a'] },
        { warningOnly: [], excludedPackages: ['./group/a'] },
        { warningOnly: [], excludedPackages: ['group//a'] },
        { warningOnly: [], excludedPackages: ['C:group/a'] },
      ];
      for (const policy of invalid) {
        await writeRootPolicy(fixture, policy);
        assert.throws(() => composeCoverageConfig(fixture, new Date('2026-01-01T12:00:00Z')));
      }
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('rejects duplicate warning and excluded package entries', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'coverage-duplicates-'));
    try {
      await writeRootPolicy(fixture, {
        warningOnly: [warning(), warning()],
        excludedPackages: [],
      });
      assert.throws(() => composeCoverageConfig(fixture, new Date('2026-01-01T12:00:00Z')));

      await writeRootPolicy(fixture, {
        warningOnly: [],
        excludedPackages: ['group/a', 'group/a'],
      });
      assert.throws(() => composeCoverageConfig(fixture, new Date('2026-01-01T12:00:00Z')));
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('every package Vitest project owns JSON and no TS config retains coverage', async () => {
    const repositoryRoot = join(import.meta.dirname, '..');
    const configs = discoverCoverageConfigs(repositoryRoot);
    const vitestPaths = [];
    for await (const path of glob('packages/**/vitest.config.ts', { cwd: repositoryRoot })) {
      vitestPaths.push(path);
    }
    vitestPaths.sort();

    assert.equal(vitestPaths.length, 69);
    assert.deepEqual(
      configs.map(({ configPath }) => relative(repositoryRoot, configPath)),
      vitestPaths.map((path) => path.replace('vitest.config.ts', 'coverage.config.json')),
    );
    for (const path of vitestPaths) {
      const source = await readFile(join(repositoryRoot, path), 'utf8');
      assert.doesNotMatch(source, /\bcoverage\s*:/);
    }
  });

  it('runs package coverage once from the root without package entry points', async () => {
    const repositoryRoot = join(import.meta.dirname, '..');
    const rootManifest = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'));

    assert.equal(
      rootManifest.scripts['coverage:packages'],
      "turbo run build --filter='!./examples/**' --filter='!./test/**' && vitest run --coverage",
    );
    assert.equal(rootManifest.scripts['test:coverage'], 'pnpm coverage:packages');
    assert.equal(
      rootManifest.scripts['coverage:packages:merge'],
      'vitest --merge-reports=.vitest/blob --coverage',
    );
    assert.equal(rootManifest.scripts['coverage:report'], 'node scripts/coverage-report.mjs');

    for await (const path of glob('packages/**/package.json', { cwd: repositoryRoot })) {
      const manifest = JSON.parse(await readFile(join(repositoryRoot, path), 'utf8'));
      assert.equal(manifest.scripts?.['test:coverage'], undefined, path);
      assert.equal(manifest.scripts?.['~test:coverage'], undefined, path);
    }

    const turbo = await readFile(join(repositoryRoot, 'turbo.json'), 'utf8');
    assert.doesNotMatch(turbo, /^\s*"test:coverage"\s*:/m);

    const rootVitestConfig = await readFile(join(repositoryRoot, 'vitest.config.ts'), 'utf8');
    assert.match(rootVitestConfig, /from ['"]\.\/scripts\/coverage-config['"]/);
    assert.doesNotMatch(rootVitestConfig, /from ['"]\.\/scripts\/coverage-config\.[^'"]+['"]/);
    assert.match(rootVitestConfig, /provider:\s*['"]v8['"]/);
    assert.match(rootVitestConfig, /process\.env\[['"]VITEST_COVERAGE_SHARD['"]\]/);
    assert.match(
      rootVitestConfig,
      /thresholds:\s*coverageShard\s*\?\s*\{\}\s*:\s*coveragePolicy\.thresholds/,
    );
    assert.match(rootVitestConfig, /reportOnFailure:\s*true/);
  });

  it('fans sharded coverage artifacts into one stable Test gate', async () => {
    const repositoryRoot = join(import.meta.dirname, '..');
    const workflow = await readFile(join(repositoryRoot, '.github/workflows/ci.yml'), 'utf8');
    const shardJob = workflow.match(
      /\n {2}test-packages:\n(?<body>[\s\S]*?)(?=\n {2}test-examples:\n)/,
    )?.groups?.body;
    const examplesJob = workflow.match(
      /\n {2}test-examples:\n(?<body>[\s\S]*?)(?=\n {2}coverage:\n)/,
    )?.groups?.body;
    const coverageJob = workflow.match(/\n {2}coverage:\n(?<body>[\s\S]*?)(?=\n {2}test:\n)/)
      ?.groups?.body;
    const testJob = workflow.match(/\n {2}test:\n(?<body>[\s\S]*?)(?=\n {2}test-e2e:\n)/)?.groups
      ?.body;

    assert.ok(shardJob);
    assert.match(shardJob, /^ {4}name: Package Tests \(\$\{\{ matrix\.index \}\}\/4\)$/m);
    assert.match(shardJob, /^ {4}if: needs\.changes\.outputs\.inert != 'true'$/m);
    assert.match(shardJob, /index: \[1, 2, 3, 4\]/);
    assert.match(shardJob, /VITEST_COVERAGE_SHARD: \$\{\{ matrix\.index \}\}/);
    assert.match(
      shardJob,
      /run: pnpm coverage:packages --reporter=default --reporter=github-actions --reporter=blob --shard=\$\{\{ matrix\.index \}\}\/4/,
    );
    assert.match(
      shardJob,
      /uses: actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/,
    );
    assert.match(shardJob, /name: package-coverage-\$\{\{ matrix\.index \}\}/);
    assert.match(shardJob, /path: \.vitest\/blob\/blob-\$\{\{ matrix\.index \}\}-4\.json/);
    assert.match(shardJob, /if-no-files-found: error/);
    assert.match(shardJob, /include-hidden-files: true/);
    assert.match(
      shardJob,
      /continue-on-error: true[\s\S]*if: steps\.package-tests\.outcome == 'failure'\n {8}run: exit 1/,
    );

    assert.ok(examplesJob);
    assert.match(examplesJob, /^ {4}name: Test Examples$/m);
    assert.match(examplesJob, /^ {4}needs: \[build, changes\]$/m);
    assert.match(examplesJob, /run: pnpm test:examples/);

    assert.ok(coverageJob);
    assert.match(coverageJob, /^ {4}name: Coverage$/m);
    assert.match(coverageJob, /^ {4}needs: \[build, changes, test-packages\]$/m);
    assert.doesNotMatch(coverageJob, /^ {4}services:/m);
    assert.match(
      coverageJob,
      /uses: actions\/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c/,
    );
    assert.match(coverageJob, /pattern: package-coverage-\*/);
    assert.match(coverageJob, /path: \.vitest\/blob/);
    assert.match(coverageJob, /merge-multiple: true/);
    assert.equal(coverageJob.match(/test -f \.vitest\/blob\/blob-[1-4]-4\.json/g)?.length, 4);
    assert.match(
      coverageJob,
      /run: pnpm coverage:packages:merge\n {6}- name: Report package coverage\n {8}if: \$\{\{ !cancelled\(\) \}\}\n {8}run: pnpm coverage:report/,
    );

    assert.ok(testJob);
    assert.match(testJob, /^ {4}name: Test$/m);
    assert.match(
      testJob,
      /^ {4}needs: \[build, changes, test-packages, test-examples, coverage\]$/m,
    );
    assert.match(testJob, /needs\.test-packages\.result != 'success'/);
    assert.match(testJob, /needs\.test-examples\.result != 'success'/);
    assert.match(testJob, /needs\.coverage\.result != 'success'/);
    assert.match(testJob, /run: exit 1/);

    assert.doesNotMatch(workflow, /actions\/cache\/(?:save|restore)@/);
    assert.equal(workflow.match(/run: pnpm coverage:packages:merge/g)?.length, 1);
    assert.equal(workflow.match(/run: pnpm coverage:report/g)?.length, 1);
    assert.equal(workflow.match(/run: pnpm test:examples/g)?.length, 1);
  });
});
