import { InternalError } from '@internal/utils/internal-error';
import { describe, expect, it } from 'vitest';
import {
  findSqlDataTypeCollision,
  nameIsCatalogText,
  renderSqlCatalogText,
  renderSqlTypeName,
  resolveReportedSqlType,
  resolveWrittenSqlTypes,
  sqlBaseName,
  unquotedSqlBaseName,
} from '../src/sql-data-type';
import { SQL_RAW_DATA_TYPE_ID, sqlRawDataType } from '../src/sql-raw';
import { enumType, int4, numeric, timestamp, vector } from './sql-data-type-fixtures';

const invalidParams = expect.objectContaining({ code: 'CONTRACT.TYPE_PARAMS_INVALID' });

describe('the sql/raw data type', () => {
  it('is sql/raw', () => {
    expect(sqlRawDataType.id).toBe(SQL_RAW_DATA_TYPE_ID);
    expect(SQL_RAW_DATA_TYPE_ID).toBe('sql/raw');
  });

  it('writes, prints and names its type as its sql parameter, as given', () => {
    const params = { sql: 'character varying(10)' };
    expect([
      renderSqlTypeName(sqlRawDataType, params),
      renderSqlCatalogText(sqlRawDataType, params),
      unquotedSqlBaseName(sqlRawDataType, params),
    ]).toEqual(Array(3).fill('character varying(10)'));
  });

  it('has no base name, since its parameters cannot be separated from its name', () => {
    expect(() => sqlBaseName(sqlRawDataType, { sql: 'character varying(10)' })).toThrow(
      InternalError,
    );
  });

  it('keeps letter case and quotes in the text', () => {
    expect(renderSqlTypeName(sqlRawDataType, { sql: '"LTree"' })).toBe('"LTree"');
  });

  it('refuses a missing or non-string sql parameter', () => {
    expect(() => renderSqlTypeName(sqlRawDataType, {})).toThrow(invalidParams);
    expect(() => renderSqlTypeName(sqlRawDataType, { sql: 4 })).toThrow(invalidParams);
  });

  it.each([
    'tsvector',
    'ltree',
    'circle',
    'cidr',
    'hstore',
    'integer',
    'double precision',
    'character varying(10)',
    'bit varying(8)',
    'numeric(10,2)',
    'numeric(10, 2)',
    'geometry(Point,4326)',
    'timestamp(3) with time zone',
    'time without time zone',
    'int4range',
    '"LTree"',
    '"my,type"',
    '"my type"',
    'integer[]',
    'numeric(10,-2)',
    'app.email',
    '"App"."Email"',
    'app."Email"[]',
    '"Mood"[]',
    '"a""b"',
    'app."My""Type"[]',
  ])('takes the type text %s', (sql) => {
    expect(renderSqlTypeName(sqlRawDataType, { sql })).toBe(sql);
  });

  it.each([
    ['blank', ''],
    ['only spaces', '   '],
    ['a leading space', ' tsvector'],
    ['a trailing space', 'tsvector '],
    ['two spaces between words', 'double  precision'],
    ['a newline', 'text\nint4'],
    ['a semicolon', 'text; drop table "User"'],
    ['a line comment', 'text -- x'],
    ['a block comment', 'text /* x */'],
    ['dollar quoting', 'text default $$x$$'],
    ['tagged dollar quoting', '$a$x$a$'],
    ['single quotes hiding parentheses', `text CHECK ('(' <> ''), "y" int4 CHECK (')' <> '')`],
    ['a single-quoted default', "text DEFAULT 'x'"],
    ['a comma outside parentheses', 'text, "y" int4'],
    ['an unclosed parenthesis', 'numeric(10'],
    ['a parenthesis closed before it opens', 'numeric)10('],
    ['nested parentheses', 'int4 GENERATED ALWAYS AS (abs(1)) STORED'],
    ['two schemas', 'db.app.email'],
    ['a schema on a later word', 'double app.precision'],
    ['a schema with no type', 'app.'],
    ['two list suffixes', 'text[][]'],
    ['an empty quoted name', '""'],
    ['a lone double quote inside a quoted name', '"a"b"'],
    ['an operator', 'int4 CHECK (1 = 1)'],
    ['a minus sign before no digit', 'numeric(10,- 2)'],
    ['a minus sign outside parentheses', 'numeric-1'],
    ['a list suffix before the end', 'integer[] x'],
  ])('refuses a type text with %s, saying what a raw type is', (_name, sql) => {
    expect(() => renderSqlTypeName(sqlRawDataType, { sql })).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.TYPE_PARAMS_INVALID',
        message: expect.stringContaining(
          'A raw type is one type name as the database catalog prints it, such as tsvector, double precision, geometry(Point,4326), app.email or "MyType"[]: words of letters, digits and underscores separated by single spaces, or double-quoted names with each double quote inside doubled; the first optionally after one schema name and a dot; each optionally followed by parentheses holding only letters, digits, underscores, commas, spaces and a minus sign before a digit; and at most one trailing [].',
        ),
      }),
    );
  });

  it('claims no reported type and reads no written text', () => {
    const types = [sqlRawDataType];
    expect([
      resolveReportedSqlType(
        { text: 'tsvector', kind: undefined, schema: 'pg_catalog', name: 'tsvector' },
        types,
      ),
      resolveReportedSqlType({ text: 'mood', kind: 'enum', schema: 'public', name: 'mood' }, types),
      resolveWrittenSqlTypes('tsvector', types),
    ]).toEqual([undefined, undefined, []]);
  });

  it('has no literal values: its canonical form refuses every value, saying to write sql', () => {
    for (const value of ["'a':1", 1, true, { a: 1 }]) {
      expect(() => sqlRawDataType.toCanonicalForm?.(value)).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.LITERAL_VALUES_ABSENT',
          message:
            'A raw column has no literal values, so its default cannot be a literal. Write the default as a SQL expression: sql`...`.',
        }),
      );
    }
  });

  it('takes no value of another type through a cast', () => {
    expect([Object.keys(sqlRawDataType.casts), sqlRawDataType.listCast]).toEqual([[], undefined]);
  });

  it('collides with no other data type', () => {
    expect(
      findSqlDataTypeCollision([sqlRawDataType, int4, numeric, timestamp, vector, enumType]),
    ).toBeUndefined();
  });
});

describe('nameIsCatalogText', () => {
  it('holds for a type that declares it', () => {
    expect(nameIsCatalogText(sqlRawDataType)).toBe(true);
  });

  it('does not hold for a type with texts or one that claims a kind', () => {
    expect([nameIsCatalogText(int4), nameIsCatalogText(enumType)]).toEqual([false, false]);
  });
});
