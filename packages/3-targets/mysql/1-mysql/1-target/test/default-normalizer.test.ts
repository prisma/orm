import { describe, expect, it } from 'vitest';
import { mysqlResolveDefault, readMysqlDefault } from '../src/core/default-normalizer';

const column = { typeText: 'datetime(3)', dataTypeId: 'mysql/datetime', many: false };

describe('readMysqlDefault', () => {
  it.each([
    [null, 'auto_increment', { kind: 'function', expression: 'autoincrement()' }],
    [null, '', undefined],
    ['CURRENT_TIMESTAMP(3)', 'DEFAULT_GENERATED', { kind: 'function', expression: 'now()' }],
    [
      'CURRENT_TIMESTAMP',
      'DEFAULT_GENERATED on update CURRENT_TIMESTAMP',
      { kind: 'function', expression: 'now()' },
    ],
    [
      "_utf8mb4\\'{}\\'",
      'DEFAULT_GENERATED',
      { kind: 'literal', literal: { kind: 'value', body: '{}' } },
    ],
    [
      "_utf8mb4\\'\\'",
      'DEFAULT_GENERATED',
      { kind: 'literal', literal: { kind: 'value', body: '' } },
    ],
    [
      "_utf8mb4\\'it\\\\\\'s\\'",
      'DEFAULT_GENERATED',
      { kind: 'literal', literal: { kind: 'value', body: "it's" } },
    ],
    [
      "_latin1\\'back\\\\\\\\slash, a\\\\nb and \\'\\'q\\'\\'\\'",
      'DEFAULT_GENERATED',
      { kind: 'literal', literal: { kind: 'value', body: "back\\slash, a\nb and 'q'" } },
    ],
    [
      "_utf8mb4\\'a\\' + _utf8mb4\\'b\\'",
      'DEFAULT_GENERATED',
      { kind: 'function', expression: "_utf8mb4\\'a\\' + _utf8mb4\\'b\\'" },
    ],
    [
      "concat(_utf8mb4\\'a\\')",
      'DEFAULT_GENERATED',
      { kind: 'function', expression: "concat(_utf8mb4\\'a\\')" },
    ],
    ['now(3)', 'DEFAULT_GENERATED', { kind: 'function', expression: 'now()' }],
    ['curdate()', 'DEFAULT_GENERATED', { kind: 'function', expression: 'CURRENT_DATE' }],
    ['CURRENT_DATE', 'DEFAULT_GENERATED', { kind: 'function', expression: 'CURRENT_DATE' }],
    ['curtime(6)', 'DEFAULT_GENERATED', { kind: 'function', expression: 'CURRENT_TIME' }],
    ['curtime()', 'DEFAULT_GENERATED', { kind: 'function', expression: 'CURRENT_TIME' }],
    [
      '0x00ff',
      'DEFAULT_GENERATED',
      { kind: 'literal', literal: { kind: 'value', body: new Uint8Array([0, 255]) } },
    ],
    [
      '0xC328',
      'DEFAULT_GENERATED',
      { kind: 'literal', literal: { kind: 'value', body: new Uint8Array([0xc3, 0x28]) } },
    ],
    ['0x0g', 'DEFAULT_GENERATED', { kind: 'function', expression: '0x0g' }],
    ['0x0', 'DEFAULT_GENERATED', { kind: 'function', expression: '0x0' }],
    ['hello', '', { kind: 'literal', literal: { kind: 'value', body: 'hello' } }],
    ['42', '', { kind: 'literal', literal: { kind: 'value', body: '42' } }],
  ])('reads COLUMN_DEFAULT %j with EXTRA %j', (columnDefault, extra, expected) => {
    expect(readMysqlDefault(columnDefault, extra, 'text')).toEqual(expected);
  });

  const bytes = (...values: number[]) => ({
    kind: 'literal',
    literal: { kind: 'value', body: new Uint8Array(values) },
  });
  const text = (body: string) => ({ kind: 'literal', literal: { kind: 'value', body } });
  const utf8 = (value: string) => [...Buffer.from(value, 'utf8')];
  const shownByteByByte = (value: string) => Buffer.from(value, 'utf8').toString('latin1');

  it.each<readonly [string, string, string, string, unknown]>([
    ['an empty bytes default MySQL reports', "X\\'\\'", 'DEFAULT_GENERATED', 'longblob', bytes()],
    ['a bytes default', '0x00ff', 'DEFAULT_GENERATED', 'longblob', bytes(0, 255)],
    ['an empty hexadecimal literal', '0x', 'DEFAULT_GENERATED', 'longblob', bytes()],
    [
      'a text default on a longblob, as its UTF-8 bytes',
      "_utf8mb4\\'abc\\'",
      'DEFAULT_GENERATED',
      'longblob',
      bytes(...utf8('abc')),
    ],
    [
      'a text default on a blob, with characters past ASCII, which MySQL reports byte by byte',
      shownByteByByte("_utf8mb4\\'é€😀\\'"),
      'DEFAULT_GENERATED',
      'blob',
      bytes(...utf8('é€😀')),
    ],
    [
      'a binary string default whose bytes are not UTF-8',
      `${shownByteByByte("_binary\\'")}\u00ff${shownByteByByte("\\'")}`,
      'DEFAULT_GENERATED',
      'longblob',
      bytes(255),
    ],
    [
      'a literal default on a varbinary, which MySQL cuts at its first zero byte, as reported',
      '0x61',
      '',
      'varbinary(8)',
      { kind: 'function', expression: '0x61' },
    ],
    [
      'a literal default of no bytes on a varbinary, which MySQL reports for 0x00ff, as reported',
      '0x',
      '',
      'varbinary(8)',
      { kind: 'function', expression: '0x' },
    ],
    [
      'a literal default on a binary(4), which may be cut at a zero byte, as reported',
      '0x61',
      '',
      'binary(4)',
      { kind: 'function', expression: '0x61' },
    ],
    [
      'an expression default on a binary(4), which MySQL reports whole, padded as a row is',
      '0x61',
      'DEFAULT_GENERATED',
      'binary(4)',
      bytes(0x61, 0, 0, 0),
    ],
    [
      'an expression default with a zero byte on a varbinary, which MySQL reports whole',
      '0x00ff',
      'DEFAULT_GENERATED',
      'varbinary(8)',
      bytes(0, 0xff),
    ],
    [
      'an empty text default on a text column',
      "_utf8mb4\\'\\'",
      'DEFAULT_GENERATED',
      'text',
      text(''),
    ],
    [
      'a text default with characters past ASCII, which MySQL reports byte by byte',
      shownByteByByte("_utf8mb4\\'é€😀\\'"),
      'DEFAULT_GENERATED',
      'text',
      text('é€😀'),
    ],
    [
      'a JSON default with characters past ASCII',
      shownByteByByte(`_utf8mb4\\'{"k":"é"}\\'`),
      'DEFAULT_GENERATED',
      'json',
      text('{"k":"é"}'),
    ],
    ...['null', '""', '[]', '{}'].map(
      (json) =>
        [
          `the JSON default ${json}`,
          `_utf8mb4\\'${json}\\'`,
          'DEFAULT_GENERATED',
          'json',
          text(json),
        ] as const,
    ),
    [
      'a text default in a character set the reader does not convert, as the expression it is',
      "_latin1\\'\u00e9\\'",
      'DEFAULT_GENERATED',
      'longblob',
      { kind: 'function', expression: "_latin1\\'\u00e9\\'" },
    ],
  ])('reads %s', (_case, columnDefault, extra, columnType, expected) => {
    expect(readMysqlDefault(columnDefault, extra, columnType)).toEqual(expected);
  });
});

describe('mysqlResolveDefault', () => {
  it('names an expression that writes the current time now()', () => {
    expect(
      mysqlResolveDefault({ kind: 'function', expression: 'CURRENT_TIMESTAMP(3)' }, column),
    ).toEqual({
      kind: 'function',
      expression: 'now()',
    });
  });

  it.each([
    ['mysql/datetime', 'now()'],
    ['mysql/timestamp', 'now()'],
    ['mysql/text', 'now()'],
    ['mysql/date', 'CURRENT_DATE'],
    ['mysql/time', 'CURRENT_TIME'],
  ])(
    'names a now() default on %s as the expression MySQL reads back, %s',
    (dataTypeId, expression) => {
      expect(
        mysqlResolveDefault(
          { kind: 'function', expression: 'now()' },
          { typeText: 'x', dataTypeId, many: false },
        ),
      ).toEqual({ kind: 'function', expression });
    },
  );

  it('names CURRENT_DATE and CURRENT_TIME as the database reports them, so a Date default differs from a DateTime one', () => {
    expect([
      mysqlResolveDefault({ kind: 'function', expression: 'curdate()' }, column),
      mysqlResolveDefault({ kind: 'function', expression: 'CURRENT_TIME(6)' }, column),
    ]).toEqual([
      { kind: 'function', expression: 'CURRENT_DATE' },
      { kind: 'function', expression: 'CURRENT_TIME' },
    ]);
  });

  it('leaves every other default as it is', () => {
    const literal = { kind: 'literal', value: 'x' } as const;
    const autoincrement = { kind: 'function', expression: 'autoincrement()' } as const;
    expect([
      mysqlResolveDefault(literal, column),
      mysqlResolveDefault(autoincrement, column),
    ]).toEqual([literal, autoincrement]);
  });
});
