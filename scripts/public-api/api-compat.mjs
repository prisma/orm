#!/usr/bin/env node
// Usage: node scripts/public-api/api-compat.mjs [--jobs <n>] [--only <package>,…] [--ga]
//
// Finds the breaks in each published package since the last release. The last release is
// installed beside the current build, with a second copy of it, its twin (compat-install.mjs), and
// for each export a package declares itself on one of its import paths a generated test asks
// whether the current build's type is assignable to the release's, for the export's type, for its
// value and for a class's constructor parameters (compat.mjs). Names a path forwards from another
// package are checked in that package.
//
// One direction is enough: a new required member on a type users implement fails through the
// exported function that accepts it, and a new member on a type users only receive passes.
//
// A class also gets a test that each abstract member a subclass implements still accepts what the
// release's did.
//
// The comparison is TypeScript's own, on declarations rewritten so that it compares what a user
// relies on (compat-declarations.mjs): methods become function-typed properties, so that their
// parameters compare contravariantly; protected members move to a string key; private members
// become a marker naming their class; and unique symbols, which differ between two copies of a
// declaration, are named by package and name. Each third-party version is read from one copy.
//
// TypeScript cannot relate some generic types between two copies of their declaration, so a
// failure is a break when the same test passes between the release and its twin, and also when
// there was no time left to try. When it fails there too, the export is compared member by member
// with the same rule. What still cannot be compared goes to the structural mapping of
// compat-structural.ts, whose failure is a break and whose pass is not a verdict, since it
// instantiates generic signatures with their constraints. What is not decided is reported as
// undecided, with the stage it ended at: native (too deep, or a stack overflow), member, or
// structural.
//
// A deliberate break is recorded in api-breaks.json beside the package's api.txt, as
// [{ "path": ".", "export": "Db", "test": "type", "release": "8.0.0", "reason": "…" }], where the
// test is type, value, constructor, abstract, exists, or path for a removed import path (export
// "*"). A record covers the breaks of that one test of the export, which are listed as recorded
// instead. It fails the run once that test is decided and no longer breaks. A record for a later
// release than the last fails the run; one for an earlier release is skipped and listed as
// removable.
//
// A break fails the run when the last release has no pre-release part (`--ga` treats it as if it
// had none) and the export's name does not start with preview_ or ea_. Otherwise it is reported.
// Needs `pnpm build` and network access to the registry.

import { fork } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { type } from 'arktype';
import { publishedPackageDirs } from './api.mjs';
import { isPrerelease, RECORDS_FILE } from './compat.mjs';
import {
  aliasOf,
  installRelease,
  peerDependencies,
  thirdPartyVersions,
} from './compat-install.mjs';
import { compareCodeUnits } from './flatten.mjs';
import {
  fetchReleaseTag,
  isReleased,
  LastReleaseError,
  lastRelease,
  packagesAtTag,
} from './last-release.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const INSTALL_FOLDER = '.api-compat';

const Records = type({
  '+': 'reject',
  path: 'string > 0',
  export: 'string > 0',
  test: "'type' | 'value' | 'constructor' | 'abstract' | 'exists' | 'path'",
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
      `${relative(root, file)}: ${records.summary}. Each record is { "path", "export", "test", "release", "reason" }, where the test is type, value, constructor, abstract, exists or path, and the reason is on one line.`,
    );
  }
  return records;
}

function declarationBytes(dir) {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir, { withFileTypes: true }).reduce((total, entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return total + declarationBytes(path);
    return /\.d\.[cm]?ts$/.test(entry.name) ? total + statSync(path).size : total;
  }, 0);
}

// The size of the declarations a package's comparison reads, its own and those of our packages it
// depends on, directly or not, which is what its time and memory grow with. The costliest start
// first, so that none of them starts last.
export function comparisonCost(name, dirsByName, seen = new Set()) {
  const dir = dirsByName.get(name);
  if (dir === undefined || seen.has(name)) return 0;
  seen.add(name);
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  return Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies }).reduce(
    (total, dependency) => total + comparisonCost(dependency, dirsByName, seen),
    declarationBytes(join(dir, 'dist')),
  );
}

export class PackageSelectionError extends Error {}

export function selectPackages(packages, only) {
  if (only === undefined) return packages;
  const names = only.split(',').map((name) => (name.startsWith('@') ? name : `@prisma/${name}`));
  const unknown = names.filter((name) => !packages.some((each) => each.name === name));
  if (unknown.length > 0) {
    throw new PackageSelectionError(`--only names no published package: ${unknown.join(', ')}`);
  }
  return packages.filter(({ name }) => names.includes(name));
}

// Which packages to check: those the release's tag has. A package only in the repository has not
// been released. One the tag has that the repository or the registry lacks cannot be checked, and
// that fails the run, so that a deleted package or a registry that lags is never skipped quietly.
export function planPackages({ version, atTag, inRepository, onRegistry }) {
  const tagged = new Set(atTag);
  const problems = [];
  for (const name of atTag) {
    if (!inRepository.some((each) => each.name === name)) {
      problems.push({
        name,
        problems: [`the release v${version} has this package, but the repository no longer does`],
      });
    }
  }
  const check = [];
  const notReleased = [];
  for (const each of inRepository) {
    if (!tagged.has(each.name)) notReleased.push(each.name);
    else if (onRegistry.has(each.name)) check.push(each);
    else {
      problems.push({
        name: each.name,
        problems: [
          `the release v${version} has this package, but the registry has no version ${version} of it; if it was published moments ago, the registry may not show it yet`,
        ],
      });
    }
  }
  return {
    check,
    notReleased,
    problems: problems.sort((a, b) => compareCodeUnits(a.name, b.name)),
  };
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
      ? `${result.name}: ${counts.exports} exports on ${counts.paths} paths; ${counts.tests} comparisons, and ${counts.forwarded} forwarded names checked only for existence (they are compared in the package that declares them); breaks ${result.breaks.length}, undecided ${result.undecided.length}, not compared ${result.notCompared.length}, recorded ${result.recorded.length}; ${(result.ms / 1000).toFixed(1)} s, ${result.maxRssMb} MB`
      : `${result.name}: not checked`;
    lines.push(`\n${head}${failsRun(result) ? ' — FAILS' : ''}`);
    for (const each of result.breaks ?? []) {
      lines.push(`  break${each.failsRun ? '' : ' (reported only)'}  ${describeFailure(each)}`);
    }
    for (const each of result.undecided ?? []) {
      lines.push(`  undecided (${each.stage})  ${describeFailure(each)}`);
    }
    for (const each of result.fallbacks ?? []) {
      lines.push(`  decided member by member  ${each.path} ${each.name} (${each.test})`);
    }
    for (const each of result.notCompared ?? []) {
      lines.push(`  not compared  ${describeFailure({ ...each, message: each.reason })}`);
    }
    for (const each of result.recorded ?? []) {
      lines.push(`  recorded  ${each.path} ${each.name} (${each.test}): ${each.reason}`);
    }
    for (const each of result.removable ?? []) {
      lines.push(`  removable record  ${removableText(each)}`);
    }
    for (const problem of result.problems ?? []) lines.push(`  problem  ${problem}`);
  }
  if (notReleased.length > 0) {
    lines.push(`\nNot checked, no release ${version}: ${notReleased.join(', ')}`);
  }
  return `${lines.join('\n')}\n`;
}

const removableText = (each) =>
  `${each.path} ${each.export} (${each.test}): for release ${each.release}, earlier than the last`;

const cell = (text) => String(text).replaceAll('|', '\\|').replaceAll('\n', ' ');

export function reportMarkdown({ version, results, notReleased }) {
  const lines = [
    `## Breaks since the last release, ${version}`,
    '',
    isPrerelease(version)
      ? 'The last release is a pre-release, so breaks are reported and do not fail the job.'
      : 'A break fails the job unless it is recorded in the package’s `api-breaks.json`.',
    '',
    '| Package | Comparisons | Forwarded names | Breaks | Undecided | Not compared | Recorded | Problems |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...results.map(
      (result) =>
        `| ${result.name} | ${result.counts?.tests ?? '–'} | ${result.counts?.forwarded ?? '–'} | ${result.breaks?.length ?? '–'} | ${result.undecided?.length ?? '–'} | ${result.notCompared?.length ?? '–'} | ${result.recorded?.length ?? '–'} | ${result.problems.length} |`,
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
          `- undecided (${each.stage}): \`${each.path}\` \`${each.name}\` (${each.test}): ${cell(each.message)}`,
      ),
      ...(result.fallbacks ?? []).map(
        (each) => `- decided member by member: \`${each.path}\` \`${each.name}\` (${each.test})`,
      ),
      ...(result.notCompared ?? []).map(
        (each) =>
          `- not compared: \`${each.path}\` \`${each.name}\` (${each.test}): ${cell(each.reason)}`,
      ),
      ...(result.recorded ?? []).map(
        (each) =>
          `- recorded: \`${each.path}\` \`${each.name}\` (${each.test}): ${cell(each.reason)}`,
      ),
      ...(result.removable ?? []).map(
        (each) =>
          `- removable record: \`${each.path}\` \`${each.export}\` (${each.test}): for release ${each.release}, earlier than the last`,
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
  const fail = (message) => {
    stderr.write(`api:compat: ${message}\n`);
    return 1;
  };

  const inRepository = publishedPackageDirs(root).packageDirs.map((dir) => ({
    dir,
    name: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name,
  }));
  const ownNames = new Set(inRepository.map(({ name }) => name));
  const dirsByName = new Map(inRepository.map(({ name, dir }) => [name, dir]));
  let selected;
  let version;
  let plan;
  try {
    selected = selectPackages(inRepository, values.only);
    const release = await lastRelease({ root });
    version = release.version;
    fetchReleaseTag(release.tag, root);
    const selectedNames = new Set(selected.map(({ name }) => name));
    const atTag = packagesAtTag(release.tag, root).filter(
      (name) => values.only === undefined || selectedNames.has(name),
    );
    for (const name of atTag) ownNames.add(name);
    const tagged = selected.filter(({ name }) => atTag.includes(name));
    const flags = await Promise.all(tagged.map(({ name }) => isReleased(name, version)));
    const onRegistry = new Set(tagged.filter((_, index) => flags[index]).map(({ name }) => name));
    plan = planPackages({ version, atTag, inRepository: selected, onRegistry });
  } catch (error) {
    if (error instanceof LastReleaseError || error instanceof PackageSelectionError) {
      return fail(error.message);
    }
    throw error;
  }
  const released = plan.check;
  const notReleased = plan.notReleased;

  const results = [...plan.problems];
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
        twinSpecifier: aliasOf('twin', name),
        testFile: join(installDir, 'tests', `${aliasOf('current', name)}.ts`),
        records: readRecords(dir, root),
        version,
        strict: values.ga || !isPrerelease(version),
        ownNames: [...ownNames],
        cost: comparisonCost(name, dirsByName),
      });
    } catch (error) {
      results.push({ name, problems: [error.message] });
    }
  }

  const { versions, conflicts } = thirdPartyVersions(
    inRepository.map(({ dir }) => dir),
    ownNames,
  );
  for (const [key, all] of Object.entries(conflicts)) {
    stderr.write(`api:compat: ${key} is installed at ${all.join(' and ')}, so it is not pinned\n`);
  }
  try {
    installRelease({
      dir: installDir,
      packages: released,
      version,
      overrides: versions,
      peers: peerDependencies(
        inRepository.map(({ dir }) => dir),
        ownNames,
        versions,
      ),
      ownNames,
    });
  } catch (error) {
    return fail(`installing the last release failed: ${error.message}`);
  }

  jobs.sort((a, b) => b.cost - a.cost || compareCodeUnits(a.name, b.name));
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
