import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'dist-tsc',
  'dist-tsc-prod',
  'coverage',
  '.tmp-output',
  '.turbo',
]);

/**
 * Every package under `root`, sorted by directory. A package is publishable
 * when its package.json does not set `"private": true`.
 *
 * @param {string} [root]
 * @returns {Array<{ dir: string; publishable: boolean }>}
 */
export function listWorkspacePackages(root = 'packages') {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else if (entry === 'package.json') {
        const pkg = JSON.parse(readFileSync(path, 'utf8'));
        found.push({ dir, publishable: pkg?.private !== true });
      }
    }
  };
  walk(root);
  return found.sort((a, b) => a.dir.localeCompare(b.dir));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const publishable = listWorkspacePackages().filter((pkg) => pkg.publishable);
  console.log(publishable.map((pkg) => `./${pkg.dir}`).join(' '));
}
