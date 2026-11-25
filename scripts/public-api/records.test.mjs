import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  apiFingerprint,
  byLastRelease,
  exportLabel,
  fingerprintLines,
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

  it('takes in the lines of every declaration the export names, exported or not, followed further', () => {
    const lines = [
      '.: function configure(options: Options, mode: string): void',
      '.: type Options = Settings',
      '(not exported) interface Settings',
      '(not exported) interface Settings, readonly required property level: Level',
      './other: type Level = 1 | 2',
      '.: interface Unrelated',
    ];
    const base = apiFingerprint(lines.join('\n'), '.', 'configure');
    const changed = (from, to) =>
      apiFingerprint(lines.join('\n').replace(from, to), '.', 'configure') === base;
    deepStrictEqual(
      [
        changed('level: Level', 'level?: Level'),
        changed('Level = 1 | 2', 'Level = 1 | 2 | 3'),
        changed('interface Unrelated', 'interface Unrelated2'),
      ],
      [false, false, true],
    );
  });

  // Each case is a line of the export and a declaration it may reach; the declaration's lines change.
  const reaches = (exportLine, declaration, from, to) => {
    const lines = [exportLine, ...declaration].join('\n');
    return (
      apiFingerprint(lines, '.', 'use') !== apiFingerprint(lines.replace(from, to), '.', 'use')
    );
  };
  const declared = (name) => [
    `(not exported) interface ${name}`,
    `(not exported) interface ${name}, required property x: string`,
  ];

  it('does not follow a name that is not a type: a member or parameter name, a word in a string, a package, or a word api.txt writes', () => {
    deepStrictEqual(
      [
        reaches(
          '.: interface use, readonly required property table: string',
          declared('table'),
          'x: string',
          'x: number',
        ),
        reaches(
          '.: function use(table: string): void',
          declared('table'),
          'x: string',
          'x: number',
        ),
        reaches(
          '.: function use(options?: { table?: string }): void',
          declared('table'),
          'x: string',
          'x: number',
        ),
        reaches(
          ".: const use: { readonly family: 'sql' }",
          declared('sql'),
          'x: string',
          'x: number',
        ),
        reaches('.: const use: `prefix-sql`', declared('sql'), 'x: string', 'x: number'),
        reaches(
          '.: export use from @prisma/orm-framework/runtime',
          declared('orm'),
          'x: string',
          'x: number',
        ),
        reaches(
          '.: interface use, readonly optional property a?: string',
          declared('optional'),
          'x: string',
          'x: number',
        ),
        reaches(
          '.: interface use, required method get(key: string): void',
          declared('get'),
          'x: string',
          'x: number',
        ),
      ],
      [false, false, false, false, false, false, false, false],
    );
  });

  it('follows a type wherever it is named: a property’s type, a template literal part, a conditional type, a computed key', () => {
    deepStrictEqual(
      [
        reaches(
          '.: interface use, readonly required property table: Table',
          declared('Table'),
          'x: string',
          'x: number',
        ),
        reaches('.: type use = `prefix-${Prefix}`', declared('Prefix'), 'x: string', 'x: number'),
        reaches(
          '.: type use<T> = T extends string ? Yes : No',
          declared('No'),
          'x: string',
          'x: number',
        ),
        reaches(
          '.: interface use, readonly required property [BRAND]: true',
          declared('BRAND'),
          'x: string',
          'x: number',
        ),
        reaches(
          '.: function use(options: Options): void',
          declared('Options'),
          'x: string',
          'x: number',
        ),
      ],
      [true, true, true, true, true],
    );
  });

  it('follows a declaration exported only as default by its own name, and a package’s augmentation of its own interface', () => {
    deepStrictEqual(
      [
        reaches(
          '.: type use = ReturnType<typeof make>',
          ['./b: export default = function make(value: string): string'],
          'value: string',
          'value: number',
        ),
        reaches(
          '.: function use(registry: Registry): void',
          [
            '.: interface Registry',
            '.: augments @prisma/orm-x interface Registry, readonly required property extra: string',
          ],
          'extra: string',
          'extra: number',
        ),
      ],
      [true, true],
    );
  });

  it('takes in the export’s lines and those of the types they name, and no others', () => {
    deepStrictEqual(
      fingerprintLines(
        [
          '.: function use(table: Table): void',
          '.: interface Table',
          '.: interface Table, readonly required property sql: string',
          '.: function table(): void',
          '.: function sql(): void',
        ].join('\n'),
        '.',
        'use',
      ),
      [
        '.: function use(table: Table): void',
        '.: interface Table',
        '.: interface Table, readonly required property sql: string',
      ],
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
