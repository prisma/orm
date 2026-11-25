import { deepStrictEqual, match, strictEqual, throws } from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  failsRun,
  PackageSelectionError,
  planPackages,
  RecordsError,
  readRecords,
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

const record = { path: '.', export: 'Db', release: '8.0.0', reason: 'Db takes a scope now' };

describe('readRecords', () => {
  it('is empty without a records file', () => {
    deepStrictEqual(readRecords(packageWithRecords(undefined), work), []);
  });

  it('reads the records', () => {
    deepStrictEqual(readRecords(packageWithRecords(JSON.stringify([record])), work), [record]);
  });

  it('rejects a record without a reason, or with a reason on two lines', () => {
    const { reason: _, ...withoutReason } = record;
    for (const records of [[withoutReason], [{ ...record, reason: 'one\ntwo' }]]) {
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
        undecided: [{ ...strictBreak, name: 'JsonObject', message: 'excessively deep' }],
        recorded: [{ path: './x', name: 'Old', reason: 'gone on purpose' }],
        notCompared: [
          {
            path: '.',
            name: 'Only',
            test: 'type',
            reason: 'the last release has it as never or any',
          },
        ],
        removable: [{ path: '.', export: 'Gone', release: '7.9.0' }],
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
        '  undecided  . JsonObject (type): excessively deep',
        '  not compared  . Only (type): the last release has it as never or any',
        '  recorded  ./x Old: gone on purpose',
        '  removable record  . Gone: for release 7.9.0, earlier than the last',
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
    match(markdown, /- removable record: `\.` `Gone`: for release 7\.9\.0, earlier than the last/);
    match(markdown, /- break: `\.` `Db` \(type\): Property 'scope' is missing/);
    match(markdown, /- recorded: `\.\/x` `Old`: gone on purpose/);
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
  it('checks the packages the release tag has, and fails on one missing from the repository or the registry', () => {
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
      problems: [
        {
          name: '@prisma/orm-gone',
          problems: ['the release v8.0.0 has this package, but the repository no longer does'],
        },
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
