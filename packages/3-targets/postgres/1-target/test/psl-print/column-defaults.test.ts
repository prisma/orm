import { describe, expect, it } from 'vitest';
import {
  attributeText,
  type ColumnShape,
  INT_COLUMN,
  oneModel,
  TEXT_COLUMN,
} from './print-support';

describe('column defaults', () => {
  function defaultOf(column: ColumnShape): string | undefined {
    const model = oneModel(
      { id: INT_COLUMN, value: column },
      { id: { column: 'id' }, value: { column: 'value' } },
    );
    return model?.fields[1]?.attributes.map(attributeText)[0];
  }

  it('prints a string literal as a PSL string', () => {
    expect(defaultOf({ ...TEXT_COLUMN, default: { kind: 'literal', value: 'hello' } })).toBe(
      '@default("hello")',
    );
  });

  it('prints a decimal default as the text that keeps every digit', () => {
    expect(
      defaultOf({
        dataType: 'pg/numeric',
        codecId: 'pg/numeric@1',
        nullable: false,
        default: { kind: 'literal', value: '1.50' },
      }),
    ).toBe('@default(1.50)');
  });

  it.each([
    ['-0.500000000000000000000000000000', 'numeric(65, 30)', '-0.5', { precision: 65, scale: 30 }],
    ['10.000000000000000000000000000000', 'numeric(65, 30)', '10', { precision: 65, scale: 30 }],
    ['1.50', 'numeric(10, 2)', '1.5', { precision: 10, scale: 2 }],
  ])(
    'prints %s on %s as %s, the shortest number that reads back as it',
    (value, _type, written, typeParams) => {
      expect(
        defaultOf({
          dataType: 'pg/numeric',
          codecId: 'pg/numeric@1',
          nullable: false,
          typeParams,
          default: { kind: 'literal', value },
        }),
      ).toBe(`@default(${written})`);
    },
  );

  it.each([
    ['pg/money', 'pg/money@1', '-1234.50', '@default(-1234.5)'],
    ['pg/oid', 'pg/oid@1', 4294967295, '@default(4294967295)'],
    ['pg/xml', 'pg/xml@1', '<a>b</a>', '@default("<a>b</a>")'],
  ])(
    'prints a %s default as a literal its type casts from',
    (dataType, codecId, value, printed) => {
      expect(
        defaultOf({ dataType, codecId, nullable: false, default: { kind: 'literal', value } }),
      ).toBe(printed);
    },
  );

  it('prints an integer default unquoted', () => {
    expect(defaultOf({ ...INT_COLUMN, default: { kind: 'literal', value: 42 } })).toBe(
      '@default(42)',
    );
  });

  it('prints now() and autoincrement() by name', () => {
    expect(
      defaultOf({ ...INT_COLUMN, default: { kind: 'function', expression: 'autoincrement()' } }),
    ).toBe('@default(autoincrement())');
    expect(
      defaultOf({
        dataType: 'pg/timestamp',
        codecId: 'pg/timestamp-temporal@1',
        nullable: false,
        default: { kind: 'function', expression: 'now()' },
      }),
    ).toBe('@default(now())');
  });

  it('prints every other function default as a sql tagged literal', () => {
    expect(
      defaultOf({
        dataType: 'pg/uuid',
        codecId: 'pg/uuid@1',
        nullable: false,
        default: { kind: 'function', expression: 'gen_random_uuid()' },
      }),
    ).toBe('@default(sql`gen_random_uuid()`)');
  });

  it('refuses a literal default that cannot be written in PSL for the column type', () => {
    let thrown: unknown;
    try {
      defaultOf({
        dataType: 'pg/inet',
        codecId: 'pg/inet@1',
        nullable: false,
        default: { kind: 'literal', value: { a: 1 } },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      code: 'CONTRACT.PRINT_UNSUPPORTED',
      meta: { coordinate: '"public"."Widget"."value"', pslTypeName: 'Inet' },
    });
  });
});

describe('list columns', () => {
  it('prints nullable elements without inventing an element-not-null check', () => {
    const model = oneModel(
      { id: INT_COLUMN, tags: { ...TEXT_COLUMN, many: { elementNullable: true } } },
      { id: { column: 'id' }, tags: { column: 'tags' } },
    );
    expect(model?.fields.find((field) => field.name === 'tags')).toMatchObject({
      list: true,
      elementOptional: true,
      attributes: [],
    });
  });
});
