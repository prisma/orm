#!/usr/bin/env node
// Usage: node scripts/public-api/api-compat.mjs [--jobs <n>] [--only <package>,…] [--ga]
//
// Finds the breaks in each published package since the last release (release.mjs says which that
// is). The last release is installed beside the current build, with a second copy of it, its twin
// (compat-install.mjs), and for each export a package declares itself on one of its import paths
// a generated test asks whether the current build's type is assignable to the release's, for the
// export's type, for its value and for a class's constructor parameters (compat.mjs). A value is
// also used through a value import, which fails when the current build exports it type-only. Names
// a path forwards from another package are checked there, and here only for existence. The members
// a package adds with `declare module` to an interface of another of our packages are compared
// too.
//
// One direction is enough: a new required member on a type users implement fails through the
// exported function that accepts it, and a new member on a type users only receive passes.
//
// An abstract class also gets a subclass, written against the release, that must still compile
// against the current class, and a test that each abstract member still accepts what the
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
// there was no time left to try. When it fails there too, it goes to the structural mapping of
// compat-structural.ts, whose failure is a break and whose pass is not a verdict, since it
// instantiates generic signatures with their constraints. What that does not decide is compared
// member by member, each member with the twin rule and then the structural mapping. What is not
// decided is reported as undecided, with the stage it ended at: native (too deep, or a stack
// overflow), member (no time, or call or index signatures left out), structural, or shared marker.
//
// Two classes with private members, or two unique symbols, with one name in one package get one
// marker, so one can stand in for the other. The package lists each such name as not compared, and
// every export that reaches one, in the release or the current build, has its passing comparisons
// reported as undecided at the stage shared marker.
//
// An accepted break is recorded in api-breaks.json beside the package's api.txt, and a released
// package the repository no longer has in packages/9-public/removed-packages.json; records.mjs
// describes both. The report prints each unrecorded break's record, ready to paste.
//
// A break fails the run when the last release has no pre-release part (`--ga` treats it as if it
// had none) and the export is generally available: its name does not start with preview_ or ea_,
// or the release also exports the same thing under a name without one. Otherwise it is reported.
// Needs `pnpm build` and network access to origin and to the registry.

import { fork } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { publishedPackageDirs } from './api.mjs';
import { compareCodeUnits } from './api-lines.mjs';
import {
  aliasOf,
  installRelease,
  peerDependencies,
  supplyChainSettings,
  thirdPartyVersions,
} from './compat-install.mjs';
import {
  BREAKS_FILE,
  byLastRelease,
  exportLabel,
  REMOVED_FILE,
  RecordsError,
  readRecords as readRecordFile,
} from './records.mjs';
import {
  fetchReleaseTag,
  isPrerelease,
  isReleased,
  LastReleaseError,
  lastRelease,
  packagesAtTag,
} from './release.mjs';
import { withinBytes } from './summary.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const INSTALL_FOLDER = '.api-compat';
export const readRecords = (packageDir, root) =>
  readRecordFile(
    join(packageDir, BREAKS_FILE),
    'breaks',
    relative(root, join(packageDir, BREAKS_FILE)),
  );

export const readRemovedRecords = (root) =>
  readRecordFile(join(root, REMOVED_FILE), 'removed', REMOVED_FILE);

// A released package the repository no longer has is a break, which a record in
// removed-packages.json covers.
export function removedPackageResults({ removed, version, strict, records }) {
  const results = [];
  const sorted = byLastRelease(records, version, (record) => record.package);
  const problems = [...sorted.problems];
  const removable = sorted.removable;
  const covering = new Map();
  for (const record of sorted.current) {
    if (!removed.includes(record.package)) {
      problems.push(
        `${record.package}: the record is for a package the repository still has, or that was not released. Remove it.`,
      );
    } else covering.set(record.package, record);
  }
  for (const name of removed) {
    const record = covering.get(name);
    const failure = {
      path: '*',
      name: '*',
      test: 'package',
      message: `the release v${version} has this package, but the repository no longer does`,
    };
    results.push({
      name,
      removed: true,
      breaks: record
        ? []
        : [
            {
              ...failure,
              failsRun: strict,
              record: { package: name, lastRelease: version, reason: '…' },
            },
          ],
      recorded: record ? [{ ...failure, kind: 'break', reason: record.reason }] : [],
      undecided: [],
      notCompared: [],
      removable: [],
      problems: [],
    });
  }
  return { results, problems, removable };
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
// been released. One the tag has that the repository no longer has is removed, which is a break;
// one the registry lacks cannot be checked, which fails the run, so that a registry that lags is
// never skipped quietly.
export function planPackages({ version, atTag, inRepository, onRegistry }) {
  const tagged = new Set(atTag);
  const problems = [];
  const removed = atTag.filter((name) => !inRepository.some((each) => each.name === name));
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
    removed,
    problems: problems.sort((a, b) => compareCodeUnits(a.name, b.name)),
  };
}

function runWorker(job) {
  return new Promise((resolveResult) => {
    const child = fork(join(here, 'compat-worker.mjs'), [JSON.stringify(job)], {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    let reply;
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      resolveResult(result);
    };
    child.on('message', (message) => {
      reply = message;
    });
    child.on('error', (error) => {
      settle({ name: job.name, problems: [`the worker could not run: ${error.message}`] });
    });
    child.on('exit', (code, signal) => {
      if (reply?.result) settle(reply.result);
      else {
        const how = signal ? `on signal ${signal}` : `with exit code ${code}`;
        settle({
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

const labelOf = (packageName, { path, name }) => {
  if (path !== '*') return exportLabel(packageName, path, name);
  return name === '*' ? packageName : `${packageName}: ${name}`;
};
const describeFailure = (packageName, each, message = each.message) =>
  `${labelOf(packageName, each)} (${each.test}): ${message}`;
const RECORDED = [
  { kind: 'break', text: 'recorded break' },
  { kind: 'allowed', text: 'recorded allowed change' },
];
const recordedOfKind = (result, kind) =>
  (result.recorded ?? []).filter((each) => each.kind === kind);

const FROM_DISK =
  'the fingerprint is taken from the package’s api.txt as it is on disk: run pnpm build and pnpm api:update first, or it will not match';

// Whether breaks fail: from the release's version, or from --ga.
const headline = (version, strict = !isPrerelease(version)) =>
  !strict
    ? `last release ${version}; a pre-release, so breaks are reported and do not fail`
    : isPrerelease(version)
      ? `last release ${version}, treated as GA (--ga); breaks fail unless recorded`
      : `last release ${version}; breaks fail unless recorded`;

export function reportText({ version, strict, results, notReleased }) {
  const lines = [`api:compat: ${headline(version, strict)}`];
  for (const result of results) {
    const counts = result.counts;
    const head = counts
      ? `${result.name}: ${counts.exports} exports on ${counts.paths} paths; ${counts.tests} comparisons, and ${counts.forwarded} forwarded names checked only for existence (they are compared in the package that declares them); breaks ${result.breaks.length}, undecided ${result.undecided.length}, not compared ${result.notCompared.length}, recorded ${result.recorded.length}; ${(result.ms / 1000).toFixed(1)} s, ${result.maxRssMb} MB`
      : result.removed
        ? `${result.name}: removed from the repository`
        : result.recordsFile
          ? `${result.name}: records of removed packages`
          : `${result.name}: not checked`;
    lines.push(`\n${head}${failsRun(result) ? ' — FAILS' : ''}`);
    const printed = new Set();
    for (const each of result.breaks ?? []) {
      lines.push(
        `  break${each.failsRun ? '' : ' (reported only)'}  ${describeFailure(result.name, each)}`,
      );
      if (each.note) lines.push(`    note: ${each.note}`);
      const record = each.record && JSON.stringify(each.record);
      if (record && !printed.has(record)) {
        printed.add(record);
        if (result.removed) lines.push(`    to record it in ${REMOVED_FILE}: ${record}`);
        else {
          lines.push(`    to record it: ${record}`);
          if (printed.size === 1) lines.push(`    ${FROM_DISK}`);
        }
      }
    }
    for (const each of result.undecided ?? []) {
      lines.push(`  undecided (${each.stage})  ${describeFailure(result.name, each)}`);
    }
    for (const each of result.decidedByMembers ?? []) {
      lines.push(`  decided member by member  ${labelOf(result.name, each)} (${each.test})`);
    }
    for (const each of result.notCompared ?? []) {
      lines.push(`  not compared  ${describeFailure(result.name, each, each.reason)}`);
    }
    for (const { kind, text } of RECORDED) {
      for (const each of recordedOfKind(result, kind)) {
        lines.push(`  ${text}  ${describeFailure(result.name, each, each.reason)}`);
      }
    }
    for (const each of result.removable ?? []) {
      lines.push(`  removable record  ${removableText(result.name, each)}`);
    }
    for (const problem of result.problems ?? []) lines.push(`  problem  ${problem}`);
  }
  if (notReleased.length > 0) {
    lines.push(`\nNot checked, no release ${version}: ${notReleased.join(', ')}`);
  }
  return `${lines.join('\n')}\n`;
}

const removableText = (packageName, each) =>
  `${labelOf(packageName, { path: each.path ?? '*', name: each.export })} (${each.test ?? 'package'}): for the last release ${each.lastRelease}, earlier than this one`;

// Markdown table cells and list items; `<` and `&` are escaped, so that text such as `<string>`
// reaches the reader as written.
const cell = (text) =>
  String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('|', '\\|')
    .replaceAll('\n', ' ');

export function reportMarkdown(
  { version, strict = !isPrerelease(version), results, notReleased },
  { maxBytes } = {},
) {
  const lines = [
    `## Breaks since the last release, ${version}`,
    '',
    strict
      ? 'A break fails the job unless it is recorded in the package’s `api-breaks.json`.'
      : 'The last release is a pre-release, so breaks are reported and do not fail the job.',
    '',
    '| Package | Comparisons | Forwarded names | Breaks | Undecided | Not compared | Recorded breaks | Recorded allowed | Problems |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...results.map(
      (result) =>
        `| ${result.name} | ${result.counts?.tests ?? '–'} | ${result.counts?.forwarded ?? '–'} | ${result.breaks?.length ?? '–'} | ${result.undecided?.length ?? '–'} | ${result.notCompared?.length ?? '–'} | ${recordedOfKind(result, 'break').length} | ${recordedOfKind(result, 'allowed').length} | ${result.problems.length} |`,
    ),
    '',
  ];
  for (const result of results) {
    const items = [
      ...(result.breaks ?? []).map(
        (each) =>
          `- break${each.failsRun ? '' : ' (reported only)'}: ${cell(describeFailure(result.name, each))}${each.note ? ` (${cell(each.note)})` : ''}`,
      ),
      ...(result.undecided ?? []).map(
        (each) => `- undecided (${each.stage}): ${cell(describeFailure(result.name, each))}`,
      ),
      ...(result.decidedByMembers ?? []).map(
        (each) =>
          `- decided member by member: ${cell(`${labelOf(result.name, each)} (${each.test})`)}`,
      ),
      ...(result.notCompared ?? []).map(
        (each) => `- not compared: ${cell(describeFailure(result.name, each, each.reason))}`,
      ),
      ...RECORDED.flatMap(({ kind, text }) =>
        recordedOfKind(result, kind).map(
          (each) => `- ${text}: ${cell(describeFailure(result.name, each, each.reason))}`,
        ),
      ),
      ...(result.removable ?? []).map(
        (each) => `- removable record: ${cell(removableText(result.name, each))}`,
      ),
      ...result.problems.map((problem) => `- problem: ${cell(problem)}`),
    ];
    const toRecord = [
      ...new Set(
        (result.breaks ?? [])
          .filter((each) => each.record)
          .map((each) => JSON.stringify(each.record)),
      ),
    ];
    if (toRecord.length > 0) {
      items.push(
        '',
        result.removed
          ? `To record the removal, add to \`${REMOVED_FILE}\`, with the reason:`
          : `To record these breaks, add to \`${result.name.replace('@prisma/', 'packages/9-public/@prisma/')}/api-breaks.json\`, with the kind and the reason. The fingerprint is taken from the package’s \`api.txt\` as it is on disk: run \`pnpm build\` and \`pnpm api:update\` first, or it will not match.`,
        '',
        '```json',
        ...toRecord,
        '```',
      );
    }
    if (items.length > 0) lines.push(`### ${result.name}`, '', ...items, '');
  }
  if (notReleased.length > 0) {
    lines.push(`Not checked, no release ${version}: ${notReleased.join(', ')}`, '');
  }
  return withinBytes(lines, maxBytes);
}

// The steps that reach the network, git or the registry, which a test replaces.
const steps = {
  findRelease: (root) => lastRelease({ root }),
  fetchTag: fetchReleaseTag,
  packagesAt: packagesAtTag,
  released: isReleased,
  install: installRelease,
  check: runAll,
  removedRecords: (root) => readRemovedRecords(root),
};

export async function main({
  root,
  args,
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  ...replaced
}) {
  const {
    findRelease,
    fetchTag,
    packagesAt,
    released: isPublished,
    install,
    check,
    removedRecords: readRemoved,
  } = {
    ...steps,
    ...replaced,
  };
  const { values } = parseArgs({
    args,
    options: {
      jobs: { type: 'string', default: String(Math.min(3, availableParallelism())) },
      only: { type: 'string' },
      ga: { type: 'boolean', default: false },
    },
  });
  const fail = (message) => {
    stderr.write(`api:compat: ${message}\n`);
    return 1;
  };
  if (!/^[1-9]\d*$/.test(values.jobs)) {
    return fail(`--jobs must be a positive whole number, not ${values.jobs}`);
  }
  const workers = Number(values.jobs);
  if (!Number.isSafeInteger(workers)) {
    return fail(`--jobs must be a positive whole number, not ${values.jobs}`);
  }

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
    const release = await findRelease(root);
    version = release.version;
    fetchTag(release.tag, root);
    const selectedNames = new Set(selected.map(({ name }) => name));
    const atTag = packagesAt(release.tag, root).filter(
      (name) => values.only === undefined || selectedNames.has(name),
    );
    for (const name of atTag) ownNames.add(name);
    const tagged = selected.filter(({ name }) => atTag.includes(name));
    const flags = await Promise.all(tagged.map(({ name }) => isPublished(name, version)));
    const onRegistry = new Set(tagged.filter((_, index) => flags[index]).map(({ name }) => name));
    plan = planPackages({ version, atTag, inRepository: selected, onRegistry });
  } catch (error) {
    if (
      error instanceof LastReleaseError ||
      error instanceof PackageSelectionError ||
      error instanceof RecordsError
    ) {
      return fail(error.message);
    }
    throw error;
  }
  const released = plan.check;
  const notReleased = plan.notReleased;
  const strict = values.ga || !isPrerelease(version);

  const results = [...plan.problems];
  // Under --only, the packages removed are not known, so their records are neither read nor
  // judged.
  let removedRecords = [];
  if (values.only === undefined) {
    try {
      removedRecords = readRemoved(root);
    } catch (error) {
      if (!(error instanceof RecordsError)) throw error;
      return fail(error.message);
    }
  }
  const removed = removedPackageResults({
    removed: plan.removed,
    version,
    strict,
    records: removedRecords,
  });
  results.push(...removed.results);
  if (removed.problems.length > 0 || removed.removable.length > 0) {
    results.push({
      name: REMOVED_FILE,
      recordsFile: true,
      problems: removed.problems,
      removable: removed.removable.map((record) => ({
        path: '*',
        export: record.package,
        test: 'package',
        lastRelease: record.lastRelease,
      })),
    });
  }
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
        strict,
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
    install({
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
      settings: supplyChainSettings(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')),
    });
  } catch (error) {
    return fail(`installing the last release failed: ${error.message}`);
  }

  jobs.sort((a, b) => b.cost - a.cost || compareCodeUnits(a.name, b.name));
  results.push(...(await check(jobs, Math.min(workers, Math.max(jobs.length, 1)))));
  results.sort((a, b) => compareCodeUnits(a.name, b.name));

  const report = { version, strict, results, notReleased };
  stdout.write(reportText(report));
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, reportMarkdown(report));
  return results.some(failsRun) ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main({ root: resolve(here, '..', '..'), args: process.argv.slice(2) });
}
