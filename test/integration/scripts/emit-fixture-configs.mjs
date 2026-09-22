#!/usr/bin/env node
/**
 * Re-emits every PSL fixture under the listed test roots by running
 * `prisma contract emit --config <prisma.config.ts>` for each config found.
 * Covers the ported-test corpus (`test/ports/**`) and the per-suite fixtures
 * that are too many to list one by one in the `emit` script of package.json.
 *
 * Only configs with a committed `generated/` sibling are emitted: a config
 * without one belongs to a non-ported suite or is emitted to a temp dir by its
 * own test (see relation-mode-gh-m-to-n/emit-map.test.ts).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = resolve(packageRoot, '../../packages/1-framework/3-tooling/cli/dist/bin.mjs');
const fixtureRoots = ['test/ports', 'test/enum-order-by', 'test/sql-builder/fixtures'];

function findConfigs(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...findConfigs(path));
    } else if (entry.name === 'prisma.config.ts' && existsSync(join(dir, 'generated'))) {
      found.push(path);
    }
  }
  return found.sort();
}

const configs = fixtureRoots.flatMap((root) => findConfigs(join(packageRoot, root)));
let failures = 0;
for (const config of configs) {
  try {
    execFileSync(process.execPath, [cli, 'contract', 'emit', '--config', config], {
      cwd: packageRoot,
      stdio: ['ignore', 'ignore', 'pipe'],
      encoding: 'utf8',
    });
  } catch (err) {
    failures++;
    process.stderr.write(
      `emit-fixture-configs: failed for ${config}\n${err.stderr ?? err.message}\n`,
    );
  }
}
process.stdout.write(
  `emit-fixture-configs: emitted ${configs.length - failures}/${configs.length} fixtures\n`,
);
if (failures > 0) process.exit(1);
