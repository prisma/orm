import { deepStrictEqual, match, rejects, strictEqual, throws } from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  failsRun,
  main,
  PackageSelectionError,
  planPackages,
  readRecords,
  removedPackageResults,
  reportMarkdown,
  reportText,
  selectPackages,
} from './api-compat.mjs';
import { REMOVED_FILE, RecordsError } from './records.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const work = join(here, '..', '..', 'wip', `api-compat-main-tests-${process.pid}`);
after(() => rmSync(work, { recursive: true, force: true }));

function packageWithRecords(text) {
  const dir = join(work, Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  if (text !== undefined) writeFileSync(join(dir, 'api-breaks.json'), text);
  return dir;
}

const record = {
  path: '.',
  export: 'Db',
  test: 'type',
  kind: 'break',
  lastRelease: '8.0.0',
  fingerprint: '0123456789abcdef',
  reason: 'Db takes a scope now',
};

describe('readRecords', () => {
  it('is empty without a records file', () => {
    deepStrictEqual(readRecords(packageWithRecords(undefined), work), []);
  });

  it('reads the records', () => {
    deepStrictEqual(readRecords(packageWithRecords(JSON.stringify([record])), work), [record]);
  });

  it('rejects a record records.mjs does not accept', () => {
    throws(
      () => readRecords(packageWithRecords(JSON.stringify([{ ...record, kind: 'maybe' }])), work),
      RecordsError,
    );
  });

  it('rejects a file that is not JSON', () => {
    throws(() => readRecords(packageWithRecords('['), work), RecordsError);
  });
});

const result = (overrides) => ({
  name: '@prisma/orm-a',
  counts: { paths: 2, exports: 10, forwarded: 3, notCompared: 1, tests: 8 },
  breaks: [],
  undecided: [],
  notCompared: [],
  recorded: [],
  removable: [],
  problems: [],
  ms: 1500,
  maxRssMb: 900,
  ...overrides,
});
const strictBreak = {
  path: '.',
  name: 'Db',
  test: 'type',
  message: "Property 'scope' is missing",
  failsRun: true,
};

describe('failsRun', () => {
  it('fails on a break or a problem, and not on a break in a name with a maturity level', () => {
    deepStrictEqual(
      [
        result({}),
        result({ breaks: [strictBreak] }),
        result({ breaks: [{ ...strictBreak, failsRun: false }] }),
        result({ undecided: [{ ...strictBreak, failsRun: undefined }] }),
        result({ problems: ['the recorded break is no longer a break'] }),
      ].map(failsRun),
      [false, true, false, false, true],
    );
  });
});

describe('the report', () => {
  const report = {
    version: '8.0.0',
    results: [
      result({
        breaks: [{ ...strictBreak, record: { path: '.', export: 'Db', test: 'type' } }],
        undecided: [
          { ...strictBreak, name: 'JsonObject', stage: 'native', message: 'excessively deep' },
        ],
        decidedByMembers: [{ path: '.', name: 'Shape', test: 'type' }],
        recorded: [
          { path: './x', name: '*', test: 'path', kind: 'break', reason: 'gone on purpose' },
          {
            path: '.',
            name: 'Row',
            test: 'type',
            kind: 'allowed',
            reason: 'a new optional member',
          },
        ],
        notCompared: [
          {
            path: '.',
            name: 'Only',
            test: 'type',
            reason: 'the last release has it as never or any',
          },
        ],
        removable: [{ path: '.', export: 'Gone', test: 'value', lastRelease: '7.9.0' }],
      }),
    ],
    notReleased: ['@prisma/orm-new'],
  };

  it('lists the counts, breaks, undecided and recorded of each package as text', () => {
    strictEqual(
      reportText(report),
      [
        'api:compat: last release 8.0.0; breaks fail unless recorded',
        '',
        '@prisma/orm-a: 10 exports on 2 paths; 8 comparisons, and 3 forwarded names checked only for existence (they are compared in the package that declares them); breaks 1, undecided 1, not compared 1, recorded 2; 1.5 s, 900 MB — FAILS',
        "  break  @prisma/orm-a: Db (type): Property 'scope' is missing",
        '    to record it: {"path":".","export":"Db","test":"type"}',
        '    the fingerprint is taken from the package’s api.txt as it is on disk: run pnpm build and pnpm api:update first, or it will not match',
        '  undecided (native)  @prisma/orm-a: JsonObject (type): excessively deep',
        '  decided member by member  @prisma/orm-a: Shape (type)',
        '  not compared  @prisma/orm-a: Only (type): the last release has it as never or any',
        '  recorded break  @prisma/orm-a/x: * (path): gone on purpose',
        '  recorded allowed change  @prisma/orm-a: Row (type): a new optional member',
        '  removable record  @prisma/orm-a: Gone (value): for the last release 7.9.0, earlier than this one',
        '',
        'Not checked, no release 8.0.0: @prisma/orm-new',
        '',
      ].join('\n'),
    );
  });

  it('prints one record for each test of an export, and the note of a break judged again', () => {
    const record = { path: '.', export: 'Shape', test: 'type' };
    const breaks = ['a', 'b'].map((member) => ({
      ...strictBreak,
      name: 'Shape',
      message: `${member}: changed`,
      record,
      note: 'a record for an earlier state of this export exists',
    }));
    const report = { version: '8.0.0', results: [result({ breaks })], notReleased: [] };
    strictEqual(reportText(report).split('to record it').length - 1, 1);
    match(
      reportText(report),
      /\n {4}the fingerprint is taken from the package’s api\.txt as it is on disk: run pnpm build and pnpm api:update first, or it will not match\n/,
    );
    match(reportMarkdown(report), /taken from the package’s `api\.txt` as it is on disk/);
    match(reportText(report), /\n {4}note: a record for an earlier state of this export exists\n/);
    strictEqual(reportMarkdown(report).split('"export":"Shape"').length - 1, 1);
  });

  it('names what is not compared across the package, such as a unique symbol', () => {
    const text = reportText({
      version: '8.0.0',
      results: [
        result({
          notCompared: [
            {
              path: '*',
              name: 'unique symbol @prisma/orm-a:brand',
              test: 'unique symbol',
              reason: 'two of them',
            },
          ],
        }),
      ],
      notReleased: [],
    });
    match(
      text,
      /\n {2}not compared {2}@prisma\/orm-a: unique symbol @prisma\/orm-a:brand \(unique symbol\): two of them\n/,
    );
  });

  it('gives a problem with the removed-package records a heading of its own', () => {
    const text = reportText({
      version: '8.0.0',
      results: [
        {
          name: REMOVED_FILE,
          recordsFile: true,
          problems: ['@prisma/orm-x: the package is still in the repository'],
        },
      ],
      notReleased: [],
    });
    match(
      text,
      /\npackages\/9-public\/removed-packages\.json: records of removed packages — FAILS\n {2}problem {2}@prisma\/orm-x/,
    );
  });

  it('writes the same as a table and lists for the job summary', () => {
    const markdown = reportMarkdown(report);
    match(markdown, /\| @prisma\/orm-a \| 8 \| 3 \| 1 \| 1 \| 1 \| 1 \| 1 \| 0 \|/);
    match(
      markdown,
      /- not compared: @prisma\/orm-a: Only \(type\): the last release has it as never or any/,
    );
    match(
      markdown,
      /- removable record: @prisma\/orm-a: Gone \(value\): for the last release 7\.9\.0, earlier than this one/,
    );
    match(
      markdown,
      /- undecided \(native\): @prisma\/orm-a: JsonObject \(type\): excessively deep/,
    );
    match(markdown, /- decided member by member: @prisma\/orm-a: Shape \(type\)/);
    match(markdown, /- break: @prisma\/orm-a: Db \(type\): Property 'scope' is missing/);
    match(markdown, /- recorded break: @prisma\/orm-a\/x: \* \(path\): gone on purpose/);
    match(
      markdown,
      /- recorded allowed change: @prisma\/orm-a: Row \(type\): a new optional member/,
    );
    match(markdown, /```json\n\{"path":"\.","export":"Db","test":"type"\}\n```/);
  });

  it('keeps the job summary within the bytes it is given, saying the rest is in the log', () => {
    const breaks = Array.from({ length: 200 }, (_, index) => ({
      ...strictBreak,
      name: `Export${index}`,
    }));
    const markdown = reportMarkdown(
      { version: '8.0.0', results: [result({ breaks })], notReleased: [] },
      { maxBytes: 4000 },
    );
    strictEqual(Buffer.byteLength(markdown) <= 4000, true);
    match(markdown, /The rest is in the job log\.\n$/);
  });

  it('fails breaks against a pre-release too, and marks a break in a name with a maturity level', () => {
    const prerelease = {
      version: '8.0.0-rc.25',
      results: [
        result({
          breaks: [strictBreak, { ...strictBreak, name: 'ea_search', failsRun: false }],
        }),
      ],
      notReleased: [],
    };
    const text = reportText(prerelease);
    match(text, /^api:compat: last release 8\.0\.0-rc\.25; breaks fail unless recorded\n/);
    match(text, /\n {2}break {2}@prisma\/orm-a: Db \(type\)/);
    match(
      text,
      /\n {2}break \(maturity level, does not fail\) {2}@prisma\/orm-a: ea_search \(type\)/,
    );
    const markdown = reportMarkdown(prerelease);
    match(
      markdown,
      /\nA break fails the job unless it is recorded in the package’s `api-breaks\.json`\.\n/,
    );
    match(
      markdown,
      /\n- break \(maturity level, does not fail\): @prisma\/orm-a: ea_search \(type\)/,
    );
    strictEqual(`${text}${markdown}`.includes('pre-release'), false);
  });

  it('keeps text such as <string> in the job summary', () => {
    const markdown = reportMarkdown({
      version: '8.0.0',
      results: [result({ breaks: [{ ...strictBreak, message: 'Type A<string> & B' }] })],
      notReleased: [],
    });
    match(markdown, /Type A&lt;string> &amp; B/);
  });
});

describe('selectPackages', () => {
  const packages = [{ name: '@prisma/orm-a' }, { name: '@prisma/orm-b' }];

  it('keeps the packages --only names, with or without the scope', () => {
    deepStrictEqual(selectPackages(packages, 'orm-b'), [{ name: '@prisma/orm-b' }]);
    deepStrictEqual(selectPackages(packages, '@prisma/orm-a,orm-b'), packages);
    deepStrictEqual(selectPackages(packages, undefined), packages);
  });

  it('fails on a name that matches no package', () => {
    throws(() => selectPackages(packages, 'orm-a,orm-typo'), PackageSelectionError);
  });
});

describe('planPackages', () => {
  it('checks the packages the release tag has, lists one the repository no longer has as removed, and fails on one missing from the registry', () => {
    const plan = planPackages({
      version: '8.0.0',
      atTag: ['@prisma/orm-a', '@prisma/orm-gone', '@prisma/orm-lagging'],
      inRepository: [
        { name: '@prisma/orm-a', dir: 'a' },
        { name: '@prisma/orm-lagging', dir: 'l' },
        { name: '@prisma/orm-new', dir: 'n' },
      ],
      onRegistry: new Set(['@prisma/orm-a']),
    });
    deepStrictEqual(plan, {
      check: [{ name: '@prisma/orm-a', dir: 'a' }],
      notReleased: ['@prisma/orm-new'],
      removed: ['@prisma/orm-gone'],
      problems: [
        {
          name: '@prisma/orm-lagging',
          problems: [
            'the release v8.0.0 has this package, but the registry has no version 8.0.0 of it; if it was published moments ago, the registry may not show it yet',
          ],
        },
      ],
    });
  });
});

describe('removedPackageResults', () => {
  const gone = { package: '@prisma/orm-gone', lastRelease: '8.0.0-rc.25', reason: 'merged' };
  const breaksOf = (outcome) => outcome.results.flatMap((each) => each.breaks);

  it('reports a removed package as a break that fails the run, against a pre-release too', () => {
    deepStrictEqual(
      breaksOf(
        removedPackageResults({
          removed: ['@prisma/orm-gone'],
          version: '8.0.0-rc.25',
          records: [],
        }),
      ).map(({ name, test, failsRun: fails }) => ({ name, test, failsRun: fails })),
      [{ name: '*', test: 'package', failsRun: true }],
    );
  });

  it('prints the record that would accept a removal', () => {
    const outcome = removedPackageResults({
      removed: ['@prisma/orm-gone'],
      version: '8.0.0-rc.25',
      records: [],
    });
    deepStrictEqual(outcome.results[0].breaks[0].record, {
      package: '@prisma/orm-gone',
      lastRelease: '8.0.0-rc.25',
      reason: '…',
    });
    const text = reportText({ version: '8.0.0-rc.25', results: outcome.results, notReleased: [] });
    match(
      text,
      /to record it in packages\/9-public\/removed-packages\.json: \{"package":"@prisma\/orm-gone"/,
    );
  });

  it('lists a recorded removal as recorded', () => {
    const outcome = removedPackageResults({
      removed: ['@prisma/orm-gone'],
      version: '8.0.0-rc.25',
      records: [gone],
    });
    deepStrictEqual(breaksOf(outcome), []);
    deepStrictEqual(
      outcome.results[0].recorded.map(({ reason }) => reason),
      ['merged'],
    );
    deepStrictEqual(outcome.problems, []);
  });

  it('fails on a record for a package the repository still has, and lists one for an earlier release as removable', () => {
    const outcome = removedPackageResults({
      removed: [],
      version: '8.0.0-rc.25',
      records: [gone, { ...gone, package: '@prisma/orm-old', lastRelease: '8.0.0-rc.1' }],
    });
    deepStrictEqual(outcome.problems, [
      '@prisma/orm-gone: the record is for a package the repository still has, or that was not released. Remove it.',
    ]);
    deepStrictEqual(
      outcome.removable.map(({ package: name }) => name),
      ['@prisma/orm-old'],
    );
  });
});

describe('main', () => {
  const root = join(here, '..', '..');
  const breakIn = (job) => ({
    name: job.name,
    counts: { paths: 1, exports: 1, forwarded: 0, tests: 1, notCompared: 0 },
    breaks: [{ path: '.', name: 'x', test: 'value', message: 'removed', failsRun: true }],
    undecided: [],
    notCompared: [],
    recorded: [],
    removable: [],
    problems: [],
    ms: 1,
    maxRssMb: 1,
  });
  const run = (args, version, more = {}) => {
    let out = '';
    let err = '';
    return main({
      root,
      args: ['--only', 'orm-framework', ...args],
      env: {},
      stdout: { write: (text) => (out += text) },
      stderr: { write: (text) => (err += text) },
      findRelease: async () => ({ version, tag: `v${version}` }),
      fetchTag: () => {},
      packagesAt: () => ['@prisma/orm-framework'],
      released: async () => true,
      install: () => {},
      check: async (jobs) => jobs.map(breakIn),
      ...more,
    }).then((code) => ({ code, out, err }));
  };

  it('fails a break against a pre-release', async () => {
    const { code, out } = await run([], '8.0.0-rc.25');
    strictEqual(code, 1);
    match(out, /^api:compat: last release 8\.0\.0-rc\.25; breaks fail unless recorded\n/);
    match(out, /\n {2}break {2}@prisma\/orm-framework: x \(value\): removed\n/);
  });

  it('has no --ga option', async () => {
    await rejects(run(['--ga'], '8.0.0-rc.25'), { code: 'ERR_PARSE_ARGS_UNKNOWN_OPTION' });
  });

  it('leaves the removed-package records alone under --only, which cannot tell what was removed', async () => {
    const gone = { package: '@prisma/orm-gone', lastRelease: '8.0.0-rc.25', reason: 'merged' };
    const { out } = await run([], '8.0.0-rc.25', { removedRecords: () => [gone] });
    strictEqual(out.includes('removed-packages.json'), false);
  });

  it('fails a break against a GA release', async () => {
    strictEqual((await run([], '8.0.0')).code, 1);
  });

  it('starts no more workers than there are packages', async () => {
    let workers;
    await run(['--jobs', '1000000000'], '8.0.0-rc.25', {
      check: async (jobs, count) => {
        workers = count;
        return [];
      },
    });
    strictEqual(workers, 1);
  });

  it('does not read the removed-package records under --only', async () => {
    const { code } = await run([], '8.0.0-rc.25', {
      removedRecords: () => {
        throw new RecordsError('packages/9-public/removed-packages.json: not JSON');
      },
      check: async () => [],
    });
    strictEqual(code, 0);
  });

  it('rejects --jobs that is not a positive whole number', async () => {
    for (const jobs of ['0', 'x', '1.5', '99999999999999999999']) {
      const { code, err } = await run(['--jobs', jobs], '8.0.0');
      strictEqual(code, 1);
      match(err, /--jobs must be a positive whole number/);
    }
  });
});
