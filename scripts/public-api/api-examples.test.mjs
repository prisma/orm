import { deepStrictEqual, match, rejects, strictEqual } from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  applyRecords,
  checkExamples,
  failsRun,
  main,
  parseErrors,
  RUN_FOLDER,
  reportMarkdown,
  reportText,
} from './api-examples.mjs';
import { EXAMPLES_FILE } from './records.mjs';
import { LastReleaseError, lastRelease } from './release.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const work = join(repoRoot, 'wip', `api-examples-tests-${process.pid}`);
const origin = join(work, 'origin');
const checkout = join(work, 'checkout');
after(() => rmSync(work, { recursive: true, force: true }));

const git = (cwd, ...args) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'commit.gpgSign',
      GIT_CONFIG_VALUE_0: 'false',
      GIT_CONFIG_KEY_1: 'tag.gpgSign',
      GIT_CONFIG_VALUE_1: 'false',
    },
  });

function write(root, files) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

const lib = (row) => `export declare function getRow(): ${row};\n`;
const ROW = lib('{ id: number }');
const OPTIONAL_NAME = lib('{ id: number; name?: string }');
const STRING_ID = lib('{ id: string }');
const BOOLEAN_ID = lib('{ id: boolean }');
const EXACT_LINE = 5;
const CONSTRAINT_LINE = 7;
const ID_LINE = 9;

const appIndex = ({ tagOnly }) =>
  [
    "import { getRow } from 'lib';",
    "import { generated } from './generated';",
    tagOnly ? "import { tagOnly } from './tag-only';" : 'export const current = true;',
    'type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;',
    'export const exact: Equal<ReturnType<typeof getRow>, { id: number }> = true;',
    'type HasId<T extends { id: number }> = T;',
    'export type Checked = HasId<ReturnType<typeof getRow>>;',
    tagOnly ? 'export { generated, tagOnly };' : 'export { generated };',
    "export const idIsNumber: Equal<ReturnType<typeof getRow>['id'], number> = true;",
    '',
  ].join('\n');

const TSC = 'tsc --project tsconfig.json --noEmit';

const app = (
  name,
  { script = `node gen.mjs && ${TSC}`, compilerOptions = {}, files = {} } = {},
) => ({
  [`examples/${name}/package.json`]: JSON.stringify({
    name,
    private: true,
    scripts: { typecheck: script },
  }),
  [`examples/${name}/.gitignore`]: 'src/generated.ts\n',
  [`examples/${name}/gen.mjs`]:
    "import { writeFileSync } from 'node:fs';\nwriteFileSync('src/generated.ts', 'export const generated = 1;\\n');\n",
  [`examples/${name}/tsconfig.json`]: JSON.stringify({
    extends: '../../tsconfig.base.json',
    compilerOptions,
    include: ['src'],
  }),
  [`examples/${name}/src/index.ts`]: appIndex({ tagOnly: true }),
  [`examples/${name}/src/tag-only.ts`]: 'export const tagOnly = 1;\n',
  [`examples/${name}/src/generated.ts`]: 'export const generated = 1;\n',
  ...Object.fromEntries(
    Object.entries(files).map(([path, text]) => [`examples/${name}/${path}`, text]),
  ),
});

const CURRENT_APPS = [
  'app',
  'added',
  'nostep',
  'exits',
  'killed',
  'slow',
  'pretty',
  'precheck',
  'misconfigured',
  'unused',
  'partial',
];

function linkNodeModules(appDir) {
  const modules = join(appDir, 'node_modules');
  mkdirSync(join(modules, '.bin'), { recursive: true });
  symlinkSync(relative(modules, join(checkout, 'packages', 'lib')), join(modules, 'lib'));
  symlinkSync(join(repoRoot, 'node_modules', 'typescript'), join(modules, 'typescript'));
  symlinkSync(join('..', 'typescript', 'bin', 'tsc'), join(modules, '.bin', 'tsc'));
}

before(() => {
  mkdirSync(origin, { recursive: true });
  git(origin, 'init', '--quiet', '--initial-branch=main');
  write(origin, {
    '.gitignore': 'node_modules\n/wip/\n/.api-examples/\n',
    'tsconfig.base.json': JSON.stringify({
      compilerOptions: {
        strict: true,
        module: 'esnext',
        moduleResolution: 'bundler',
        skipLibCheck: true,
        noEmit: true,
        types: [],
      },
    }),
    'packages/lib/package.json': JSON.stringify({ name: 'lib', types: 'index.d.ts' }),
    'packages/lib/index.d.ts': ROW,
    ...app('app'),
    ...app('removed'),
    ...app('nostep', { script: 'echo skipped' }),
    ...app('exits', { script: `node -e "process.exit(3)" && ${TSC}` }),
    ...app('killed', { script: `kill -KILL $$ && ${TSC}` }),
    ...app('precheck', {
      script: `node -e "console.log('src/x.ts(1,1): error TS2322: Type from a step before tsc.'); process.exit(1)" && ${TSC}`,
    }),
    ...app('misconfigured', { script: 'tsc --project tsconfig.missing.json --noEmit' }),
    ...app('unused', {
      compilerOptions: { noUnusedLocals: true },
      files: { 'src/unused.ts': 'const unused = 1;\nexport {};\n' },
    }),
    ...app('partial', { script: `node -e "process.stderr.write('no newline')" && ${TSC}` }),
    ...app('slow', {
      script: `node slow.mjs && ${TSC}`,
      files: {
        'slow.mjs':
          "import { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.SLOW_PID_FILE, String(process.pid));\nsetInterval(() => {}, 1000);\n",
      },
    }),
    ...app('pretty', {
      compilerOptions: { pretty: true },
      files: { 'src/broken.ts': "export const broken: number = 'x';\n" },
    }),
  });
  git(origin, 'add', '.');
  git(origin, 'commit', '--quiet', '-m', 'release');
  git(origin, 'tag', 'v1.0.0');
  rmSync(join(origin, 'examples', 'removed'), { recursive: true });
  rmSync(join(origin, 'tsconfig.base.json'));
  for (const name of CURRENT_APPS.filter((each) => each !== 'added')) {
    rmSync(join(origin, 'examples', name, 'src', 'tag-only.ts'));
    write(origin, { [`examples/${name}/src/index.ts`]: appIndex({ tagOnly: false }) });
  }
  write(origin, app('added'));
  git(origin, 'add', '-A');
  git(origin, 'commit', '--quiet', '-m', 'after the release');
  git(work, 'clone', '--quiet', '--depth=1', '--no-tags', `file://${origin}`, checkout);
  for (const name of CURRENT_APPS) linkNodeModules(join(checkout, 'examples', name));
});

const findRelease =
  (version = '1.0.0') =>
  () =>
    lastRelease({ root: checkout, base: 'HEAD', versionAt: () => version });
const releaseAs = (version) => async () => ({ ...(await findRelease()()), version });

async function withLib(text, run) {
  const file = join(checkout, 'packages', 'lib', 'index.d.ts');
  writeFileSync(file, text);
  try {
    return await run();
  } finally {
    writeFileSync(file, ROW);
  }
}

async function withRecords(records, run) {
  const file = join(checkout, EXAMPLES_FILE);
  writeFileSync(file, JSON.stringify(records));
  try {
    return await run();
  } finally {
    rmSync(file);
  }
}

const check = (options = {}) =>
  checkExamples({ root: checkout, only: ['app'], findRelease: findRelease(), ...options });

const resultFor = (report, name) => report.results.find((result) => result.app === name);
const appResult = (report) => resultFor(report, 'app');
const locations = (result) =>
  result.errors.map(({ line, code, failsRun: fails, recorded }) => ({
    line,
    code,
    fails,
    recorded,
  }));

async function errorAt(text, line) {
  const report = await withLib(text, () => check());
  return appResult(report).errors.find((error) => error.line === line);
}

const recordFor = (error, overrides = {}) => ({
  app: 'app',
  file: error.file,
  line: error.line,
  code: error.code,
  message: error.message,
  kind: 'allowed',
  lastRelease: '1.0.0',
  reason: 'rows may gain optional properties',
  ...overrides,
});

function snapshot(dir) {
  const files = {};
  const walk = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(full);
      } else if (!entry.isSymbolicLink()) files[relative(dir, full)] = readFileSync(full, 'utf8');
    }
  };
  walk(dir);
  return files;
}

describe('checkExamples', () => {
  it("passes an app that compiles against the current build, with the tag's root tsconfig", async () => {
    const report = await check();
    deepStrictEqual(appResult(report).errors, []);
    deepStrictEqual(appResult(report).problems, []);
    strictEqual(failsRun(report), false);
  });

  it('compiles the app as it was at the tag, not as it is now', async () => {
    write(checkout, { 'examples/app/src/extra.ts': "export const broken: number = 'x';\n" });
    try {
      const report = await check();
      deepStrictEqual(appResult(report).errors, []);
      deepStrictEqual(appResult(report).problems, []);
    } finally {
      rmSync(join(checkout, 'examples', 'app', 'src', 'extra.ts'));
    }
  });

  it("never writes in the developer's app folder, and leaves no run folder", async () => {
    const appDir = join(checkout, 'examples', 'app');
    write(appDir, {
      'notes.txt': 'untracked\n',
      'src/generated.ts': 'export const generated = 2;\n',
    });
    try {
      const before = snapshot(appDir);
      const status = git(checkout, 'status', '--porcelain', '--ignored');
      const report = await withLib(OPTIONAL_NAME, () => check());
      strictEqual(failsRun(report), true);
      deepStrictEqual(snapshot(appDir), before);
      strictEqual(existsSync(join(appDir, 'src', 'tag-only.ts')), false);
      strictEqual(git(checkout, 'status', '--porcelain', '--ignored'), status);
      strictEqual(existsSync(join(checkout, RUN_FOLDER)), false);
    } finally {
      rmSync(join(appDir, 'notes.txt'));
      write(appDir, { 'src/generated.ts': 'export const generated = 1;\n' });
    }
  });

  it('removes the folders of runs whose process has gone', async () => {
    const stale = join(checkout, RUN_FOLDER, '999999999-dead');
    mkdirSync(join(stale, 'examples'), { recursive: true });
    await check();
    strictEqual(existsSync(stale), false);
  });

  it('keeps two runs at once apart', async () => {
    const [first, second] = await withLib(OPTIONAL_NAME, () =>
      Promise.all([check(), check({ findRelease: releaseAs('1.0.0-rc.1') })]),
    );
    deepStrictEqual(
      [first, second].map((report) => [appResult(report).errors.length, failsRun(report)]),
      [
        [1, true],
        [1, true],
      ],
    );
  });

  it('fails on a changed result type', async () => {
    const report = await withLib(OPTIONAL_NAME, () => check());
    deepStrictEqual(locations(appResult(report)), [
      { line: EXACT_LINE, code: 'TS2322', fails: true, recorded: undefined },
    ]);
    strictEqual(failsRun(report), true);
  });

  it('fails on a changed result type against a pre-release too, saying so in its headline', async () => {
    const report = await withLib(OPTIONAL_NAME, () =>
      check({ findRelease: releaseAs('1.0.0-rc.1') }),
    );
    strictEqual(appResult(report).errors.length, 1);
    strictEqual(failsRun(report), true);
    match(
      reportText(report),
      /^api:compat:examples: last release 1\.0\.0-rc\.1 \(tag v1\.0\.0\); an error fails unless it is recorded\n/,
    );
  });

  it('passes a recorded error', async () => {
    const error = await errorAt(OPTIONAL_NAME, EXACT_LINE);
    const record = recordFor(error);
    const report = await withLib(OPTIONAL_NAME, () => withRecords([record], () => check()));
    deepStrictEqual(appResult(report).errors[0].recorded, {
      kind: 'allowed',
      reason: record.reason,
    });
    strictEqual(failsRun(report), false);
  });

  it('rejects a record without a kind, with another kind, or with the old release field', async () => {
    const error = await errorAt(OPTIONAL_NAME, EXACT_LINE);
    const { kind: _, ...withoutKind } = recordFor(error);
    const { lastRelease: last, ...withoutLastRelease } = recordFor(error);
    for (const record of [
      withoutKind,
      recordFor(error, { kind: 'fine' }),
      { ...withoutLastRelease, release: last },
    ]) {
      await rejects(
        withRecords([record], () => check()),
        /last-release-errors\.json: [\s\S]*Each record is \{ "app", "file", "line", "code", "message", "kind", "lastRelease", "reason" \}/,
      );
    }
  });

  it('covers only the line a record names', async () => {
    const error = await errorAt(STRING_ID, EXACT_LINE);
    const report = await withLib(STRING_ID, () => withRecords([recordFor(error)], () => check()));
    deepStrictEqual(
      locations(appResult(report)).map(({ line, fails }) => ({ line, fails })),
      [
        { line: EXACT_LINE, fails: false },
        { line: CONSTRAINT_LINE, fails: true },
        { line: ID_LINE, fails: true },
      ],
    );
    strictEqual(failsRun(report), true);
  });

  it('covers only the message a record names, so a later break on the line fails', async () => {
    const error = await errorAt(STRING_ID, CONSTRAINT_LINE);
    const report = await withLib(BOOLEAN_ID, () => withRecords([recordFor(error)], () => check()));
    const later = appResult(report).errors.find((each) => each.line === CONSTRAINT_LINE);
    strictEqual(later.failsRun, true);
    strictEqual(report.problems.length, 1);
    match(report.problems[0], /matches no error/);
  });

  it('fails on a record that matches no error', async () => {
    const error = await errorAt(OPTIONAL_NAME, EXACT_LINE);
    const report = await withRecords([recordFor(error)], () => check());
    deepStrictEqual(report.problems, [
      `the record for app src/index.ts:${EXACT_LINE} TS2322 matches no error. Remove it.`,
    ]);
    strictEqual(failsRun(report), true);
  });

  it('skips a record for an earlier release and lists it as removable', async () => {
    const error = await errorAt(OPTIONAL_NAME, EXACT_LINE);
    const stale = recordFor(error, { lastRelease: '0.9.0' });
    const report = await withRecords([stale], () => check());
    deepStrictEqual(report.removable, [stale]);
    deepStrictEqual(report.problems, []);
    strictEqual(failsRun(report), false);
  });

  it('ignores records for apps it does not check, skipped or left out by --only', async () => {
    const error = await errorAt(OPTIONAL_NAME, EXACT_LINE);
    const report = await withRecords(
      [
        recordFor(error, { app: 'added' }),
        recordFor(error, { app: 'removed' }),
        recordFor(error, { app: 'nostep', lastRelease: '2.0.0' }),
      ],
      () => check({ only: ['app', 'added'] }),
    );
    deepStrictEqual(report.problems, []);
    strictEqual(failsRun(report), false);
  });

  it('fails when --only names something that is not an app', async () => {
    const report = await check({ only: ['app', 'nope'] });
    deepStrictEqual(report.problems, [
      '--only names nope, which is not an app at the release or now',
    ]);
    strictEqual(failsRun(report), true);
  });

  it('skips an app that did not exist at the tag, or no longer exists', async () => {
    const report = await check({ only: ['added', 'app', 'removed'] });
    deepStrictEqual(
      report.results.map(({ app: name, skipped }) => ({ name, skipped })),
      [
        { name: 'added', skipped: 'it was added after the release' },
        { name: 'app', skipped: undefined },
        { name: 'removed', skipped: 'it was removed after the release' },
      ],
    );
  });

  it('reads errors whatever the tsconfig says about pretty output', async () => {
    const report = await check({ only: ['pretty'] });
    deepStrictEqual(
      resultFor(report, 'pretty').errors.map(({ file, line, code }) => ({ file, line, code })),
      [{ file: 'src/broken.ts', line: 1, code: 'TS2322' }],
    );
  });

  it('is a problem when the typecheck script does not end in a tsc run', async () => {
    const report = await check({ only: ['nostep'] });
    deepStrictEqual(resultFor(report, 'nostep').problems, [
      'its typecheck script does not end in a tsc run: echo skipped',
    ]);
    strictEqual(failsRun(report), true);
  });

  it('is a problem when a step before its tsc run fails, whatever that step printed', async () => {
    for (const name of ['exits', 'precheck']) {
      const report = await check({ only: [name] });
      match(resultFor(report, name).problems[0], /a step before its tsc run exited with [13]/);
      deepStrictEqual(resultFor(report, name).errors, []);
      strictEqual(failsRun(report), true);
    }
  });

  it('is a problem, at any version, when the compiler cannot run as configured', async () => {
    const report = await check({ only: ['misconfigured'], findRelease: releaseAs('1.0.0-rc.1') });
    match(
      resultFor(report, 'misconfigured').problems[0],
      /the compiler could not run as configured: TS\d+/,
    );
    deepStrictEqual(resultFor(report, 'misconfigured').errors, []);
    strictEqual(failsRun(report), true);
  });

  it('reports an unused declaration as an error of the app, not as a setup problem', async () => {
    const result = resultFor(await check({ only: ['unused'] }), 'unused');
    deepStrictEqual(result.problems, []);
    deepStrictEqual(
      result.errors.map((error) => error.code),
      ['TS6133'],
    );
  });

  it('finds the tsc marker after a partial line left by an earlier step', async () => {
    deepStrictEqual(resultFor(await check({ only: ['partial'] }), 'partial').problems, []);
  });

  it('names the signal that stopped the typecheck', async () => {
    const report = await check({ only: ['killed'] });
    match(resultFor(report, 'killed').problems[0], /was stopped by SIGKILL/);
  });

  it('kills the whole typecheck, its children included, when it takes too long', {
    timeout: 20_000,
  }, async () => {
    const pidFile = join(work, 'slow.pid');
    const report = await check({
      only: ['slow'],
      timeoutMs: 1500,
      env: { ...process.env, SLOW_PID_FILE: pidFile },
    });
    match(resultFor(report, 'slow').problems[0], /did not finish in 1\.5 s/);
    const pid = Number(readFileSync(pidFile, 'utf8'));
    let alive = true;
    for (let attempt = 0; attempt < 20 && alive; attempt++) {
      try {
        process.kill(pid, 0);
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch {
        alive = false;
      }
    }
    strictEqual(alive, false);
  });
});

describe('applyRecords', () => {
  const error = (overrides = {}) => ({
    file: 'src/a.ts',
    line: 3,
    column: 1,
    code: 'TS2322',
    message: 'Type "x" is not assignable.',
    ...overrides,
  });
  const record = (overrides = {}) => ({
    app: 'a',
    file: 'src/a.ts',
    line: 3,
    code: 'TS2322',
    message: 'Type "x" is not assignable.',
    kind: 'allowed',
    lastRelease: '1.0.0',
    reason: 'allowed',
    ...overrides,
  });
  const apply = (errors, records) =>
    applyRecords({ results: [{ app: 'a', errors }], records, version: '1.0.0' });

  it('fails an error no record covers, against a pre-release too', () => {
    const unrecorded = error();
    applyRecords({
      results: [{ app: 'a', errors: [unrecorded] }],
      records: [],
      version: '1.0.0-rc.1',
    });
    strictEqual(unrecorded.failsRun, true);
  });

  it('fails a record that matches more than one error', () => {
    const { problems } = apply([error(), error({ column: 9 })], [record()]);
    deepStrictEqual(problems, [
      'the record for a src/a.ts:3 TS2322 matches 2 errors; it must match exactly one.',
    ]);
  });

  it('covers an error with no location by line 0', () => {
    const unlocated = error({ file: '(no file)', line: 0, column: 0 });
    const { problems } = apply([unlocated], [record({ file: '(no file)', line: 0 })]);
    deepStrictEqual(problems, []);
    strictEqual(unlocated.failsRun, false);
  });

  it('fails a record for a later release than the last', () => {
    const { problems, removable } = apply([error()], [record({ lastRelease: '1.0.1' })]);
    deepStrictEqual(problems, [
      'the record for a src/a.ts:3 TS2322: the record is for the last release 1.0.1, which is later than the last release, 1.0.0.',
    ]);
    deepStrictEqual(removable, []);
  });

  it('treats a pre-release as earlier than its release', () => {
    const { removable } = apply([error()], [record({ lastRelease: '1.0.0-rc.3' })]);
    strictEqual(removable.length, 1);
  });
});

describe('main', () => {
  it('reports errors grouped by app and file, and exits with 1 when they fail', async () => {
    let out = '';
    const summary = join(work, 'summary.md');
    const code = await withLib(OPTIONAL_NAME, () =>
      main({
        root: checkout,
        args: ['--only', 'app'],
        env: { PATH: process.env.PATH, GITHUB_STEP_SUMMARY: summary },
        stdout: { write: (text) => (out += text) },
        stderr: { write: () => {} },
        findRelease: findRelease(),
      }),
    );
    strictEqual(code, 1);
    match(out, /^api:compat:examples: last release 1\.0\.0 \(tag v1\.0\.0\); an error fails/);
    match(out, /\napp: 1 error in 1 file \(recorded: 0 allowed, 0 breaks\); [\d.]+ s — FAILS\n/);
    match(out, /\n {2}src\/index\.ts: 1\n {4}src\/index\.ts\(5,14\): TS2322 /);
    const markdown = readFileSync(summary, 'utf8');
    match(markdown, /\n\| app \| 1 \| 0 \| 0 \| 1 \| 0 \|\n/);
    match(markdown, /\n### app\n\n- `src\/index\.ts`: 1\n {2}- 5:14 TS2322 /);
  });

  it('lists recorded deliberate breaks apart from recorded allowed changes', async () => {
    const report = await withLib(STRING_ID, () => check());
    const at = (line) => appResult(report).errors.find((each) => each.line === line);
    const allowed = recordFor(at(EXACT_LINE));
    const deliberate = recordFor(at(ID_LINE), { kind: 'break', reason: 'ids are strings now' });
    let out = '';
    const summary = join(work, 'summary-kinds.md');
    await withLib(STRING_ID, () =>
      withRecords([allowed, deliberate], () =>
        main({
          root: checkout,
          args: ['--only', 'app'],
          env: { PATH: process.env.PATH, GITHUB_STEP_SUMMARY: summary },
          stdout: { write: (text) => (out += text) },
          stderr: { write: () => {} },
          findRelease: findRelease(),
        }),
      ),
    );
    match(out, /\napp: 3 errors in 1 file \(recorded: 1 allowed, 1 break\); /);
    match(out, /src\/index\.ts\(9,\d+\): TS2322 .* \(recorded break: ids are strings now\)\n/);
    match(
      out,
      /src\/index\.ts\(5,\d+\): TS2322 .* \(recorded allowed change: rows may gain optional properties\)\n/,
    );
    match(
      out,
      /\nRecorded deliberate breaks:\n {2}app src\/index\.ts:9 TS2322 \(last release 1\.0\.0\): ids are strings now\n\nRecorded allowed changes:\n {2}app src\/index\.ts:5 TS2322 \(last release 1\.0\.0\): rows may gain optional properties\n/,
    );
    const markdown = readFileSync(summary, 'utf8');
    match(markdown, /\n\| App \| Errors \| Allowed \| Breaks \| Files \| Problems \|\n/);
    match(markdown, /\n\| app \| 3 \| 1 \| 1 \| 1 \| 0 \|\n/);
    match(
      markdown,
      /\nRecorded deliberate breaks:\n\n- app src\/index\.ts:9 TS2322 \(last release 1\.0\.0\): ids are strings now\n/,
    );
  });

  it('fails a release lookup with one line, not a stack trace', async () => {
    let err = '';
    const code = await main({
      root: checkout,
      args: [],
      env: {},
      stdout: { write: () => {} },
      stderr: { write: (text) => (err += text) },
      findRelease: async () => {
        throw new LastReleaseError(
          'origin has no release tag at or below 1.0.0, the version at HEAD',
        );
      },
    });
    strictEqual(code, 1);
    strictEqual(
      err,
      'api:compat:examples: origin has no release tag at or below 1.0.0, the version at HEAD\n',
    );
  });
});

describe('the message of an error', () => {
  it('is read without import("…") qualifiers, so a rebuild with new chunk names keeps its record', () => {
    const [error] = parseErrors(
      "src/a.ts(3,7): error TS2741: Property 'poolSize' is missing in type 'import(\"/repo/packages/x/dist/chunk-Cc33Dd44\").Options' but required in type 'Options'.",
    );
    strictEqual(
      error.message,
      "Property 'poolSize' is missing in type 'Options' but required in type 'Options'.",
    );
  });

  it('matches a record that holds it with its qualifiers', () => {
    const message = "Type 'import(\"/a/chunk-Ee55Ff66\").Row' is not assignable to type 'Row'.";
    const { problems } = applyRecords({
      results: [
        {
          app: 'a',
          errors: [
            {
              file: 'src/a.ts',
              line: 3,
              code: 'TS2322',
              message: "Type 'Row' is not assignable to type 'Row'.",
            },
          ],
        },
      ],
      records: [
        {
          app: 'a',
          file: 'src/a.ts',
          line: 3,
          code: 'TS2322',
          message,
          kind: 'allowed',
          lastRelease: '1.0.0',
          reason: 'r',
        },
      ],
      version: '1.0.0',
    });
    deepStrictEqual(problems, []);
  });
});

describe('the record printed for an error', () => {
  const report = {
    version: '1.0.0',
    tag: 'v1.0.0',
    results: [
      {
        app: 'demo',
        errors: [
          {
            file: 'src/a.ts',
            line: 3,
            column: 7,
            code: 'TS2322',
            message: 'Type <x> is wrong.',
            failsRun: true,
          },
          {
            file: 'src/b.ts',
            line: 1,
            column: 1,
            code: 'TS2344',
            message: 'Recorded.',
            recorded: { kind: 'allowed', reason: 'r' },
          },
        ],
        problems: [],
      },
    ],
    recorded: [],
    removable: [],
    problems: [],
  };
  const printed = {
    app: 'demo',
    file: 'src/a.ts',
    line: 3,
    code: 'TS2322',
    message: 'Type <x> is wrong.',
    kind: 'break',
    lastRelease: '1.0.0',
    reason: '…',
  };

  it('is not printed for errors a record cannot tell apart, which share a line and a message', () => {
    const same = { file: 'src/a.ts', line: 3, code: 'TS2322', message: 'Same.', failsRun: true };
    const text = reportText({
      ...report,
      results: [
        {
          app: 'demo',
          errors: [
            { ...same, column: 1 },
            { ...same, column: 9 },
          ],
          problems: [],
        },
      ],
    });
    strictEqual(text.includes('to record it'), false);
    match(text, /no record printed: 2 errors on this line have this message/);
  });

  it('is printed, ready to paste, under each unrecorded error, and not under a recorded one', () => {
    const text = reportText(report);
    strictEqual(text.split('to record it').length - 1, 1);
    strictEqual(text.includes(`\n      to record it: ${JSON.stringify(printed)}\n`), true);
  });

  it('is in the job summary as a JSON block', () => {
    strictEqual(
      reportMarkdown(report).includes(`\n\`\`\`json\n${JSON.stringify(printed)}\n\`\`\``),
      true,
    );
  });
});

describe('the job summary, when long', () => {
  it('stays within the bytes it is given', () => {
    const errors = Array.from({ length: 300 }, (_, line) => ({
      file: `src/f${line}.ts`,
      line,
      column: 1,
      code: 'TS2322',
      message: 'Type x.',
    }));
    const markdown = reportMarkdown(
      {
        version: '1.0.0',
        tag: 'v1.0.0',
        results: [{ app: 'a', errors, problems: [] }],
        recorded: [],
        removable: [],
        problems: [],
      },
      { maxBytes: 5000 },
    );
    strictEqual(Buffer.byteLength(markdown) <= 5000, true);
    match(markdown, /The rest is in the job log\.\n$/);
  });
});

describe('the job summary', () => {
  it('keeps text such as <string> in a message, so that one copied from it matches', () => {
    const markdown = reportMarkdown({
      version: '1.0.0',
      tag: 'v1.0.0',
      results: [
        {
          app: 'a',
          errors: [
            {
              file: 'src/a.ts',
              line: 1,
              column: 1,
              code: 'TS2322',
              message: 'Type Set<string> & X',
            },
          ],
          problems: [],
        },
      ],
      recorded: [],
      removable: [],
      problems: [],
    });
    match(markdown, /Type Set&lt;string> &amp; X/);
  });
});

describe('parseErrors, on a message of several lines', () => {
  it('keeps the lines that explain the first, so two errors that differ only there differ', () => {
    const [first, second] = parseErrors(
      [
        "src/a.ts(3,7): error TS2322: Type 'A' is not assignable to type 'B'.",
        "  The types of 'id' are incompatible.",
        "src/a.ts(3,7): error TS2322: Type 'A' is not assignable to type 'B'.",
        "  The types of 'name' are incompatible.",
      ].join('\n'),
    );
    strictEqual(first.message === second.message, false);
    match(first.message, /The types of 'id' are incompatible\.$/);
  });
});

describe('applyRecords, on an app whose check did not complete', () => {
  it('leaves its records alone', () => {
    const { problems } = applyRecords({
      results: [{ app: 'a', errors: [], problems: ['it has no node_modules; run pnpm install'] }],
      records: [
        {
          app: 'a',
          file: 'src/a.ts',
          line: 3,
          code: 'TS2322',
          message: 'm',
          kind: 'allowed',
          lastRelease: '1.0.0',
          reason: 'r',
        },
      ],
      version: '1.0.0',
    });
    deepStrictEqual(problems, []);
  });
});

describe('parseErrors', () => {
  it('reads plain and pretty errors, located or not, and ignores other output', () => {
    deepStrictEqual(
      parseErrors(
        [
          'src/a.ts(3,7): error TS2322: Type "x" is not assignable.',
          "  The types of 'id' are incompatible.",
          '\u001b[96msrc/b.ts\u001b[0m:\u001b[93m4\u001b[0m:\u001b[93m2\u001b[0m - \u001b[91merror\u001b[0m\u001b[90m TS2344: \u001b[0mType "y" does not satisfy.',
          'error TS6053: File "tsconfig.base.json" not found.',
          'generated 3 files',
        ].join('\n'),
      ),
      [
        {
          file: 'src/a.ts',
          line: 3,
          column: 7,
          code: 'TS2322',
          message: `Type "x" is not assignable. The types of 'id' are incompatible.`,
        },
        {
          file: 'src/b.ts',
          line: 4,
          column: 2,
          code: 'TS2344',
          message: 'Type "y" does not satisfy.',
        },
        {
          file: '(no file)',
          line: 0,
          column: 0,
          code: 'TS6053',
          message: 'File "tsconfig.base.json" not found.',
        },
      ],
    );
  });
});
