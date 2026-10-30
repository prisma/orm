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
    ['hello', '', { kind: 'literal', literal: { kind: 'value', body: 'hello' } }],
    ['42', '', { kind: 'literal', literal: { kind: 'value', body: '42' } }],
  ])('reads COLUMN_DEFAULT %j with EXTRA %j', (columnDefault, extra, expected) => {
    expect(readMysqlDefault(columnDefault, extra)).toEqual(expected);
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

  it('leaves every other default as it is', () => {
    const literal = { kind: 'literal', value: 'x' } as const;
    const autoincrement = { kind: 'function', expression: 'autoincrement()' } as const;
    expect([
      mysqlResolveDefault(literal, column),
      mysqlResolveDefault(autoincrement, column),
    ]).toEqual([literal, autoincrement]);
  });
});
