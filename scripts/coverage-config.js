import { globSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { type } from 'arktype';

class CoverageConfigError extends Error {}

const Threshold = 'number.integer >= 0 <= 100';

const PackageCoverageConfig = type({
  include: 'string[]',
  exclude: 'string[]',
  thresholds: {
    'lines?': Threshold,
    'branches?': Threshold,
    'functions?': Threshold,
    'statements?': Threshold,
    '+': 'reject',
  },
  '+': 'reject',
});

const Warning = type({
  package: 'string',
  reason: 'string >= 10',
  addedDate: 'string',
  expiryDays: 'number.integer >= 1 <= 180',
  'assignee?': 'string | null',
  'linear?': 'string | null',
  'notes?': 'string | null',
  '+': 'reject',
});

const RootCoverageConfig = type({
  '$schema?': 'string',
  'description?': 'string',
  warningOnly: Warning.array(),
  excludedPackages: 'string[]',
  '+': 'reject',
});

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new CoverageConfigError(`Invalid JSON in ${path}`, { cause: error });
  }
}

function assertWithContext(schema, value, path) {
  try {
    return schema.assert(value);
  } catch (error) {
    throw new CoverageConfigError(`Invalid coverage config ${path}: ${error}`, { cause: error });
  }
}

function assertSafeRelativePath(value, description) {
  if (
    value.length === 0 ||
    value.startsWith('/') ||
    /^[A-Za-z]:\//.test(value) ||
    value.includes('\\') ||
    value.includes('..')
  ) {
    throw new CoverageConfigError(`Unsafe ${description}: ${JSON.stringify(value)}`);
  }
}

function assertSafeGlob(glob, path) {
  assertSafeRelativePath(glob, `glob in ${path}`);
}

function assertPackageName(packageName, path) {
  assertSafeRelativePath(packageName, `package path in ${path}`);
  const segments = packageName.split('/');
  if (
    packageName.startsWith('packages/') ||
    /^[A-Za-z]:/.test(packageName) ||
    segments.some((segment) => segment.length === 0 || segment === '.') ||
    /[*?{}[\]]/.test(packageName)
  ) {
    throw new CoverageConfigError(
      `Invalid package path in ${path}: ${JSON.stringify(packageName)}`,
    );
  }
}

function assertDistinct(values, description) {
  if (new Set(values).size !== values.length) {
    throw new CoverageConfigError(`Duplicate ${description}`);
  }
}

export function loadPackageCoverageConfig(path) {
  const config = assertWithContext(PackageCoverageConfig, readJson(path), path);
  for (const glob of [...config.include, ...config.exclude]) {
    assertSafeGlob(glob, path);
  }
  return config;
}

export function loadRootCoverageConfig(root) {
  const path = join(root, 'coverage.config.json');
  const config = assertWithContext(RootCoverageConfig, readJson(path), path);

  for (const entry of config.warningOnly) {
    assertPackageName(entry.package, path);
    const date = new Date(`${entry.addedDate}T00:00:00.000Z`);
    if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== entry.addedDate) {
      throw new CoverageConfigError(
        `Invalid addedDate in ${path}: ${JSON.stringify(entry.addedDate)}`,
      );
    }
  }
  for (const packageName of config.excludedPackages) {
    assertPackageName(packageName, path);
  }

  const warnings = config.warningOnly.map((entry) => entry.package);
  assertDistinct(warnings, 'warning-only package entry');
  assertDistinct(config.excludedPackages, 'excluded package entry');
  const excluded = new Set(config.excludedPackages);
  if (warnings.some((packageName) => excluded.has(packageName))) {
    throw new CoverageConfigError('A package cannot be both warning-only and excluded');
  }

  return config;
}

export function discoverCoverageConfigs(root) {
  const paths = globSync('packages/**/coverage.config.json', { cwd: root }).sort();
  const packageDirs = new Set();
  return paths.map((path) => {
    const configPath = resolve(root, path);
    const packageDir = relative(root, dirname(configPath)).split(sep).join('/');
    if (packageDirs.has(packageDir)) {
      throw new CoverageConfigError(`Duplicate coverage policy for ${packageDir}`);
    }
    packageDirs.add(packageDir);
    return {
      packageDir,
      configPath,
      config: loadPackageCoverageConfig(configPath),
    };
  });
}

export function rebasePackageGlob(packageDir, glob) {
  assertSafeRelativePath(packageDir, 'package directory');
  assertSafeGlob(glob, packageDir);
  return `${packageDir}/${glob}`;
}

export function classifyWarning(warningEntry, now) {
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) {
    throw new CoverageConfigError('now must be a valid Date');
  }
  const expiry = new Date(`${warningEntry.addedDate}T00:00:00.000Z`);
  expiry.setUTCDate(expiry.getUTCDate() + warningEntry.expiryDays);
  const expiryDate = expiry.toISOString().slice(0, 10);
  return {
    expiryDate,
    active: now.toISOString().slice(0, 10) <= expiryDate,
  };
}

export function composeCoverageConfig(root, now = new Date()) {
  const rootConfig = loadRootCoverageConfig(root);
  const excluded = new Set(rootConfig.excludedPackages.map((path) => `packages/${path}`));
  const activeWarnings = new Set(
    rootConfig.warningOnly
      .filter((entry) => classifyWarning(entry, now).active)
      .map((entry) => `packages/${entry.package}`),
  );
  const include = [];
  const exclude = [];
  const thresholds = {};

  for (const { packageDir, config } of discoverCoverageConfigs(root)) {
    if (excluded.has(packageDir)) continue;
    include.push(...config.include.map((glob) => rebasePackageGlob(packageDir, glob)));
    exclude.push(...config.exclude.map((glob) => rebasePackageGlob(packageDir, glob)));
    if (!activeWarnings.has(packageDir)) {
      thresholds[`${packageDir}/**`] = config.thresholds;
    }
  }

  return { include, exclude, thresholds };
}
