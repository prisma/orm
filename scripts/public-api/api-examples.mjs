#!/usr/bin/env node
// Usage: node scripts/public-api/api-examples.mjs [--ga] [--only <app>,…]
//
// Type-checks each app under examples/ as it was at the last release's git tag, type tests
// included, against the current build: a user who upgrades keeps their code and their committed
// contracts, so the contracts are compiled as committed, never re-emitted. Each app's files apart
// from node_modules are set aside under wip/, replaced with the tag's, checked with the tag's own
// `typecheck` script (which runs any step the app needs first), and put back, also on failure.
// The app's node_modules resolve @prisma/* to the current build, as a user's would.
//
// The apps' type tests assert exact types, so a change the compatibility policy allows can fail
// them. Such an error is recorded in examples/last-release-errors.json as
// [{ "app": "prisma-8-demo", "file": "test/rows.test-d.ts", "line": 12, "code": "TS2344",
//    "release": "8.0.0", "reason": "…" }]. The tag's files never change, so the location stays
// valid for as long as that release is the last one. A record for another release is skipped and
// listed as removable; a record that matches no error fails the run.
//
// An error that is not recorded fails the run when the last release has no pre-release part
// (`--ga` treats it as if it had none); otherwise it is reported. Needs network access to the
// registry and to the origin remote.

import { execFileSync, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
} from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { type } from 'arktype';
import { isPrerelease } from './compat.mjs';
import { compareCodeUnits } from './flatten.mjs';
import { LastReleaseError, lastRelease } from './last-release.mjs';

const here = dirname(fileURLToPath(import.meta.url));

export const RECORDS_FILE = join('examples', 'last-release-errors.json');
export const ASIDE_FOLDER = join('wip', 'api-examples-current');
const TYPECHECK_TIMEOUT_MS = 10 * 60 * 1000;

const Records = type({
  '+': 'reject',
  app: 'string > 0',
  file: 'string > 0',
  line: 'number.integer > 0',
  code: /^TS\d+$/,
  release: 'string > 0',
  reason: /^[^\r\n]+$/,
}).array();

export class RecordsError extends Error {}

export function readRecords(root) {
  const file = join(root, RECORDS_FILE);
  if (!existsSync(file)) return [];
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new RecordsError(`${RECORDS_FILE}: ${error.message}`);
  }
  const records = Records(parsed);
  if (records instanceof type.errors) {
    throw new RecordsError(
      `${RECORDS_FILE}: ${records.summary}. Each record is { "app", "file", "line", "code", "release", "reason" }, with the reason on one line.`,
    );
  }
  return records;
}

const git = (root, args, options = {}) =>
  execFileSync('git', args, { cwd: root, maxBuffer: 1024 * 1024 * 1024, ...options });

function hasTag(root, tag) {
  try {
    git(root, ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

// Only a shallow clone, such as CI's checkout, is fetched with depth 1: in a full clone a depth
// would cut its history short.
export function fetchTag(root, tag) {
  if (hasTag(root, tag)) return;
  const shallow = git(root, ['rev-parse', '--is-shallow-repository'], { encoding: 'utf8' }).trim();
  git(root, [
    'fetch',
    '--no-tags',
    ...(shallow === 'true' ? ['--depth=1'] : []),
    'origin',
    `refs/tags/${tag}:refs/tags/${tag}`,
  ]);
}

export function appsAtTag(root, tag) {
  const files = git(root, ['ls-tree', '-r', '--name-only', tag, '--', 'examples'], {
    encoding: 'utf8',
  }).split('\n');
  return new Set(
    files.flatMap((file) => file.match(/^examples\/([^/]+)\/package\.json$/)?.slice(1) ?? []),
  );
}

function currentApps(root) {
  const examples = join(root, 'examples');
  return new Set(
    readdirSync(examples, { withFileTypes: true })
      .filter(
        (entry) => entry.isDirectory() && existsSync(join(examples, entry.name, 'package.json')),
      )
      .map((entry) => entry.name),
  );
}

const isNodeModules = (name) => name === 'node_modules';

function holdsNodeModules(dir) {
  return readdirSync(dir, { withFileTypes: true }).some(
    (entry) =>
      entry.isDirectory() && (isNodeModules(entry.name) || holdsNodeModules(join(dir, entry.name))),
  );
}

// Moves everything in `from` into `to`, apart from node_modules folders at any depth; a folder
// that holds one stays and is moved entry by entry.
function moveAside(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (isNodeModules(entry.name)) continue;
    const source = join(from, entry.name);
    if (entry.isDirectory() && holdsNodeModules(source)) moveAside(source, join(to, entry.name));
    else renameSync(source, join(to, entry.name));
  }
}

function clearApp(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (isNodeModules(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory() && holdsNodeModules(path)) clearApp(path);
    else rmSync(path, { recursive: true, force: true });
  }
}

function moveBack(from, to) {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    if (entry.isDirectory() && existsSync(target) && lstatSync(target).isDirectory()) {
      moveBack(source, target);
    } else renameSync(source, target);
  }
  rmSync(from, { recursive: true, force: true });
}

// The app's own files are kept in one of three folders, so that a run that was killed can be put
// right by the next one: `<app>.moving` while they are moved aside, `<app>` while the tag's files
// are in the app, and `<app>.restoring` while they are moved back.
const asideFolders = (root, app) => {
  const base = join(root, ASIDE_FOLDER, app);
  return { moving: `${base}.moving`, aside: base, restoring: `${base}.restoring` };
};

function setAside(root, app) {
  const { moving, aside } = asideFolders(root, app);
  moveAside(join(root, 'examples', app), moving);
  renameSync(moving, aside);
}

function putBack(root, app) {
  const appDir = join(root, 'examples', app);
  const { moving, aside, restoring } = asideFolders(root, app);
  if (existsSync(aside)) {
    clearApp(appDir);
    renameSync(aside, restoring);
  }
  for (const folder of [moving, restoring]) {
    if (existsSync(folder)) moveBack(folder, appDir);
  }
  if (readdirSync(dirname(aside)).length === 0) rmdirSync(dirname(aside));
}

export function putBackLeftovers(root) {
  const folder = join(root, ASIDE_FOLDER);
  if (!existsSync(folder)) return [];
  const apps = [
    ...new Set(readdirSync(folder).map((name) => name.replace(/\.(moving|restoring)$/, ''))),
  ];
  for (const app of apps) putBack(root, app);
  rmSync(folder, { recursive: true, force: true });
  return apps;
}

function extractApp(root, tag, app) {
  const archive = git(root, ['archive', '--format=tar', tag, `examples/${app}`]);
  execFileSync('tar', ['-x', '-C', root], { input: archive });
}

const ERROR_LINE = /^(?:(.+)\((\d+),(\d+)\): )?error (TS\d+): (.*)$/;

export function parseErrors(output) {
  return output.split(/\r?\n/).flatMap((text) => {
    const match = text.match(ERROR_LINE);
    if (!match) return [];
    const [, file, line, column, code, message] = match;
    return [
      {
        file: file ?? '(no file)',
        line: line === undefined ? 0 : Number(line),
        column: column === undefined ? 0 : Number(column),
        code,
        message: message.trim(),
      },
    ];
  });
}

function runTypecheck(appDir, script, env) {
  const result = spawnSync('sh', ['-c', script], {
    cwd: appDir,
    env: { ...env, PATH: `${join(appDir, 'node_modules', '.bin')}${delimiter}${env.PATH ?? ''}` },
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 1024,
    timeout: TYPECHECK_TIMEOUT_MS,
  });
  return {
    status: result.status,
    timedOut: result.error?.code === 'ETIMEDOUT',
    error: result.error,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

function checkApp({ root, tag, app, env }) {
  const appDir = join(root, 'examples', app);
  const manifest = JSON.parse(
    git(root, ['show', `${tag}:examples/${app}/package.json`], {
      encoding: 'utf8',
    }),
  );
  const script = manifest.scripts?.typecheck;
  if (typeof script !== 'string') {
    return { app, skipped: 'it has no typecheck script at the release' };
  }
  if (!existsSync(join(appDir, 'node_modules'))) {
    return { app, errors: [], problems: ['it has no node_modules; run pnpm install'] };
  }
  const started = performance.now();
  setAside(root, app);
  let run;
  try {
    extractApp(root, tag, app);
    run = runTypecheck(appDir, script, env);
  } finally {
    putBack(root, app);
  }
  const errors = parseErrors(run.output);
  const problems = [];
  if (run.timedOut) {
    problems.push(`its typecheck did not finish in ${TYPECHECK_TIMEOUT_MS / 60000} minutes`);
  } else if (run.error) problems.push(`its typecheck did not start: ${run.error.message}`);
  else if (run.status !== 0 && errors.length === 0) {
    const tail = run.output.trim().split('\n').slice(-20).join('\n');
    problems.push(`\`${script}\` exited with ${run.status} without a type error:\n${tail}`);
  }
  return { app, script, errors, problems, ms: Math.round(performance.now() - started) };
}

const recordMatches = (record, app, error) =>
  record.app === app &&
  record.file === error.file &&
  record.line === error.line &&
  record.code === error.code;

// Marks each error a record of this release covers, and lists the records that cover nothing
// and the records of other releases.
export function applyRecords({ results, records, version, strict }) {
  const current = records.filter((record) => record.release === version);
  const removable = records.filter((record) => record.release !== version);
  const unmatched = new Set(current);
  for (const result of results) {
    if (!result.errors) continue;
    for (const error of result.errors) {
      const record = current.find((each) => recordMatches(each, result.app, error));
      if (record) {
        unmatched.delete(record);
        error.recorded = record.reason;
      }
      error.failsRun = strict && record === undefined;
    }
  }
  const problems = [...unmatched].map(
    (record) =>
      `the record for ${record.app} ${record.file}:${record.line} ${record.code} matches no error. Remove it.`,
  );
  return { removable, problems };
}

export const failsRun = (report) =>
  report.problems.length > 0 ||
  report.results.some(
    (result) =>
      (result.problems?.length ?? 0) > 0 || (result.errors ?? []).some((error) => error.failsRun),
  );

function byFile(errors) {
  const files = new Map();
  for (const error of errors) {
    if (!files.has(error.file)) files.set(error.file, []);
    files.get(error.file).push(error);
  }
  return [...files].sort(([a], [b]) => compareCodeUnits(a, b));
}

const describeError = ({ file, line, column, code, message }) =>
  `${file}(${line},${column}): ${code} ${message}`;

const describeRecord = ({ app, file, line, code, release, reason }) =>
  `${app} ${file}:${line} ${code} (release ${release}): ${reason}`;

const headline = ({ version, tag, strict }) =>
  `last release ${version} (tag ${tag}); ${strict ? 'an error fails unless it is recorded' : 'a pre-release, so errors are reported and do not fail'}`;

const appFails = (result) =>
  (result.problems?.length ?? 0) > 0 || (result.errors ?? []).some((error) => error.failsRun);

const appSummary = (result) => {
  const recorded = result.errors.filter((error) => error.recorded !== undefined).length;
  const files = byFile(result.errors).length;
  return `${result.errors.length} errors in ${files} files (${recorded} recorded)`;
};

export function reportText(report) {
  const lines = [`api:examples: ${headline(report)}`];
  for (const result of report.results) {
    if (result.skipped) continue;
    const time = result.ms === undefined ? '' : `; ${(result.ms / 1000).toFixed(1)} s`;
    const fails = appFails(result) ? ' — FAILS' : '';
    lines.push(`\n${result.app}: ${appSummary(result)}${time}${fails}`);
    for (const [file, errors] of byFile(result.errors)) {
      lines.push(`  ${file}: ${errors.length}`);
      for (const error of errors) {
        const label = error.recorded === undefined ? '' : ` (recorded: ${error.recorded})`;
        lines.push(`    ${describeError(error)}${label}`);
      }
    }
    for (const problem of result.problems) lines.push(`  problem  ${problem}`);
  }
  const skipped = report.results.filter((result) => result.skipped);
  if (skipped.length > 0) {
    lines.push('\nSkipped:', ...skipped.map(({ app, skipped: why }) => `  ${app}: ${why}`));
  }
  if (report.removable.length > 0) {
    lines.push(
      `\nRecords for another release than ${report.version}, skipped; remove them:`,
      ...report.removable.map((record) => `  ${describeRecord(record)}`),
    );
  }
  for (const problem of report.problems) lines.push(`\nproblem  ${problem}`);
  return `${lines.join('\n')}\n`;
}

const cell = (text) => String(text).replaceAll('|', '\\|').replaceAll('\n', ' ');
const SAMPLES_PER_FILE = 3;

export function reportMarkdown(report) {
  const checked = report.results.filter((result) => !result.skipped);
  const lines = [
    `## The example apps of ${report.version} against this build`,
    '',
    `${headline(report).replace(/^./, (first) => first.toUpperCase())}. Records are in \`${RECORDS_FILE}\`.`,
    '',
    '| App | Errors | Recorded | Files | Problems |',
    '| --- | --- | --- | --- | --- |',
    ...checked.map(
      (result) =>
        `| ${result.app} | ${result.errors.length} | ${result.errors.filter((error) => error.recorded !== undefined).length} | ${byFile(result.errors).length} | ${result.problems.length} |`,
    ),
    '',
  ];
  for (const result of checked) {
    const items = byFile(result.errors).flatMap(([file, errors]) => [
      `- \`${file}\`: ${errors.length}`,
      ...errors
        .slice(0, SAMPLES_PER_FILE)
        .map(
          (error) =>
            `  - ${error.line}:${error.column} ${error.code} ${cell(error.message)}${error.recorded === undefined ? '' : ` (recorded: ${cell(error.recorded)})`}`,
        ),
      ...(errors.length > SAMPLES_PER_FILE
        ? [`  - and ${errors.length - SAMPLES_PER_FILE} more in the job log`]
        : []),
    ]);
    items.push(...result.problems.map((problem) => `- problem: ${cell(problem)}`));
    if (items.length > 0) lines.push(`### ${result.app}`, '', ...items, '');
  }
  const skipped = report.results.filter((result) => result.skipped);
  if (skipped.length > 0) {
    const apps = skipped.map(({ app, skipped: why }) => `${app} (${why})`);
    lines.push(`Skipped: ${apps.join(', ')}`, '');
  }
  if (report.removable.length > 0) {
    lines.push(
      `Records for another release than ${report.version}, skipped; remove them:`,
      '',
      ...report.removable.map((record) => `- ${cell(describeRecord(record))}`),
      '',
    );
  }
  lines.push(...report.problems.map((problem) => `- problem: ${cell(problem)}`));
  return `${lines.join('\n')}\n`;
}

export async function checkExamples({
  root,
  ga = false,
  only,
  env = process.env,
  findRelease = () => lastRelease({ root }),
  stopped = () => false,
}) {
  const leftovers = putBackLeftovers(root);
  const { version, tag } = await findRelease();
  const strict = ga || !isPrerelease(version);
  const records = readRecords(root);
  fetchTag(root, tag);
  const atTag = appsAtTag(root, tag);
  const current = currentApps(root);
  const apps = [...new Set([...atTag, ...current])]
    .filter((app) => only === undefined || only.includes(app))
    .sort(compareCodeUnits);
  const results = [];
  for (const app of apps) {
    if (stopped()) break;
    if (!atTag.has(app)) results.push({ app, skipped: 'it was added after the release' });
    else if (!current.has(app)) results.push({ app, skipped: 'it was removed after the release' });
    else results.push(checkApp({ root, tag, app, env }));
  }
  const { removable, problems } = applyRecords({ results, records, version, strict });
  return { version, tag, strict, results, removable, problems, leftovers };
}

export async function main({
  root,
  args,
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  findRelease,
}) {
  const { values } = parseArgs({
    args,
    options: { ga: { type: 'boolean', default: false }, only: { type: 'string' } },
  });
  let interrupted = false;
  const stop = () => {
    interrupted = true;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  let report;
  try {
    report = await checkExamples({
      root,
      ga: values.ga,
      only: values.only?.split(','),
      env,
      findRelease,
      stopped: () => interrupted,
    });
  } catch (error) {
    if (!(error instanceof LastReleaseError || error instanceof RecordsError)) throw error;
    stderr.write(`api:examples: ${error.message}\n`);
    return 1;
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
  if (report.leftovers.length > 0) {
    stderr.write(
      `api:examples: put back the files a stopped run had set aside in ${report.leftovers.join(', ')}\n`,
    );
  }
  stdout.write(reportText(report));
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, reportMarkdown(report));
  if (interrupted) return 130;
  return failsRun(report) ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main({ root: resolve(here, '..', '..'), args: process.argv.slice(2) });
}
