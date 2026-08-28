#!/usr/bin/env node

import { spawn } from 'node:child_process';

const DEFAULT_CONCURRENCY = 4;

export function createLintTasks(base) {
  return [
    { name: 'packages', args: ['lint:packages:ci'] },
    { name: 'deps', args: ['lint:deps'] },
    { name: 'script_tests', args: ['test:scripts'] },
    { name: 'ratchets', args: ['lint:ratchets'] },
    { name: 'legacy_name', args: ['lint:legacy-name'] },
    { name: 'examples', args: ['lint:examples:ci'] },
    { name: 'code', args: ['lint:code'] },
    { name: 'rules', args: ['lint:rules'] },
    { name: 'rule_symlinks', args: ['lint:rules:symlinks'] },
    { name: 'skills', args: ['lint:skills'] },
    { name: 'rule_footprint', args: ['lint:rules:footprint'] },
    { name: 'docs', args: ['lint:docs'] },
    { name: 'manifests', args: ['lint:manifests'] },
    { name: 'workflows', args: ['lint:workflows'] },
    { name: 'consumer_imports', args: ['lint:consumer-internal-imports'] },
    { name: 'publishability', args: ['lint:publishability'] },
    {
      name: 'upgrade_coverage',
      args: ['check:upgrade-coverage', '--mode', 'pr', '--prev', `origin/${base}`],
    },
    { name: 'error_reference', args: ['check:error-reference'] },
    {
      name: 'release_notes',
      args: ['check:release-notes', '--mode', 'pr', '--prev', `origin/${base}`],
    },
  ];
}

export async function runTasks(tasks, concurrency, execute) {
  let next = 0;
  const failures = [];

  async function worker() {
    while (next < tasks.length) {
      const task = tasks[next];
      next += 1;
      if ((await execute(task)) !== 0) failures.push(task.name);
    }
  }

  const workerCount = Math.min(concurrency, tasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return failures;
}

function executeTask(task) {
  const start = Date.now();
  console.log(`[lint:ci] start ${task.name}: pnpm ${task.args.join(' ')}`);
  return new Promise((resolve) => {
    const child = spawn('pnpm', task.args, { stdio: 'inherit' });
    child.once('error', (error) => {
      console.error(`[lint:ci] ${task.name} failed to start: ${error.message}`);
      resolve(1);
    });
    child.once('close', (status) => {
      const elapsed = ((Date.now() - start) / 1000).toFixed(3);
      console.log(`[lint:ci] finish ${task.name}: status=${status ?? 1}`);
      console.log(`LINT_METRIC ${task.name}_s=${elapsed}`);
      resolve(status ?? 1);
    });
  });
}

function concurrencyFromEnvironment() {
  const parsed = Number.parseInt(process.env.LINT_CONCURRENCY ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_CONCURRENCY;
}

async function main() {
  const base = process.env.BASE || 'main';
  const failures = await runTasks(createLintTasks(base), concurrencyFromEnvironment(), executeTask);
  if (failures.length > 0) {
    console.error(`[lint:ci] failed: ${failures.join(', ')}`);
    process.exit(1);
  }
}

if (process.argv[1] === import.meta.filename) await main();
