import { deepStrictEqual, match, strictEqual, throws } from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { failsRun, RecordsError, readRecords, reportMarkdown, reportText } from './api-compat.mjs';

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
  recorded: [],
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
        '@prisma/orm-a: 8 tests over 6 exports on 2 paths (3 forwarded, checked in their own package); breaks 1, undecided 1, recorded 1; 1.5 s, 900 MB — FAILS',
        "  break  . Db (type): Property 'scope' is missing",
        '  undecided  . JsonObject (type): excessively deep',
        '  recorded  ./x Old: gone on purpose',
        '',
        'Not checked, no release 8.0.0: @prisma/orm-new',
        '',
      ].join('\n'),
    );
  });

  it('writes the same as a table and lists for the job summary', () => {
    const markdown = reportMarkdown(report);
    match(markdown, /\| @prisma\/orm-a \| 8 \| 1 \| 1 \| 1 \| 0 \|/);
    match(markdown, /- break: `\.` `Db` \(type\): Property 'scope' is missing/);
    match(markdown, /- recorded: `\.\/x` `Old`: gone on purpose/);
  });
});
