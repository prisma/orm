#!/usr/bin/env node

/**
 * Incremental dependency validation for lint-staged
 *
 * Runs Dependency Cruiser only on packages that have staged files,
 * falling back to full check if no staged files or on error.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

// Get staged files from git
function getStagedFiles() {
  try {
    const output = execSync('git diff --cached --name-only --diff-filter=ACM', {
      encoding: 'utf-8',
      cwd: repoRoot,
    });
    return output
      .split('\n')
      .filter((line) => line.trim())
      .filter(
        (line) =>
          line.endsWith('.ts') ||
          line.endsWith('.tsx') ||
          line.endsWith('.js') ||
          line.endsWith('.jsx'),
      )
      .filter((line) => !line.endsWith('.d.ts'))
      .filter(
        (line) => !line.includes('/test/') && !line.includes('.test.') && !line.includes('.spec.'),
      );
  } catch {
    return [];
  }
}

// Extract unique package roots from file paths
function getPackageRoots(files) {
  const packageRoots = new Set();
  for (const file of files) {
    if (!file.startsWith('packages/')) continue;

    // Walk up from the file's directory to find the nearest package.json.
    // This supports nested monorepo layouts like:
    // - packages/1-framework/0-foundation/contract/...
    // - packages/2-sql-family/4-lanes/sql-lane/...
    let currentDir = join(repoRoot, dirname(file));
    const packagesRoot = join(repoRoot, 'packages');

    while (currentDir.startsWith(packagesRoot)) {
      const pkgJson = join(currentDir, 'package.json');
      if (existsSync(pkgJson)) {
        packageRoots.add(relative(repoRoot, currentDir));
        break;
      }
      const parent = dirname(currentDir);
      if (parent === currentDir) break;
      currentDir = parent;
    }
  }
  return Array.from(packageRoots);
}

function tryReadPackageName(packageRoot) {
  try {
    const pkgJsonPath = join(repoRoot, packageRoot, 'package.json');
    const json = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
    const name = json?.name;
    return typeof name === 'string' && name.length > 0 ? name : undefined;
  } catch {
    return undefined;
  }
}

// Main execution
const stagedFiles = getStagedFiles();

if (stagedFiles.length === 0) {
  // No staged files, skip check
  console.log('No staged TypeScript files found, skipping dependency check');
  process.exit(0);
}

const packageRoots = getPackageRoots(stagedFiles);

if (packageRoots.length === 0) {
  // No package roots found, skip check
  console.log('No package roots found in staged files, skipping dependency check');
  process.exit(0);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Build include-only pattern from package roots.
// Example roots:
// - packages/1-framework/0-foundation/contract
// - packages/2-sql-family/4-lanes/sql-lane
const includePattern = `^(${packageRoots.map(escapeRegex).join('|')})(/|$)`;

const packageNames = packageRoots
  .map((root) => tryReadPackageName(root))
  .filter((name) => typeof name === 'string');

console.log(
  `Running dependency check on staged packages: ${
    packageNames.length > 0 ? packageNames.join(', ') : packageRoots.join(', ')
  }`,
);

try {
  // Run depcruise with --include-only on the affected packages
  execSync(
    `pnpm depcruise --config dependency-cruiser.config.mjs --include-only "${includePattern}" packages`,
    {
      stdio: 'inherit',
      cwd: repoRoot,
    },
  );
} catch (_error) {
  // If focused check fails, fall back to full check
  console.log('Focused check failed, falling back to full dependency check...');
  try {
    execSync('pnpm depcruise --config dependency-cruiser.config.mjs packages', {
      stdio: 'inherit',
      cwd: repoRoot,
    });
  } catch (_fallbackError) {
    process.exit(1);
  }
}
