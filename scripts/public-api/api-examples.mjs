#!/usr/bin/env node
// Usage: node scripts/public-api/api-examples.mjs [--ga] [--only <app>,…], run as
// `pnpm api:compat:examples`.
//
// Type-checks each app under examples/ as it was at the last release's git tag, type tests
// included, against the current build: a user who upgrades keeps their code and their committed
// contracts, so the contracts are compiled as committed, never re-emitted. Each app is extracted
// from the tag into a folder of this run, .api-examples/<run>/examples/<app>, at the same depth as
// in the repository and beside the tag's root tsconfig files. Its node_modules is a link to the
// real app's, so @prisma/* resolves to the current build, as a user's would. The developer's app
// folders are never written. The tag's own `typecheck` script runs there, with any step it has
// before tsc; it must end in a tsc run, which is given `--pretty false`.
//
// The apps' type tests assert exact types, so a change the compatibility policy allows can fail
// them. Such an error is recorded in examples/last-release-errors.json as
// [{ "app": "prisma-8-demo", "file": "test/rows.test-d.ts", "line": 12, "code": "TS2344",
//    "message": "Type '…' does not satisfy the constraint '…'.", "release": "8.0.0",
//    "reason": "…" }]. The tag's files never change, so the record stays valid for as long as that
// release is the last one, until the current build changes the type again. Each record must match
// exactly one error (line 0 for an error with no location). A record for an earlier release is
// skipped and listed as removable; one for a later release, or one that matches no error, fails.
//
// An error that is not recorded fails the run when the last release has no pre-release part
// (`--ga` treats it as if it had none); otherwise it is reported. Needs network access to the
// registry and to the origin remote.

import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { type } from 'arktype';
import { compareCodeUnits } from './flatten.mjs';
import {
  compareVersions,
  fetchReleaseTag,
  isPrerelease,
  LastReleaseError,
  lastRelease,
} from './release.mjs';

const here = dirname(fileURLToPath(import.meta.url));

export const RECORDS_FILE = join('examples', 'last-release-errors.json');
export const RUN_FOLDER = '.api-examples';
const TYPECHECK_TIMEOUT_MS = 10 * 60 * 1000;

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

const Records = type({
  '+': 'reject',
  app: 'string > 0',
  file: 'string > 0',
  line: 'number.integer >= 0',
  code: /^TS\d+$/,
  message: 'string > 0',
  release: VERSION,
  reason: /^[^\r\n]+$/,
}).array();

export class ExamplesError extends Error {}

export function readRecords(root) {
  const file = join(root, RECORDS_FILE);
  if (!existsSync(file)) return [];
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new ExamplesError(`${RECORDS_FILE}: ${error.message}`);
  }
  const records = Records(parsed);
  if (records instanceof type.errors) {
    throw new ExamplesError(
      `${RECORDS_FILE}: ${records.summary}. Each record is { "app", "file", "line", "code", "message", "release", "reason" }, with the release a version and the reason on one line.`,
    );
  }
  return records;
}

const git = (root, args, options = {}) =>
  execFileSync('git', args, {
    cwd: root,
    maxBuffer: 1024 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });

const tagRef = (tag) => `refs/tags/${tag}`;

export function appsAtTag(root, tag) {
  const files = git(root, ['ls-tree', '-r', '--name-only', tagRef(tag), '--', 'examples'], {
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

function extract(root, tag, paths, into) {
  const archive = git(root, ['archive', '--format=tar', tagRef(tag), '--', ...paths]);
  execFileSync('tar', ['-x', '-C', into], { input: archive });
}

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

// Each run has a folder of its own, named after its process, so runs at once never share files.
// A folder whose process has gone is left from a run that was killed, and is removed.
function startRunFolder(root) {
  const runs = join(root, RUN_FOLDER);
  if (existsSync(runs)) {
    for (const name of readdirSync(runs)) {
      const pid = Number(name.split('-')[0]);
      if (!Number.isInteger(pid) || !isAlive(pid)) {
        rmSync(join(runs, name), { recursive: true, force: true });
      }
    }
  }
  const dir = join(runs, `${process.pid}-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function endRunFolder(dir) {
  rmSync(dir, { recursive: true, force: true });
  try {
    rmdirSync(dirname(dir));
  } catch {}
}

function prepareRunFolder(root, tag, runDir) {
  const rootFiles = git(root, ['ls-tree', '--name-only', tagRef(tag)], { encoding: 'utf8' })
    .split('\n')
    .filter((name) => /^tsconfig.*\.json$/.test(name));
  if (rootFiles.length > 0) extract(root, tag, rootFiles, runDir);
  if (existsSync(join(root, 'node_modules'))) {
    symlinkSync(join(root, 'node_modules'), join(runDir, 'node_modules'));
  }
}

// The real app's node_modules folders, at any depth, relative to the app.
function nodeModulesIn(dir, prefix = '') {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory()) return [];
    const path = join(prefix, entry.name);
    return entry.name === 'node_modules' ? [path] : nodeModulesIn(join(dir, entry.name), path);
  });
}

const TSC_LAST = /(?:^|&&)\s*tsc(?:\s[^&|;]*)?$/;

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const PLAIN_ERROR = /^(?:(.+)\((\d+),(\d+)\): )?error (TS\d+): (.*)$/;
const PRETTY_ERROR = /^(.+):(\d+):(\d+) - error (TS\d+): (.*)$/;

export function parseErrors(output) {
  return output.split(/\r?\n/).flatMap((raw) => {
    const text = raw.replace(ANSI, '');
    const match = text.match(PLAIN_ERROR) ?? text.match(PRETTY_ERROR);
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

const running = new Set();

const killGroup = (child) => {
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {}
};

// The script runs in a process group of its own, so that a timeout or a stopped run kills the
// tsc it started too, not only its shell.
function runTypecheck(appDir, script, env, timeoutMs) {
  return new Promise((resolveRun) => {
    const child = spawn('sh', ['-c', `${script} --pretty false`], {
      cwd: appDir,
      env: { ...env, PATH: `${join(appDir, 'node_modules', '.bin')}${delimiter}${env.PATH ?? ''}` },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    running.add(child);
    let output = '';
    let timedOut = false;
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child);
    }, timeoutMs);
    const finish = (result) => {
      clearTimeout(timer);
      running.delete(child);
      resolveRun({ output, timedOut, ...result });
    };
    child.on('error', (error) => finish({ error }));
    child.on('close', (status, signal) => finish({ status, signal }));
  });
}

async function checkApp({ root, tag, app, env, runDir, timeoutMs }) {
  const manifest = JSON.parse(
    git(root, ['show', `${tagRef(tag)}:examples/${app}/package.json`], { encoding: 'utf8' }),
  );
  const script = manifest.scripts?.typecheck;
  if (typeof script !== 'string') {
    return { app, skipped: 'it has no typecheck script at the release' };
  }
  if (!TSC_LAST.test(script.trim())) {
    return {
      app,
      errors: [],
      problems: [`its typecheck script does not end in a tsc run: ${script}`],
    };
  }
  const realApp = join(root, 'examples', app);
  const links = nodeModulesIn(realApp);
  if (!links.includes('node_modules')) {
    return { app, errors: [], problems: ['it has no node_modules; run pnpm install'] };
  }
  const started = performance.now();
  extract(root, tag, [`examples/${app}`], runDir);
  const appDir = join(runDir, 'examples', app);
  for (const link of links) {
    if (existsSync(dirname(join(appDir, link)))) {
      symlinkSync(join(realApp, link), join(appDir, link));
    }
  }
  let run;
  try {
    run = await runTypecheck(appDir, script.trim(), env, timeoutMs);
  } finally {
    rmSync(appDir, { recursive: true, force: true });
  }
  const errors = parseErrors(run.output);
  const problems = [];
  const tail = () => run.output.trim().split('\n').slice(-20).join('\n');
  if (run.timedOut) problems.push(`its typecheck did not finish in ${timeoutMs / 1000} s`);
  else if (run.error) problems.push(`its typecheck did not start: ${run.error.message}`);
  else if (run.signal) problems.push(`its typecheck was stopped by ${run.signal}:\n${tail()}`);
  else if (run.status !== 0 && errors.length === 0) {
    problems.push(`\`${script}\` exited with ${run.status} without a type error:\n${tail()}`);
  }
  return { app, script, errors, problems, ms: Math.round(performance.now() - started) };
}

const recordMatches = (record, app, error) =>
  record.app === app &&
  record.file === error.file &&
  record.line === error.line &&
  record.code === error.code &&
  record.message === error.message;

const recordLabel = (record) =>
  `the record for ${record.app} ${record.file}:${record.line} ${record.code}`;

// Marks each error a record of this release covers. Records of apps that were not checked are
// left alone; records of earlier releases are listed as removable.
export function applyRecords({ results, records, version, strict }) {
  const checked = new Map(
    results.filter((result) => result.errors).map((result) => [result.app, result]),
  );
  const removable = [];
  const problems = [];
  for (const record of records) {
    const order = compareVersions(record.release, version);
    if (order < 0) removable.push(record);
    else if (order > 0) {
      problems.push(
        `${recordLabel(record)} is for release ${record.release}, which is later than the last release ${version}.`,
      );
    } else if (checked.has(record.app)) {
      const matches = checked
        .get(record.app)
        .errors.filter((error) => recordMatches(record, record.app, error));
      if (matches.length === 0)
        problems.push(`${recordLabel(record)} matches no error. Remove it.`);
      else if (matches.length > 1) {
        problems.push(
          `${recordLabel(record)} matches ${matches.length} errors; it must match exactly one.`,
        );
      } else matches[0].recorded = record.reason;
    }
  }
  for (const result of checked.values()) {
    for (const error of result.errors) error.failsRun = strict && error.recorded === undefined;
  }
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

const count = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;

const describeError = ({ file, line, column, code, message }) =>
  `${file}(${line},${column}): ${code} ${message}`;

const describeRecord = ({ app, file, line, code, release, reason }) =>
  `${app} ${file}:${line} ${code} (release ${release}): ${reason}`;

const headline = ({ version, tag, strict }) =>
  `last release ${version} (tag ${tag}); ${strict ? 'an error fails unless it is recorded' : 'a pre-release, so errors are reported and do not fail'}`;

const appFails = (result) =>
  (result.problems?.length ?? 0) > 0 || (result.errors ?? []).some((error) => error.failsRun);

const recordedCount = (result) =>
  result.errors.filter((error) => error.recorded !== undefined).length;

const appSummary = (result) =>
  `${count(result.errors.length, 'error')} in ${count(byFile(result.errors).length, 'file')} (${recordedCount(result)} recorded)`;

export function reportText(report) {
  const lines = [`api:compat:examples: ${headline(report)}`];
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
      `\nRecords for a release before ${report.version}, skipped; remove them:`,
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
        `| ${result.app} | ${result.errors.length} | ${recordedCount(result)} | ${byFile(result.errors).length} | ${result.problems.length} |`,
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
      `Records for a release before ${report.version}, skipped; remove them:`,
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
  timeoutMs = TYPECHECK_TIMEOUT_MS,
}) {
  const { version, tag } = await findRelease();
  const strict = ga || !isPrerelease(version);
  fetchReleaseTag(tag, root);
  const atTag = appsAtTag(root, tag);
  const current = currentApps(root);
  const known = new Set([...atTag, ...current]);
  const problems = (only ?? [])
    .filter((app) => !known.has(app))
    .map((app) => `--only names ${app}, which is not an app at the release or now`);
  const apps = [...known]
    .filter((app) => only === undefined || only.includes(app))
    .sort(compareCodeUnits);
  const records = readRecords(root).filter((record) => apps.includes(record.app));
  const runDir = startRunFolder(root);
  const results = [];
  try {
    prepareRunFolder(root, tag, runDir);
    for (const app of apps) {
      if (!atTag.has(app)) results.push({ app, skipped: 'it was added after the release' });
      else if (!current.has(app)) {
        results.push({ app, skipped: 'it was removed after the release' });
      } else results.push(await checkApp({ root, tag, app, env, runDir, timeoutMs }));
    }
  } finally {
    endRunFolder(runDir);
  }
  const applied = applyRecords({ results, records, version, strict });
  return {
    version,
    tag,
    strict,
    results,
    removable: applied.removable,
    problems: [...problems, ...applied.problems],
  };
}

// A stopped run kills the typechecks it started, which are in process groups of their own and so
// do not get the terminal's signal. Its folder is removed by the next run.
function stopOnSignal(signal) {
  for (const child of running) killGroup(child);
  process.exit(signal === 'SIGINT' ? 130 : 143);
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
  process.on('SIGINT', stopOnSignal);
  process.on('SIGTERM', stopOnSignal);
  let report;
  try {
    report = await checkExamples({
      root,
      ga: values.ga,
      only: values.only?.split(','),
      env,
      findRelease,
    });
  } catch (error) {
    if (!(error instanceof ExamplesError) && !(error instanceof LastReleaseError)) throw error;
    stderr.write(`api:compat:examples: ${error.message}\n`);
    return 1;
  } finally {
    process.off('SIGINT', stopOnSignal);
    process.off('SIGTERM', stopOnSignal);
  }
  stdout.write(reportText(report));
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, reportMarkdown(report));
  return failsRun(report) ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main({ root: resolve(here, '..', '..'), args: process.argv.slice(2) });
}
