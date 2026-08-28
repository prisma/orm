#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const BIOME_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'biome');
const LINT_COMMAND = 'biome check . --error-on-warnings';
const EXCLUDED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'dist-tsc',
  'dist-tsc-prod',
  'coverage',
  '.next',
  '.turbo',
  'build',
]);

function* packageDirectories(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || EXCLUDED_DIRECTORIES.has(entry.name)) continue;
    const path = join(directory, entry.name);
    const manifestPath = join(path, 'package.json');
    if (existsSync(manifestPath)) yield path;
    yield* packageDirectories(path);
  }
}

function usesRootConfig(directory) {
  const configPath = join(directory, 'biome.jsonc');
  if (!existsSync(configPath)) return true;

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    const keys = Object.keys(config).filter((key) => key !== '$schema');
    return keys.length === 1 && keys[0] === 'extends' && config.extends === '//';
  } catch {
    return false;
  }
}

function readManifest(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot parse ${path}`, { cause: error });
  }
}

export function planWorkspaceLint(repoRoot, scope) {
  const batched = [];
  const custom = [];
  for (const directory of packageDirectories(join(repoRoot, scope))) {
    const manifest = readManifest(join(directory, 'package.json'));
    if (manifest.scripts?.lint !== LINT_COMMAND) continue;
    const destination = usesRootConfig(directory) ? batched : custom;
    destination.push(relative(repoRoot, directory));
  }
  return { batched: batched.sort(), custom: custom.sort() };
}

export function createBiomeRuns(repoRoot, plan) {
  const runs = [];
  if (plan.batched.length > 0) {
    runs.push({
      cwd: repoRoot,
      args: [
        'check',
        '--config-path',
        join(repoRoot, 'biome.jsonc'),
        '--error-on-warnings',
        ...plan.batched,
      ],
    });
  }
  for (const directory of plan.custom) {
    runs.push({
      cwd: join(repoRoot, directory),
      args: ['check', '.', '--error-on-warnings'],
    });
  }
  return runs;
}

function runBiome({ cwd, args }) {
  return new Promise((resolve, reject) => {
    const child = spawn(BIOME_BIN, args, { cwd, stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', (status) => resolve(status ?? 1));
  });
}

async function main() {
  const scope = process.argv[2];
  if (scope !== 'packages' && scope !== 'examples') {
    console.error('Usage: node scripts/lint-workspaces.mjs <packages|examples>');
    process.exit(1);
  }

  const plan = planWorkspaceLint(REPO_ROOT, scope);
  const statuses = await Promise.all(createBiomeRuns(REPO_ROOT, plan).map(runBiome));
  if (statuses.some((status) => status !== 0)) process.exit(1);
}

if (process.argv[1] === import.meta.filename) await main();
