#!/usr/bin/env node
/**
 * Downloads the mongod binary that mongodb-memory-server starts, so no test
 * downloads it. Run once per CI job after `pnpm install`. Without it, test
 * packages that start in parallel each download the binary into one shared
 * folder and fail on its lock file.
 *
 * `--print-version` prints the MongoDB version instead, for a cache key.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withRetries } from './retry-command.mjs';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');

export function removeLockFiles(folder) {
  if (!existsSync(folder)) return;
  for (const name of readdirSync(folder, { withFileTypes: true })) {
    if (name.isFile() && name.name.endsWith('.lock')) rmSync(join(folder, name.name));
  }
}

function loadMongoMemoryServer() {
  const fromIntegrationTests = createRequire(join(repoRoot, 'test/integration/package.json'));
  const fromServer = createRequire(fromIntegrationTests.resolve('mongodb-memory-server'));
  const core = fromServer('mongodb-memory-server-core');
  return {
    MongoBinary: core.MongoBinary,
    DryMongoBinary: core.DryMongoBinary,
    resolveConfig: fromServer('mongodb-memory-server-core/lib/util/resolveConfig').resolveConfig,
  };
}

export function downloadMongod({ MongoBinary, DryMongoBinary, folder, ownsBinary, wait }) {
  return withRetries(() => downloadAndCheck(MongoBinary, ownsBinary), {
    attempts: 4,
    delayMs: 5000,
    beforeRetry: () => {
      removeLockFiles(folder);
      DryMongoBinary.binaryCache.clear();
    },
    wait,
  });
}

async function downloadAndCheck(MongoBinary, ownsBinary) {
  const binary = await MongoBinary.getPath();
  try {
    execFileSync(binary, ['--version'], { stdio: 'ignore' });
  } catch (error) {
    if (!ownsBinary) throw new Error(`${binary} does not run: ${error.message}`);
    rmSync(binary, { force: true });
    throw new Error(`${binary} does not run, so it was deleted: ${error.message}`);
  }
  return binary;
}

async function main() {
  const { MongoBinary, DryMongoBinary, resolveConfig } = loadMongoMemoryServer();
  if (process.argv.includes('--print-version')) {
    console.log(resolveConfig('VERSION'));
    return;
  }
  const folder = resolveConfig('DOWNLOAD_DIR') ?? join(homedir(), '.cache', 'mongodb-binaries');
  const binary = await downloadMongod({
    MongoBinary,
    DryMongoBinary,
    folder,
    ownsBinary: resolveConfig('SYSTEM_BINARY') === undefined,
    wait: undefined,
  });
  console.log(`mongod is ready at ${binary}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
