import { deepStrictEqual, match, strictEqual, throws } from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  failsRun,
  main,
  PackageSelectionError,
  planPackages,
  RecordsError,
  readRecords,
  removedPackageResults,
  reportMarkdown,
  reportText,
  selectPackages,
} from './api-compat.mjs';

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
  lastRelease: '8.0.0',
  message: "Property 'scope' is missing",
  reason: 'Db takes a scope now',
};

describe('readRecords', () => {
  it('is empty without a records file', () => {
    deepStrictEqual(readRecords(packageWithRecords(undefined), work), []);
  });

  it('reads the records', () => {
    deepStrictEqual(readRecords(packageWithRecords(JSON.stringify([record])), work), [record]);
  });

  it('rejects a record without a reason, a test or a message, with a reason on two lines, an unknown test, a last release that is not a version, or the old release field', () => {
    const { reason: _, ...withoutReason } = record;
    const { test: __, ...withoutTest } = record;
    const { message: ___, ...withoutMessage } = record;
    const { lastRelease, ...rest } = record;
    for (const records of [
      [withoutReason],
      [withoutTest],
      [withoutMessage],
      [{ ...record, reason: 'one\ntwo' }],
      [{ ...record, test: 'member' }],
      [{ ...record, lastRelease: 'eight' }],
      [{ ...rest, release: lastRelease }],
    ]) {
      throws(() => readRecords(packageWithRecords(JSON.stringify(records)), work), RecordsError);
    }
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
  it('fails on a break that counts or a problem, and not on one that is only reported', () => {
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
        breaks: [strictBreak],
        undecided: [
          { ...strictBreak, name: 'JsonObject', stage: 'native', message: 'excessively deep' },
        ],
        decidedByMembers: [{ path: '.', name: 'Shape', test: 'type' }],
        recorded: [{ path: './x', name: 'Old', test: 'path', reason: 'gone on purpose' }],
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
        '@prisma/orm-a: 10 exports on 2 paths; 8 comparisons, and 3 forwarded names checked only for existence (they are compared in the package that declares them); breaks 1, undecided 1, not compared 1, recorded 1; 1.5 s, 900 MB — FAILS',
        "  break  . Db (type): Property 'scope' is missing",
        '  undecided (native)  . JsonObject (type): excessively deep',
        '  decided member by member  . Shape (type)',
        '  not compared  . Only (type): the last release has it as never or any',
        '  recorded  ./x Old (path): gone on purpose',
        '  removable record  . Gone (value): for the last release 7.9.0, earlier than this one',
        '',
        'Not checked, no release 8.0.0: @prisma/orm-new',
        '',
      ].join('\n'),
    );
  });

  it('writes the same as a table and lists for the job summary', () => {
    const markdown = reportMarkdown(report);
    match(markdown, /\| @prisma\/orm-a \| 8 \| 3 \| 1 \| 1 \| 1 \| 1 \| 0 \|/);
    match(
      markdown,
      /- not compared: `\.` `Only` \(type\): the last release has it as never or any/,
    );
    match(
      markdown,
      /- removable record: \. Gone \(value\): for the last release 7\.9\.0, earlier than this one/,
    );
    match(markdown, /- undecided \(native\): `\.` `JsonObject` \(type\): excessively deep/);
    match(markdown, /- decided member by member: `\.` `Shape` \(type\)/);
    match(markdown, /- break: `\.` `Db` \(type\): Property 'scope' is missing/);
    match(markdown, /- recorded: `\.\/x` `Old` \(path\): gone on purpose/);
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

  it('reports a removed package as a break that fails the run only once the release is GA', () => {
    for (const strict of [false, true]) {
      deepStrictEqual(
        breaksOf(
          removedPackageResults({
            removed: ['@prisma/orm-gone'],
            version: '8.0.0-rc.25',
            strict,
            records: [],
          }),
        ).map(({ name, test, failsRun: fails }) => ({ name, test, failsRun: fails })),
        [{ name: '*', test: 'package', failsRun: strict }],
      );
    }
  });

  it('lists a recorded removal as recorded', () => {
    const outcome = removedPackageResults({
      removed: ['@prisma/orm-gone'],
      version: '8.0.0-rc.25',
      strict: true,
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
      strict: true,
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
    breaks: [{ path: '.', name: 'x', test: 'value', message: 'removed', failsRun: job.strict }],
    undecided: [],
    notCompared: [],
    recorded: [],
    removable: [],
    problems: [],
    ms: 1,
    maxRssMb: 1,
  });
  const run = (args, version) => {
    let out = '';
    let err = '';
    const strictness = [];
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
      check: async (jobs) => jobs.map((job) => (strictness.push(job.strict), breakIn(job))),
    }).then((code) => ({ code, out, err, strictness }));
  };

  it('reports a break against a pre-release and exits 0, and fails it with --ga', async () => {
    const reported = await run([], '8.0.0-rc.25');
    deepStrictEqual([reported.code, reported.strictness], [0, [false]]);
    match(reported.out, /a pre-release, so breaks are reported and do not fail/);
    match(reported.out, /break \(reported only\) {2}\. x \(value\): removed/);
    const forced = await run(['--ga'], '8.0.0-rc.25');
    deepStrictEqual([forced.code, forced.strictness], [1, [true]]);
  });

  it('fails a break against a GA release', async () => {
    strictEqual((await run([], '8.0.0')).code, 1);
  });

  it('rejects --jobs that is not a positive whole number', async () => {
    for (const jobs of ['0', 'x', '1.5']) {
      const { code, err } = await run(['--jobs', jobs], '8.0.0');
      strictEqual(code, 1);
      match(err, /--jobs must be a positive whole number/);
    }
  });
});
