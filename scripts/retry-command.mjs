#!/usr/bin/env node
/**
 * Runs a CI setup command again when it fails, for steps that fail on network
 * errors (an image pull, a registry download).
 *
 *   node scripts/retry-command.mjs [--attempts 3] [--before-retry '<shell command>'] -- <command> [args...]
 *
 * `--before-retry` runs between attempts, to undo what a failed attempt left
 * behind (for example `supabase stop --no-backup`).
 */

import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

export async function withRetries(attempt, { attempts, delayMs, beforeRetry, wait = sleep }) {
  for (let number = 1; ; number++) {
    try {
      return await attempt();
    } catch (error) {
      if (number === attempts) throw error;
      console.warn(`Attempt ${number} of ${attempts} failed: ${error.message}`);
      await beforeRetry();
      await wait(delayMs * number);
    }
  }
}

export function parseArguments(argv) {
  const separator = argv.indexOf('--');
  if (separator === -1 || separator === argv.length - 1) {
    throw new Error(
      'Usage: retry-command.mjs [--attempts N] [--before-retry <shell command>] -- <command> [args...]',
    );
  }
  const options = { attempts: 3, beforeRetry: undefined };
  const flags = argv.slice(0, separator);
  for (let index = 0; index < flags.length; index += 2) {
    const [flag, value] = [flags[index], flags[index + 1]];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (flag === '--attempts') options.attempts = Number.parseInt(value, 10);
    else if (flag === '--before-retry') options.beforeRetry = value;
    else throw new Error(`Unknown option ${flag}`);
  }
  if (!Number.isInteger(options.attempts) || options.attempts < 1) {
    throw new Error('--attempts must be a positive whole number');
  }
  return { ...options, command: argv[separator + 1], args: argv.slice(separator + 2) };
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${result.status ?? result.signal}`);
  }
}

function runCleanup(shellCommand) {
  const result = spawnSync('bash', ['-c', shellCommand], { stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    console.warn(
      `${shellCommand} failed (${result.error?.message ?? result.status ?? result.signal}); retrying anyway`,
    );
  }
}

async function main() {
  const { attempts, beforeRetry, command, args } = parseArguments(process.argv.slice(2));
  await withRetries(() => run(command, args), {
    attempts,
    delayMs: 10_000,
    beforeRetry: () => {
      if (beforeRetry !== undefined) runCleanup(beforeRetry);
    },
  });
}

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
