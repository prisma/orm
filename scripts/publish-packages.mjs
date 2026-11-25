#!/usr/bin/env node

/**
 * Publishes every publishable workspace package to npm in parallel.
 *
 * `pnpm -r publish` is intentionally serialized (it rejects
 * `--workspace-concurrency` outright), and serial publish of ~60
 * packages takes 5–10 minutes on CI because each package pays for a
 * fresh npm upload + Sigstore signing round-trip. This script fans
 * the same `pnpm publish` invocations out across N workers, which
 * brings wall-clock time down by close to the concurrency factor.
 *
 * Usage:
 *   node scripts/publish-packages.mjs --tag <dist-tag> [--dry-run]
 *
 * Env:
 *   PUBLISH_CONCURRENCY  Override the parallelism (default 8).
 *
 * Tags:
 *   A `--tag latest` publish is a release: each package goes under the tag
 *   the release plan gives it for the root version (`latest` for every
 *   package on the release candidates). Any other tag applies to every
 *   package.
 *
 * Failure semantics:
 *   - If any package fails to publish, the script exits non-zero
 *     once all already-started workers have finished. Other workers
 *     are not interrupted — partial-failure cleanup is the same
 *     situation a serial publish would leave behind, and aborting
 *     mid-batch wouldn't unpublish what's already on the registry.
 *   - A `pnpm publish` that fails because the version is already on
 *     the registry ("You cannot publish over the previously published
 *     versions") is treated as a no-op success. This makes the batch
 *     idempotent: re-running after a partial failure (the documented
 *     recovery path) completes cleanly for packages that already
 *     landed and only retries the ones that didn't. See
 *     `publish-packages-utils.mjs` for the classification rule.
 *   - Each worker's stdout/stderr is captured and printed grouped by
 *     package (with GitHub Actions `::group::` markers when running
 *     under Actions) so failures are easy to find in interleaved CI logs.
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  classifyPublishResult,
  ownVersionsAlreadyPublished,
  publishTagFor,
  releaseTagsFor,
} from './publish-packages-utils.mjs';

const args = process.argv.slice(2);
let tag;
let dryRun = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--tag') {
    tag = args[++i];
  } else if (args[i] === '--dry-run') {
    dryRun = true;
  } else {
    console.error(`Unknown argument: ${args[i]}`);
    process.exit(2);
  }
}

if (!tag) {
  console.error('Usage: publish-packages.mjs --tag <dist-tag> [--dry-run]');
  process.exit(2);
}

const concurrency = Number.parseInt(process.env.PUBLISH_CONCURRENCY ?? '8', 10);
if (!Number.isInteger(concurrency) || concurrency < 1) {
  console.error(`Invalid PUBLISH_CONCURRENCY: ${process.env.PUBLISH_CONCURRENCY}`);
  process.exit(2);
}

const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';

const listJson = execFileSync('pnpm', ['list', '-r', '--json', '--depth', '-1'], {
  encoding: 'utf-8',
  maxBuffer: 64 * 1024 * 1024,
});
const listed = JSON.parse(listJson)
  .filter((p) => !p.private && p.path && p.name)
  .map((p) => ({ name: p.name, path: p.path, version: p.version }));
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const rootVersion = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8')).version;
const skipped = new Set(
  ownVersionsAlreadyPublished({ rootVersion, packages: listed, publishedVersions }),
);
for (const name of skipped) console.log(`  ${name}: skipped, already published at this version`);
const packages = listed.filter(({ name }) => !skipped.has(name));

const tags =
  tag === 'latest'
    ? releaseTagsFor({
        rootDir,
        rootVersion,
        names: packages.map(({ name }) => name),
        publishedVersions,
      })
    : new Map();
const tagOf = (name) => publishTagFor(tag, tags.get(name));

console.log(
  `Publishing ${packages.length} packages with concurrency=${concurrency}, tag=${tag}${dryRun ? ' (dry-run)' : ''}.`,
);
for (const { name } of packages) {
  if (tagOf(name) !== tag) console.log(`  ${name} goes under ${tagOf(name)}`);
}

function publishedVersions(name) {
  const result = spawnSync('pnpm', ['view', name, 'versions', '--json'], { encoding: 'utf-8' });
  if (result.status !== 0) {
    if (/E404|404 Not Found/.test(`${result.stdout}${result.stderr}`)) return [];
    console.error(`Could not read the published versions of ${name}:\n${result.stderr}`);
    process.exit(1);
  }
  const versions = JSON.parse(result.stdout);
  return Array.isArray(versions) ? versions : [versions];
}

/**
 * Spawn `pnpm publish` for a single package and resolve with a
 * structured result. Output is buffered (not streamed) so logs from
 * different packages don't interleave in CI.
 */
function publishOne({ name, path }) {
  return new Promise((resolve) => {
    const publishArgs = ['publish', '--access', 'public', '--tag', tagOf(name), '--no-git-checks'];
    if (dryRun) publishArgs.push('--dry-run');

    const child = spawn('pnpm', publishArgs, { cwd: path, env: process.env });
    const chunks = [];
    child.stdout.on('data', (c) => chunks.push(c));
    child.stderr.on('data', (c) => chunks.push(c));
    child.on('close', (code) => {
      resolve({ name, code: code ?? 1, output: Buffer.concat(chunks).toString('utf-8') });
    });
    child.on('error', (err) => {
      resolve({ name, code: 1, output: `spawn error: ${err.message}` });
    });
  });
}

const queue = [...packages];
const failures = [];
let completed = 0;

let alreadyPublishedCount = 0;

async function worker() {
  for (;;) {
    const pkg = queue.shift();
    if (!pkg) return;
    let result = await publishOne(pkg);
    let classification = classifyPublishResult(result);
    if (!classification.ok && classification.retryable) {
      console.log(`retrying ${result.name} after transient publish failure (exit ${result.code})`);
      result = await publishOne(pkg);
      classification = classifyPublishResult(result);
    }
    const { ok, alreadyPublished } = classification;
    completed += 1;
    if (alreadyPublished) alreadyPublishedCount += 1;
    const status = alreadyPublished ? '↺' : ok ? '✓' : '✗';
    const groupOpen = isGitHubActions
      ? `::group::${status} ${result.name} (${completed}/${packages.length})`
      : `--- ${status} ${result.name} (${completed}/${packages.length}) ---`;
    const groupClose = isGitHubActions ? '::endgroup::' : '';
    console.log(groupOpen);
    if (result.output.trim().length > 0) console.log(result.output.trimEnd());
    if (groupClose) console.log(groupClose);
    if (!ok) failures.push(result);
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, packages.length) }, worker));

if (failures.length > 0) {
  console.error(`\n${failures.length} package(s) failed to publish:`);
  for (const f of failures) console.error(`  - ${f.name} (exit ${f.code})`);
  process.exit(1);
}

const freshlyPublished = packages.length - alreadyPublishedCount;
if (alreadyPublishedCount > 0) {
  console.log(
    `\nPublished ${freshlyPublished} package(s); ${alreadyPublishedCount} already on the registry at this version (no-op).`,
  );
} else {
  console.log(`\nAll ${packages.length} packages published successfully.`);
}
