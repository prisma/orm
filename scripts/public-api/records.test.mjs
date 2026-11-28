import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  byLastRelease,
  exportLabel,
  normaliseMessage,
  RECORD_KEYS,
  RecordsError,
  recordLine,
  validateRecords,
} from './records.mjs';

const breakRecord = {
  path: '.',
  export: 'Db',
  test: 'type',
  kind: 'break',
  lastRelease: '8.0.0',
  fingerprint: '0123456789abcdef',
  reason: 'Db takes a scope now',
};

describe('validateRecords', () => {
  it('accepts the records of each record file', () => {
    deepStrictEqual(validateRecords('breaks', [breakRecord], 'f'), [breakRecord]);
    const removed = { package: '@prisma/orm-x', lastRelease: '8.0.0', reason: 'merged' };
    deepStrictEqual(validateRecords('removedPackages', [removed], 'f'), [removed]);
    const app = {
      app: 'demo',
      file: 'src/a.ts',
      line: 0,
      code: 'TS2322',
      message: 'Type mismatch',
      kind: 'allowed',
      lastRelease: '8.0.0',
      reason: 'a new optional member',
    };
    deepStrictEqual(validateRecords('examples', [app], 'f'), [app]);
  });

  it('rejects a missing or unknown field, a wrong kind or test, a bad version or fingerprint, and a reason on two lines', () => {
    const { reason: _, ...withoutReason } = breakRecord;
    const { lastRelease, ...rest } = breakRecord;
    for (const record of [
      withoutReason,
      { ...breakRecord, message: 'x' },
      { ...rest, release: lastRelease },
      { ...breakRecord, kind: 'maybe' },
      { ...breakRecord, test: 'member' },
      { ...breakRecord, lastRelease: 'eight' },
      { ...breakRecord, fingerprint: 'abc' },
      { ...breakRecord, reason: '…' },
      { ...breakRecord, reason: 'one\ntwo' },
    ]) {
      throws(() => validateRecords('breaks', [record], 'f'), RecordsError);
    }
    throws(() => validateRecords('breaks', {}, 'f'), RecordsError);
  });

  it('names the fields in the order records are written', () => {
    deepStrictEqual(RECORD_KEYS.breaks, [
      'path',
      'export',
      'test',
      'kind',
      'lastRelease',
      'fingerprint',
      'reason',
    ]);
  });
});

describe('the reason of a record', () => {
  it('must be written: the placeholder of a printed record is rejected, with what to do', () => {
    throws(
      () => validateRecords('breaks', [{ ...breakRecord, reason: '…' }], 'f'),
      /reason must be one line of text that says why, in place of the … of a printed record/,
    );
  });
});

describe('byLastRelease', () => {
  it('keeps records of the last release, lists earlier ones as removable, and fails later ones', () => {
    const at = (lastRelease) => ({ ...breakRecord, lastRelease });
    deepStrictEqual(
      byLastRelease([at('8.0.0'), at('8.0.0-rc.3'), at('8.0.1')], '8.0.0', () => 'Db'),
      {
        current: [at('8.0.0')],
        removable: [at('8.0.0-rc.3')],
        problems: [
          'Db: the record is for the last release 8.0.1, which is later than the last release, 8.0.0.',
        ],
      },
    );
  });
});

describe('exportLabel', () => {
  it('writes an export as its package and import path, then its name', () => {
    deepStrictEqual(
      [exportLabel('@prisma/orm-x', '.', 'Db'), exportLabel('@prisma/orm-x', './builder', 'Db')],
      ['@prisma/orm-x: Db', '@prisma/orm-x/builder: Db'],
    );
  });
});

describe('recordLine', () => {
  it('writes the fields in the documented order', () => {
    const { reason, ...rest } = breakRecord;
    strictEqual(recordLine({ reason, ...rest }, 'breaks'), JSON.stringify(breakRecord));
  });
});

describe('normaliseMessage', () => {
  it('leaves out the qualifiers TypeScript prints under nodenext', () => {
    strictEqual(
      normaliseMessage(
        `Property 'b' is missing in type 'import("a/release/lib/index", { with: { "resolution-mode": "import" } }).Options' but required in type 'import("a/current/lib/index", { with: { "resolution-mode": "import" } }).Options'.`,
      ),
      "Property 'b' is missing in type 'Options' but required in type 'Options'.",
    );
  });

  it('leaves out import("…") qualifiers, which name files with build hashes', () => {
    strictEqual(
      normaliseMessage(
        'Type \'import("packages/x/dist/db-BEghLAxG").Options\' is not assignable to type \'import(".api-compat/x").Options\'.',
      ),
      "Type 'Options' is not assignable to type 'Options'.",
    );
  });
});
