import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  apiFingerprint,
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
  api: '0123456789abcdef',
  reason: 'Db takes a scope now',
};

describe('validateRecords', () => {
  it('accepts the three kinds of record with their fields', () => {
    deepStrictEqual(validateRecords('breaks', [breakRecord], 'f'), [breakRecord]);
    const removed = { package: '@prisma/orm-x', lastRelease: '8.0.0', reason: 'merged' };
    deepStrictEqual(validateRecords('removed', [removed], 'f'), [removed]);
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
      { ...breakRecord, api: 'abc' },
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
      'api',
      'reason',
    ]);
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

describe('apiFingerprint', () => {
  const api = [
    '# header',
    '.: interface Store',
    '.: interface Store, required method get(key: string): string',
    '.: interface Other',
    './sub: const a: string',
  ].join('\n');

  it('changes when a line of the export changes, members included, and not otherwise', () => {
    const fingerprint = apiFingerprint(api, '.', 'Store');
    strictEqual(/^[0-9a-f]{16}$/.test(fingerprint), true);
    strictEqual(
      apiFingerprint(api.replace('interface Other', 'interface Another'), '.', 'Store'),
      fingerprint,
    );
    strictEqual(
      apiFingerprint(api.replace('get(key: string)', 'get(key: "a")'), '.', 'Store') ===
        fingerprint,
      false,
    );
  });

  it('covers every line of a path for *', () => {
    strictEqual(apiFingerprint(api, './sub', '*') === apiFingerprint('', './sub', '*'), false);
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
  it('leaves out import("…") qualifiers, which name files with build hashes', () => {
    strictEqual(
      normaliseMessage(
        'Type \'import("packages/x/dist/db-BEghLAxG").Options\' is not assignable to type \'import(".api-compat/x").Options\'.',
      ),
      "Type 'Options' is not assignable to type 'Options'.",
    );
  });
});
