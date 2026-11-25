#!/usr/bin/env node
// Usage: node scripts/public-api/api-compat.mjs [--jobs <n>] [--only <package>,…] [--ga]
//
// Finds the breaks in each published package since the last release. The last release is
// installed beside the current build (compat-install.mjs), and for each export a package declares
// itself on one of its import paths a generated test asks whether the current build's type is
// assignable to the release's, for the export's type and for its value (compat.mjs). Names a path
// forwards from another package are checked in that package.
//
// One direction is enough: a new required member on a type users implement fails through the
// exported function that accepts it, and a new member on a type users only receive passes.
// "Type instantiation is excessively deep" is reported as undecided.
//
// A deliberate break is recorded in api-breaks.json beside the package's api.txt, as
// [{ "path": ".", "export": "Db", "release": "8.0.0", "reason": "…" }]. The test gets
// `// @ts-expect-error <reason>`, so the record fails once the break is undone, and a record for
// another release than the last fails until it is removed.
//
// A break fails the run when the last release has no pre-release part (`--ga` treats it as if it
// had none) and the export's name does not start with preview_ or ea_. Otherwise it is reported.
// Needs `pnpm build` and network access to the registry.

import { fork } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { type } from 'arktype';
import { publishedPackageDirs } from './api.mjs';
import { isPrerelease, RECORDS_FILE } from './compat.mjs';
import { aliasOf, installRelease, thirdPartyVersions } from './compat-install.mjs';
import { compareCodeUnits } from './flatten.mjs';
import { isReleased, LastReleaseError, lastRelease } from './last-release.mjs';
import { entryPointsOf } from './read-api.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const INSTALL_FOLDER = '.api-compat';

const Records = type({
  '+': 'reject',
  path: 'string > 0',
  export: 'string > 0',
  release: 'string > 0',
  reason: /^[^\r\n]+$/,
}).array();

export class RecordsError extends Error {}

export function readRecords(packageDir, root) {
  const file = join(packageDir, RECORDS_FILE);
  if (!existsSync(file)) return [];
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new RecordsError(`${relative(root, file)}: ${error.message}`);
  }
  const records = Records(parsed);
  if (records instanceof type.errors) {
    throw new RecordsError(
      `${relative(root, file)}: ${records.summary}. Each record is { "path", "export", "release", "reason" }, with the reason on one line.`,
    );
  }
  return records;
}

function runWorker(job) {
  return new Promise((resolveResult) => {
    const child = fork(join(here, 'compat-worker.mjs'), [JSON.stringify(job)], {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    let reply;
    child.on('message', (message) => {
      reply = message;
    });
    child.on('exit', (code, signal) => {
      if (reply?.result) resolveResult(reply.result);
      else {
        const how = signal ? `on signal ${signal}` : `with exit code ${code}`;
        resolveResult({
          name: job.name,
          problems: [reply?.error ?? `the worker stopped ${how} before it reported`],
        });
      }
    });
  });
}

async function runAll(jobs, workers) {
  const queue = [...jobs];
  const results = [];
  const run = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) results.push(await runWorker(job));
  };
  await Promise.all(Array.from({ length: workers }, run));
  return results.sort((a, b) => compareCodeUnits(a.name, b.name));
}

export const failsRun = (result) =>
  (result.problems?.length ?? 0) > 0 || (result.breaks ?? []).some((each) => each.failsRun);

const describeFailure = ({ path, name, test, message }) => `${path} ${name} (${test}): ${message}`;

export function reportText({ version, results, notReleased }) {
  const lines = [
    `api:compat: last release ${version}; ${isPrerelease(version) ? 'a pre-release, so breaks are reported and do not fail' : 'breaks fail unless recorded'}`,
  ];
  for (const result of results) {
    const counts = result.counts;
    const head = counts
      ? `${result.name}: ${counts.tests} tests over ${counts.exports - counts.forwarded - counts.notCompared} exports on ${counts.paths} paths (${counts.forwarded} forwarded, checked in their own package); breaks ${result.breaks.length}, undecided ${result.undecided.length}, recorded ${result.recorded.length}; ${(result.ms / 1000).toFixed(1)} s, ${result.maxRssMb} MB`
      : `${result.name}: not checked`;
    lines.push(`\n${head}${failsRun(result) ? ' — FAILS' : ''}`);
    for (const each of result.breaks ?? []) {
      lines.push(`  break${each.failsRun ? '' : ' (reported only)'}  ${describeFailure(each)}`);
    }
    for (const each of result.undecided ?? []) lines.push(`  undecided  ${describeFailure(each)}`);
    for (const each of result.recorded ?? []) {
      lines.push(`  recorded  ${each.path} ${each.name}: ${each.reason}`);
    }
    for (const problem of result.problems ?? []) lines.push(`  problem  ${problem}`);
  }
  if (notReleased.length > 0) {
    lines.push(`\nNot checked, no release ${version}: ${notReleased.join(', ')}`);
  }
  return `${lines.join('\n')}\n`;
}

const cell = (text) => String(text).replaceAll('|', '\\|').replaceAll('\n', ' ');

export function reportMarkdown({ version, results, notReleased }) {
  const lines = [
    `## Breaks since the last release, ${version}`,
    '',
    isPrerelease(version)
      ? 'The last release is a pre-release, so breaks are reported and do not fail the job.'
      : 'A break fails the job unless it is recorded in the package’s `api-breaks.json`.',
    '',
    '| Package | Tests | Breaks | Undecided | Recorded | Problems |',
    '| --- | --- | --- | --- | --- | --- |',
    ...results.map(
      (result) =>
        `| ${result.name} | ${result.counts?.tests ?? '–'} | ${result.breaks?.length ?? '–'} | ${result.undecided?.length ?? '–'} | ${result.recorded?.length ?? '–'} | ${result.problems.length} |`,
    ),
    '',
  ];
  for (const result of results) {
    const items = [
      ...(result.breaks ?? []).map(
        (each) =>
          `- break${each.failsRun ? '' : ' (reported only)'}: \`${each.path}\` \`${each.name}\` (${each.test}): ${cell(each.message)}`,
      ),
      ...(result.undecided ?? []).map(
        (each) =>
          `- undecided: \`${each.path}\` \`${each.name}\` (${each.test}): ${cell(each.message)}`,
      ),
      ...(result.recorded ?? []).map(
        (each) => `- recorded: \`${each.path}\` \`${each.name}\`: ${cell(each.reason)}`,
      ),
      ...result.problems.map((problem) => `- problem: ${cell(problem)}`),
    ];
    if (items.length > 0) lines.push(`### ${result.name}`, '', ...items, '');
  }
  if (notReleased.length > 0) {
    lines.push(`Not checked, no release ${version}: ${notReleased.join(', ')}`, '');
  }
  return `${lines.join('\n')}\n`;
}

export async function main({
  root,
  args,
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
}) {
  const { values } = parseArgs({
    args,
    options: {
      jobs: { type: 'string', default: String(Math.min(3, availableParallelism())) },
      only: { type: 'string' },
      ga: { type: 'boolean', default: false },
    },
  });
  const workers = Number.parseInt(values.jobs, 10);
  const only = values.only
    ?.split(',')
    .map((name) => (name.startsWith('@') ? name : `@prisma/${name}`));

  const packages = publishedPackageDirs(root).packageDirs.map((dir) => ({
    dir,
    name: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name,
  }));
  const ownNames = new Set(packages.map(({ name }) => name));
  let release;
  try {
    release = await lastRelease({ root });
  } catch (error) {
    if (!(error instanceof LastReleaseError)) throw error;
    stderr.write(`api:compat: ${error.message}\n`);
    return 1;
  }
  const { version } = release;
  const selected = packages.filter(({ name }) => only === undefined || only.includes(name));
  const releasedFlags = await Promise.all(selected.map(({ name }) => isReleased(name, version)));
  const released = selected.filter((_, index) => releasedFlags[index]);
  const notReleased = selected.filter((_, index) => !releasedFlags[index]).map(({ name }) => name);

  const results = [];
  const jobs = [];
  const installDir = join(root, INSTALL_FOLDER);
  for (const { dir, name } of released) {
    try {
      jobs.push({
        name,
        releaseDir: join(installDir, 'node_modules', aliasOf('release', name)),
        currentDir: dir,
        releaseSpecifier: aliasOf('release', name),
        currentSpecifier: aliasOf('current', name),
        testFile: join(installDir, 'tests', `${aliasOf('current', name)}.ts`),
        records: readRecords(dir, root),
        version,
        strict: values.ga || !isPrerelease(version),
        size: entryPointsOf(dir).length,
      });
    } catch (error) {
      results.push({ name, problems: [error.message] });
    }
  }

  const { versions, conflicts } = thirdPartyVersions(
    packages.map(({ dir }) => dir),
    ownNames,
  );
  for (const [key, all] of Object.entries(conflicts)) {
    stderr.write(`api:compat: ${key} is installed at ${all.join(' and ')}, so it is not pinned\n`);
  }
  installRelease({ dir: installDir, packages: released, version, overrides: versions, ownNames });

  jobs.sort((a, b) => b.size - a.size || compareCodeUnits(a.name, b.name));
  results.push(...(await runAll(jobs, workers)));
  results.sort((a, b) => compareCodeUnits(a.name, b.name));

  const report = { version, results, notReleased };
  stdout.write(reportText(report));
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, reportMarkdown(report));
  return results.some(failsRun) ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main({ root: resolve(here, '..', '..'), args: process.argv.slice(2) });
}
