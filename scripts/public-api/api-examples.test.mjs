import { deepStrictEqual, match, strictEqual } from 'node:assert/strict';
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
  ASIDE_FOLDER,
  checkExamples,
  failsRun,
  main,
  parseErrors,
  RECORDS_FILE,
} from './api-examples.mjs';
import { lastRelease } from './last-release.mjs';

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
    },
  });

function write(root, files) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

const ROW = 'export type Row = { id: number };\nexport declare function getRow(): Row;\n';
const PLANTED_ROW =
  'export type Row = { id: number; name?: string };\nexport declare function getRow(): Row;\n';
const ASSERTION_LINE = 4;
const appIndex = (extra = '') =>
  [
    "import { getRow } from 'lib';",
    "import { generated } from './generated';",
    'type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;',
    'export const exact: Equal<ReturnType<typeof getRow>, { id: number }> = true;',
    `export { generated };${extra}`,
    '',
  ].join('\n');

const app = (name) => ({
  [`examples/${name}/package.json`]: JSON.stringify({
    name,
    private: true,
    scripts: { typecheck: 'node gen.mjs && tsc --project tsconfig.json --noEmit' },
  }),
  [`examples/${name}/.gitignore`]: 'src/generated.ts\n',
  [`examples/${name}/gen.mjs`]:
    "import { writeFileSync } from 'node:fs';\nwriteFileSync('src/generated.ts', 'export const generated = 1;\\n');\n",
  [`examples/${name}/tsconfig.json`]: JSON.stringify({
    compilerOptions: {
      strict: true,
      module: 'esnext',
      moduleResolution: 'bundler',
      skipLibCheck: true,
      types: [],
    },
    include: ['src'],
  }),
  [`examples/${name}/src/index.ts`]: appIndex(),
});

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
    '.gitignore': 'node_modules\n/wip/\n',
    'packages/lib/package.json': JSON.stringify({ name: 'lib', types: 'index.d.ts' }),
    'packages/lib/index.d.ts': ROW,
    ...app('app'),
    ...app('removed'),
  });
  git(origin, 'add', '.');
  git(origin, 'commit', '--quiet', '-m', 'release');
  git(origin, 'tag', 'v1.0.0');
  rmSync(join(origin, 'examples', 'removed'), { recursive: true });
  write(origin, {
    'examples/app/src/index.ts': appIndex('\nexport const current = true;'),
    ...app('added'),
  });
  git(origin, 'add', '-A');
  git(origin, 'commit', '--quiet', '-m', 'after the release');
  git(work, 'clone', '--quiet', '--depth=1', '--no-tags', `file://${origin}`, checkout);
  for (const name of ['app', 'added']) linkNodeModules(join(checkout, 'examples', name));
});

const findRelease =
  (version = '1.0.0') =>
  () =>
    lastRelease({
      root: checkout,
      packument: async () => ({ 'dist-tags': { latest: version } }),
    });
const releaseAs = (version) => async () => ({ ...(await findRelease()()), version });

function withLib(text, run) {
  const file = join(checkout, 'packages', 'lib', 'index.d.ts');
  writeFileSync(file, text);
  return run().finally(() => writeFileSync(file, ROW));
}

function withRecords(records, run) {
  const file = join(checkout, RECORDS_FILE);
  writeFileSync(file, JSON.stringify(records));
  return run().finally(() => rmSync(file));
}

const record = {
  app: 'app',
  file: 'src/index.ts',
  line: ASSERTION_LINE,
  code: 'TS2322',
  release: '1.0.0',
  reason: 'rows may gain optional properties',
};

const appResult = (report) => report.results.find((result) => result.app === 'app');

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
  it('passes an app that compiles against the current build, after its step before', async () => {
    const report = await checkExamples({ root: checkout, ga: true, findRelease: findRelease() });
    deepStrictEqual(appResult(report).errors, []);
    deepStrictEqual(appResult(report).problems, []);
    strictEqual(failsRun(report), false);
  });

  it('compiles the app as it was at the tag, not as it is now', async () => {
    write(checkout, { 'examples/app/src/index.ts': `${appIndex()}const broken: number = 'x';\n` });
    try {
      const report = await checkExamples({ root: checkout, ga: true, findRelease: findRelease() });
      deepStrictEqual(appResult(report).errors, []);
    } finally {
      git(checkout, 'checkout', '--', 'examples/app/src/index.ts');
    }
  });

  it('fails on a changed result type once the release is GA', async () => {
    const report = await withLib(PLANTED_ROW, () =>
      checkExamples({ root: checkout, findRelease: findRelease() }),
    );
    deepStrictEqual(
      appResult(report).errors.map(({ file, line, code, failsRun: fails }) => ({
        file,
        line,
        code,
        fails,
      })),
      [{ file: 'src/index.ts', line: ASSERTION_LINE, code: 'TS2322', fails: true }],
    );
    strictEqual(failsRun(report), true);
  });

  it('reports a changed result type and passes before GA, and fails when forced to', async () => {
    await withLib(PLANTED_ROW, async () => {
      const prerelease = await checkExamples({
        root: checkout,
        findRelease: releaseAs('1.0.0-rc.1'),
      });
      strictEqual(appResult(prerelease).errors.length, 1);
      strictEqual(failsRun(prerelease), false);
      const forced = await checkExamples({
        root: checkout,
        ga: true,
        findRelease: releaseAs('1.0.0-rc.1'),
      });
      strictEqual(failsRun(forced), true);
    });
  });

  it('passes a recorded error', async () => {
    const report = await withLib(PLANTED_ROW, () =>
      withRecords([record], () => checkExamples({ root: checkout, findRelease: findRelease() })),
    );
    strictEqual(appResult(report).errors[0].recorded, record.reason);
    strictEqual(failsRun(report), false);
  });

  it('fails on a record that matches no error', async () => {
    const report = await withRecords([record], () =>
      checkExamples({ root: checkout, findRelease: findRelease() }),
    );
    deepStrictEqual(report.problems, [
      `the record for app src/index.ts:${ASSERTION_LINE} TS2322 matches no error. Remove it.`,
    ]);
    strictEqual(failsRun(report), true);
  });

  it('skips a record for an earlier release and lists it as removable', async () => {
    const stale = { ...record, release: '0.9.0' };
    const report = await withRecords([stale], () =>
      checkExamples({ root: checkout, findRelease: findRelease() }),
    );
    deepStrictEqual(report.removable, [stale]);
    deepStrictEqual(report.problems, []);
    strictEqual(failsRun(report), false);
  });

  it('skips an app that did not exist at the tag, or no longer exists', async () => {
    const report = await checkExamples({ root: checkout, findRelease: findRelease() });
    deepStrictEqual(
      report.results.map(({ app: name, skipped }) => ({ name, skipped })),
      [
        { name: 'added', skipped: 'it was added after the release' },
        { name: 'app', skipped: undefined },
        { name: 'removed', skipped: 'it was removed after the release' },
      ],
    );
  });

  it("puts the app's own files back after a failing run, ignored ones included", async () => {
    const appDir = join(checkout, 'examples', 'app');
    write(appDir, {
      'src/index.ts': appIndex('\n// changed and not committed'),
      'src/generated.ts': 'export const generated = 2;\n',
      'notes.txt': 'untracked\n',
    });
    try {
      const before = snapshot(appDir);
      const status = git(checkout, 'status', '--porcelain', '--ignored');
      const report = await withLib(PLANTED_ROW, () =>
        checkExamples({ root: checkout, findRelease: findRelease() }),
      );
      strictEqual(failsRun(report), true);
      deepStrictEqual(snapshot(appDir), before);
      strictEqual(git(checkout, 'status', '--porcelain', '--ignored'), status);
      strictEqual(existsSync(join(appDir, 'node_modules', 'lib', 'index.d.ts')), true);
      strictEqual(existsSync(join(checkout, ASIDE_FOLDER)), false);
    } finally {
      rmSync(join(appDir, 'notes.txt'), { force: true });
      git(checkout, 'checkout', '--', 'examples/app/src/index.ts');
    }
  });

  it('puts back the files a killed run left set aside', async () => {
    const appDir = join(checkout, 'examples', 'app');
    const before = snapshot(appDir);
    const aside = join(checkout, ASIDE_FOLDER, 'app');
    mkdirSync(aside, { recursive: true });
    for (const name of readdirSync(appDir)) {
      if (name !== 'node_modules') execFileSync('mv', [join(appDir, name), aside]);
    }
    write(appDir, { 'src/index.ts': 'the tag version\n' });
    const report = await checkExamples({ root: checkout, findRelease: findRelease() });
    deepStrictEqual(report.leftovers, ['app']);
    deepStrictEqual(snapshot(appDir), before);
  });
});

describe('main', () => {
  it('reports errors grouped by app and file, and exits with 1 when they fail', async () => {
    let out = '';
    const summary = join(work, 'summary.md');
    const code = await withLib(PLANTED_ROW, () =>
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
    match(out, /^api:examples: last release 1\.0\.0 \(tag v1\.0\.0\); an error fails/);
    match(out, /\napp: 1 errors in 1 files \(0 recorded\); [\d.]+ s — FAILS\n/);
    match(out, /\n {2}src\/index\.ts: 1\n {4}src\/index\.ts\(4,14\): TS2322 /);
    const markdown = readFileSync(summary, 'utf8');
    match(markdown, /\n\| app \| 1 \| 0 \| 1 \| 0 \|\n/);
    match(markdown, /\n### app\n\n- `src\/index\.ts`: 1\n {2}- 4:14 TS2322 /);
  });
});

describe('parseErrors', () => {
  it('reads located and unlocated errors and ignores other output', () => {
    deepStrictEqual(
      parseErrors(
        [
          'src/a.ts(3,7): error TS2322: Type "x" is not assignable.',
          "  The types of 'id' are incompatible.",
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
          message: 'Type "x" is not assignable.',
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
