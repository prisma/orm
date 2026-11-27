#!/usr/bin/env node
// Usage: node scripts/public-api/api-examples.mjs [--only <app>,…], run as
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
// them. Such an error, or one a deliberate break causes, is recorded in
// examples/last-release-errors.json, which records.mjs describes. The tag's files never change, so
// a record names its error by app, file, line, code and message, the message as the report prints
// it, with `import("…")` qualifiers left out. Each record must match exactly one error (line 0 for
// an error with no location); one that matches none fails the run.
//
// An error that is not recorded fails the run. Needs network access to the
// origin remote, for the release tags.

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
import { compareCodeUnits } from './api-lines.mjs';
import {
  byLastRelease,
  EXAMPLES_FILE,
  normaliseMessage,
  RecordsError,
  readRecords as readRecordFile,
} from './records.mjs';
import { fetchReleaseTag, LastReleaseError, lastRelease } from './release.mjs';
import { withinBytes } from './summary.mjs';

const here = dirname(fileURLToPath(import.meta.url));

export const RUN_FOLDER = '.api-examples';
const TYPECHECK_TIMEOUT_MS = 10 * 60 * 1000;

export class ExamplesError extends Error {}

export const readRecords = (root) =>
  readRecordFile(join(root, EXAMPLES_FILE), 'examples', EXAMPLES_FILE);

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
// Another run can remove the folder between the two calls.
function readdirOrNothing(dir) {
  try {
    return readdirSync(dir);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function startRunFolder(root) {
  const runs = join(root, RUN_FOLDER);
  if (existsSync(runs)) {
    for (const name of readdirOrNothing(runs)) {
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
// Printed just before the script's tsc run, so that a step before it that fails is told apart
// from tsc finding errors.
const TSC_MARKER = 'api:compat:examples: tsc starts';
const withTscMarker = (script) =>
  script.replace(
    /(^|&&)(\s*tsc(?:\s[^&|;]*)?)$/,
    (_, before, tsc) => `${before} echo '${TSC_MARKER}' &&${tsc}`,
  );
// Errors in the compiler's options, or in the files it is given to read: the check could not run.
// Other TS6xxx codes, such as unused declarations, are ordinary errors.
const SETUP_ERROR = /^TS(?:5\d{3}|6053|6054|6059|6231|630[5-9]|6310|18003)$/;

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const PLAIN_ERROR = /^(?:(.+)\((\d+),(\d+)\): )?error (TS\d+): (.*)$/;
const PRETTY_ERROR = /^(.+):(\d+):(\d+) - error (TS\d+): (.*)$/;

// Each error, with the indented lines that explain it joined to its message, so that two errors
// that differ only there are told apart.
export function parseErrors(output) {
  const errors = [];
  for (const raw of output.split(/\r?\n/)) {
    const text = raw.replace(ANSI, '');
    const match = text.match(PLAIN_ERROR) ?? text.match(PRETTY_ERROR);
    if (match) {
      const [, file, line, column, code, message] = match;
      errors.push({
        file: file ?? '(no file)',
        line: line === undefined ? 0 : Number(line),
        column: column === undefined ? 0 : Number(column),
        code,
        message: normaliseMessage(message.trim()),
      });
    } else if (errors.length > 0 && /^ {2,}[^\s~]/.test(text) && !/^ +\d+ /.test(text)) {
      const last = errors.at(-1);
      last.message = `${last.message} ${normaliseMessage(text.trim())}`;
    }
  }
  return errors;
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
    const child = spawn('sh', ['-c', `${withTscMarker(script)} --pretty false`], {
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
  const tscRan = run.output.includes(TSC_MARKER);
  const output = run.output.replace(`${TSC_MARKER}\n`, '\n');
  const parsed = tscRan ? parseErrors(output) : [];
  const setup = parsed.filter((error) => SETUP_ERROR.test(error.code));
  const errors = parsed.filter((error) => !SETUP_ERROR.test(error.code));
  const problems = [];
  const tail = () => output.trim().split('\n').slice(-20).join('\n');
  if (run.timedOut) problems.push(`its typecheck did not finish in ${timeoutMs / 1000} s`);
  else if (run.error) problems.push(`its typecheck did not start: ${run.error.message}`);
  else if (run.signal) problems.push(`its typecheck was stopped by ${run.signal}:\n${tail()}`);
  else if (!tscRan) {
    problems.push(
      `a step before its tsc run exited with ${run.status}, so tsc did not run:\n${tail()}`,
    );
  } else if (setup.length > 0) {
    problems.push(
      `the compiler could not run as configured: ${setup.map((error) => `${error.code} ${error.message}`).join('; ')}`,
    );
  } else if (run.status !== 0 && errors.length === 0) {
    problems.push(`\`${script}\` exited with ${run.status} without a type error:\n${tail()}`);
  }
  return {
    app,
    script,
    errors: setup.length > 0 ? [] : errors,
    problems,
    ms: Math.round(performance.now() - started),
  };
}

const recordMatches = (record, app, error) =>
  record.app === app &&
  record.file === error.file &&
  record.line === error.line &&
  record.code === error.code &&
  normaliseMessage(record.message) === error.message;

const recordLabel = (record) =>
  `the record for ${record.app} ${record.file}:${record.line} ${record.code}`;

// Marks each error a record of this release covers. Records of apps that were not checked are
// left alone; records of earlier releases are listed as removable.
export function applyRecords({ results, records, version }) {
  // An app whose check did not complete says nothing about its records.
  const checked = new Map(
    results
      .filter((result) => result.errors && (result.problems ?? []).length === 0)
      .map((result) => [result.app, result]),
  );
  const sorted = byLastRelease(records, version, recordLabel);
  const removable = sorted.removable;
  const problems = [...sorted.problems];
  const recorded = [];
  for (const record of sorted.current) {
    if (checked.has(record.app)) {
      const matches = checked
        .get(record.app)
        .errors.filter((error) => recordMatches(record, record.app, error));
      if (matches.length === 0)
        problems.push(`${recordLabel(record)} matches no error. Remove it.`);
      else if (matches.length > 1) {
        problems.push(
          `${recordLabel(record)} matches ${matches.length} errors; it must match exactly one.`,
        );
      } else {
        matches[0].recorded = { kind: record.kind, reason: record.reason };
        recorded.push(record);
      }
    }
  }
  for (const result of checked.values()) {
    for (const error of result.errors) error.failsRun = error.recorded === undefined;
  }
  return { removable, problems, recorded };
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

const describeRecord = ({ app, file, line, code, lastRelease: last, reason }) =>
  `${app} ${file}:${line} ${code} (last release ${last}): ${reason}`;

const sameMessage = (errors, error) =>
  errors.filter(
    (other) =>
      other.file === error.file &&
      other.line === error.line &&
      other.code === error.code &&
      other.message === error.message,
  ).length;

// The record that would accept an error, ready to paste with its kind and reason.
const recordOf = (app, { file, line, code, message }, lastRelease) => ({
  app,
  file,
  line,
  code,
  message,
  kind: 'break',
  lastRelease,
  reason: '…',
});

const recordedLabel = ({ recorded }) =>
  recorded === undefined
    ? ''
    : ` (recorded ${recorded.kind === 'break' ? 'break' : 'allowed change'}: ${recorded.reason})`;

const RECORD_KINDS = [
  { kind: 'break', heading: 'Recorded deliberate breaks:' },
  { kind: 'allowed', heading: 'Recorded allowed changes:' },
];

const headline = ({ version, tag }) =>
  `last release ${version} (tag ${tag}); an error fails unless it is recorded`;

const appFails = (result) =>
  (result.problems?.length ?? 0) > 0 || (result.errors ?? []).some((error) => error.failsRun);

const recordedCount = (result, kind) =>
  result.errors.filter((error) => error.recorded?.kind === kind).length;

const appSummary = (result) =>
  `${count(result.errors.length, 'error')} in ${count(byFile(result.errors).length, 'file')} (recorded: ${recordedCount(result, 'allowed')} allowed, ${count(recordedCount(result, 'break'), 'break')})`;

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
        lines.push(`    ${describeError(error)}${recordedLabel(error)}`);
        if (error.recorded === undefined) {
          const twins = sameMessage(result.errors, error);
          lines.push(
            twins > 1
              ? `      no record printed: ${twins} errors on this line have this message, so a record cannot tell them apart`
              : `      to record it: ${JSON.stringify(recordOf(result.app, error, report.version))}`,
          );
        }
      }
    }
    for (const problem of result.problems) lines.push(`  problem  ${problem}`);
  }
  for (const { kind, heading } of RECORD_KINDS) {
    const records = report.recorded.filter((record) => record.kind === kind);
    if (records.length > 0) {
      lines.push(`\n${heading}`, ...records.map((record) => `  ${describeRecord(record)}`));
    }
  }
  const skipped = report.results.filter((result) => result.skipped);
  if (skipped.length > 0) {
    lines.push('\nSkipped:', ...skipped.map(({ app, skipped: why }) => `  ${app}: ${why}`));
  }
  if (report.removable.length > 0) {
    lines.push(
      `\nRecords for a last release before ${report.version}, skipped; remove them:`,
      ...report.removable.map((record) => `  ${describeRecord(record)}`),
    );
  }
  for (const problem of report.problems) lines.push(`\nproblem  ${problem}`);
  return `${lines.join('\n')}\n`;
}

// `<` and `&` are escaped, so that a message such as one naming `<string>` reaches the reader, and
// a record copied from the summary, as written.
const cell = (text) =>
  String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('|', '\\|')
    .replaceAll('\n', ' ');
const SAMPLES_PER_FILE = 3;

export function reportMarkdown(report, { maxBytes } = {}) {
  const checked = report.results.filter((result) => !result.skipped);
  const lines = [
    `## The example apps of ${report.version} against this build`,
    '',
    `${headline(report).replace(/^./, (first) => first.toUpperCase())}. Records are in \`${EXAMPLES_FILE}\`.`,
    '',
    '| App | Errors | Allowed | Breaks | Files | Problems |',
    '| --- | --- | --- | --- | --- | --- |',
    ...checked.map(
      (result) =>
        `| ${result.app} | ${result.errors.length} | ${recordedCount(result, 'allowed')} | ${recordedCount(result, 'break')} | ${byFile(result.errors).length} | ${result.problems.length} |`,
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
            `  - ${error.line}:${error.column} ${error.code} ${cell(error.message)}${cell(recordedLabel(error))}`,
        ),
      ...(errors.length > SAMPLES_PER_FILE
        ? [`  - and ${errors.length - SAMPLES_PER_FILE} more in the job log`]
        : []),
    ]);
    items.push(...result.problems.map((problem) => `- problem: ${cell(problem)}`));
    const unrecorded = result.errors.filter(
      (error) => error.recorded === undefined && sameMessage(result.errors, error) === 1,
    );
    if (unrecorded.length > 0) {
      items.push(
        '',
        `To accept these errors, add to \`${EXAMPLES_FILE}\`, with the kind and the reason:`,
        '',
        '```json',
        ...unrecorded.map((error) => JSON.stringify(recordOf(result.app, error, report.version))),
        '```',
      );
    }
    if (items.length > 0) lines.push(`### ${result.app}`, '', ...items, '');
  }
  for (const { kind, heading } of RECORD_KINDS) {
    const records = report.recorded.filter((record) => record.kind === kind);
    if (records.length > 0) {
      lines.push(heading, '', ...records.map((record) => `- ${cell(describeRecord(record))}`), '');
    }
  }
  const skipped = report.results.filter((result) => result.skipped);
  if (skipped.length > 0) {
    const apps = skipped.map(({ app, skipped: why }) => `${app} (${why})`);
    lines.push(`Skipped: ${apps.join(', ')}`, '');
  }
  if (report.removable.length > 0) {
    lines.push(
      `Records for a last release before ${report.version}, skipped; remove them:`,
      '',
      ...report.removable.map((record) => `- ${cell(describeRecord(record))}`),
      '',
    );
  }
  lines.push(...report.problems.map((problem) => `- problem: ${cell(problem)}`));
  return withinBytes(lines, maxBytes);
}

export async function checkExamples({
  root,
  only,
  env = process.env,
  findRelease = () => lastRelease({ root }),
  timeoutMs = TYPECHECK_TIMEOUT_MS,
}) {
  const { version, tag } = await findRelease();
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
  const applied = applyRecords({ results, records, version });
  return {
    version,
    tag,
    results,
    removable: applied.removable,
    recorded: applied.recorded,
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
    options: { only: { type: 'string' } },
  });
  process.on('SIGINT', stopOnSignal);
  process.on('SIGTERM', stopOnSignal);
  let report;
  try {
    report = await checkExamples({
      root,
      only: values.only?.split(','),
      env,
      findRelease,
    });
  } catch (error) {
    if (
      !(error instanceof ExamplesError) &&
      !(error instanceof LastReleaseError) &&
      !(error instanceof RecordsError)
    ) {
      throw error;
    }
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
