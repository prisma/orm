import { rawColumn } from '@internal/adapter-postgres/column-types';
import { describe, expect, it } from 'vitest';
import { defineContract, type ScalarFieldBuilder, sql } from '../../src/exports/contract-builder';

type Helpers = Parameters<NonNullable<Parameters<typeof defineContract>[1]>>[0];

function shapeColumn(
  build: (field: Helpers['field'], type: Helpers['type']) => ScalarFieldBuilder,
) {
  const contract = defineContract({}, ({ field, model, type, gen }) => ({
    models: {
      Shape: model('Shape', {
        fields: {
          id: field.column(type.Char(36)).id().onCreate(gen.uuid()),
          area: build(field, type),
        },
      }),
    },
  }));
  return contract.storage.namespaces['public']?.entries.table?.['Shape']?.columns['area'];
}

describe('type.Raw in the Postgres contract builder', () => {
  it('declares a raw column of a type whose name needs double quotes', () => {
    const quoted = { typeParams: { sql: '"MyType"[]' } };
    expect(shapeColumn((field, type) => field.column(type.Raw(sql`"MyType"[]`)))).toMatchObject(
      quoted,
    );
    expect(shapeColumn((field) => field.column(rawColumn(sql`"MyType"[]`)))).toMatchObject(quoted);
  });

  it('refuses a plain string from a caller TypeScript does not check', () => {
    const plainString: unknown = 'circle';
    expect(() => rawColumn(plainString as never)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ARGUMENT_INVALID',
        message: 'rawColumn(...) must be a sql`...` value.',
      }),
    );
    expect(() =>
      shapeColumn((field, type) => field.column(type.Raw(plainString as never))),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ARGUMENT_INVALID',
        message: 'Argument "sql" of Raw: Expected sql`...`; write sql`circle`',
      }),
    );
  });

  it('declares a raw column with the text as its sql parameter', () => {
    expect(shapeColumn((field, type) => field.column(type.Raw(sql`circle`)))).toEqual({
      codecId: 'sql/raw@1',
      dataType: 'sql/raw',
      typeParams: { sql: 'circle' },
      nullable: false,
      many: false,
    });
  });

  it('accepts a sql default', () => {
    expect(
      shapeColumn((field, type) =>
        field.column(type.Raw(sql`circle`)).default(sql`'<(0,0),1>'::circle`),
      )?.default,
    ).toEqual({ kind: 'function', expression: "'<(0,0),1>'::circle" });
  });

  it('refuses a literal default through the data type, saying to write sql', () => {
    expect(() =>
      shapeColumn((field, type) => field.column(type.Raw(sql`circle`)).default('<(0,0),1>')),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_INVALID',
        message:
          'Field "Shape.area" has a literal default. A raw column has no literal values, so its default cannot be a literal. Write the default as a SQL expression: sql`...`.',
        cause: expect.objectContaining({ code: 'CONTRACT.LITERAL_VALUES_ABSENT' }),
      }),
    );
  });

  it('refuses a raw type text that is not one type name, through type.Raw and rawColumn', () => {
    const notOneTypeName = expect.stringContaining('A raw type is one type name');
    expect(() => shapeColumn((field, type) => field.column(type.Raw(sql`text, "y" int4`)))).toThrow(
      expect.objectContaining({ code: 'CONTRACT.ARGUMENT_INVALID', message: notOneTypeName }),
    );
    expect(() =>
      shapeColumn((field) => field.column(rawColumn(sql`text; drop table "User"`))),
    ).toThrow(
      expect.objectContaining({ code: 'CONTRACT.TYPE_PARAMS_INVALID', message: notOneTypeName }),
    );
  });
});
