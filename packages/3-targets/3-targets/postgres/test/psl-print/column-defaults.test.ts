import { describe, expect, it } from 'vitest';
import {
  attributeText,
  type ColumnShape,
  fieldText,
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
        nativeType: 'numeric',
        codecId: 'pg/numeric@1',
        nullable: false,
        default: { kind: 'literal', value: '1.50' },
      }),
    ).toBe('@default(1.50)');
  });

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
        nativeType: 'timestamp',
        codecId: 'pg/timestamp-temporal@1',
        nullable: false,
        default: { kind: 'function', expression: 'now()' },
      }),
    ).toBe('@default(now())');
  });

  it('prints every other function default as a sql tagged literal', () => {
    expect(
      defaultOf({
        nativeType: 'uuid',
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
        nativeType: 'inet',
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
  it('prints a waived element-not-null check as @noCheck(elementNotNull)', () => {
    const model = oneModel(
      { id: INT_COLUMN, tags: { ...TEXT_COLUMN, many: true, noCheck: ['elementNotNull'] } },
      { id: { column: 'id' }, tags: { column: 'tags' } },
    );
    expect(model?.fields.map(fieldText)).toEqual([
      'id Int @id',
      'tags String[] @noCheck(elementNotNull)',
    ]);
  });
});
