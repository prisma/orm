import { InternalError } from '@internal/utils/internal-error';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import {
  renderSqlCatalogText,
  renderSqlTypeName,
  sqlBaseName,
  sqlDataType,
  validateSqlTypeParams,
} from '../src/sql-data-type';
import {
  char,
  character,
  datetime,
  enumType,
  geometry,
  int4,
  numeric,
  textArray,
  timestamp,
  timestamptz,
  vector,
} from './sql-data-type-fixtures';

const invalidParams = expect.objectContaining({ code: 'CONTRACT.TYPE_PARAMS_INVALID' });

describe('validateSqlTypeParams', () => {
  it('returns parameters the data type accepts', () => {
    expect(validateSqlTypeParams(vector, { length: 3 })).toEqual({ length: 3 });
  });

  it('refuses parameters the data type does not accept, naming the parameter', () => {
    expect(() => validateSqlTypeParams(vector, { length: 0 })).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.TYPE_PARAMS_INVALID',
        meta: { dataType: 't/vector', parameters: ['length'] },
      }),
    );
  });
});

describe('sqlBaseName', () => {
  it('is what render gives for a type that renders', () => {
    expect(sqlBaseName(enumType, { typeName: 'app.status' })).toBe('"app"."status"');
  });

  it('is the written text with no placeholders', () => {
    expect(sqlBaseName(int4, {})).toBe('int4');
    expect(sqlBaseName(numeric, { precision: 10, scale: 2 })).toBe('numeric');
    expect(sqlBaseName(char, { length: 5 })).toBe('character');
    expect(sqlBaseName(timestamp, { precision: 3 })).toBe('timestamp');
  });

  it('is the written text with the fewest placeholders cut before its first bracket', () => {
    expect(sqlBaseName(vector, { length: 3 })).toBe('vector');
  });

  it('uses the display of the text it picks', () => {
    const displayed = sqlDataType('t/displayed', {
      read: (json) => json,
      texts: [{ text: 'geometry', written: true, display: 'Geometry' }],
    });
    expect(sqlBaseName(displayed, {})).toBe('Geometry');
  });

  it('refuses parameters the schema refuses for a type that renders', () => {
    expect(() => sqlBaseName(enumType, {})).toThrow(invalidParams);
    expect(() => sqlBaseName(enumType, {})).toThrow(/t\/enum.*typeName/);
  });

  it('refuses a type that is never written', () => {
    expect(() => sqlBaseName(textArray, {})).toThrow(InternalError);
    expect(() => sqlBaseName(textArray, {})).toThrow(/t\/text-array/);
  });
});

describe('renderSqlTypeName', () => {
  it('picks the written text whose placeholders are the given parameters', () => {
    expect(renderSqlTypeName(numeric, {})).toBe('numeric');
    expect(renderSqlTypeName(numeric, { precision: 10 })).toBe('numeric(10)');
    expect(renderSqlTypeName(numeric, { precision: 10, scale: 2 })).toBe('numeric(10,2)');
    expect(renderSqlTypeName(timestamp, { precision: 3 })).toBe('timestamp(3)');
    expect(renderSqlTypeName(vector, { length: 1536 })).toBe('vector(1536)');
  });

  it('writes the raw parameters, not the normal form', () => {
    expect(renderSqlTypeName(char, {})).toBe('character');
    expect(renderSqlTypeName(numeric, { precision: 10 })).toBe('numeric(10)');
  });

  it('drops the keys the normal form removes', () => {
    expect(renderSqlTypeName(character, { length: 36 })).toBe('character');
  });

  it('writes the display when the text has one', () => {
    expect(renderSqlTypeName(geometry, { srid: 4326 })).toBe('geometry(Geometry,4326)');
    expect(renderSqlTypeName(geometry, {})).toBe('geometry');
  });

  it('is what render gives for a type that renders', () => {
    expect(renderSqlTypeName(enumType, { typeName: 'status' })).toBe('"status"');
  });

  it('refuses parameters the schema refuses, naming the type and the parameter', () => {
    expect(() => renderSqlTypeName(numeric, { precision: 0 })).toThrow(invalidParams);
    expect(() => renderSqlTypeName(numeric, { precision: 0 })).toThrow(/t\/numeric/);
    expect(() => renderSqlTypeName(numeric, { precision: 0 })).toThrow(/precision/);
    expect(() => renderSqlTypeName(vector, {})).toThrow(/length/);
    expect(() => renderSqlTypeName(enumType, { typeName: '' })).toThrow(invalidParams);
  });

  it('refuses a parameter set no written text takes', () => {
    expect(() => renderSqlTypeName(numeric, { scale: 2 })).toThrow(invalidParams);
    expect(() => renderSqlTypeName(numeric, { scale: 2 })).toThrow(
      't/numeric cannot be written with parameters [scale]; it is written with [], [precision], [precision, scale]',
    );
  });

  it('refuses to write a type that is never written', () => {
    expect(() => renderSqlTypeName(textArray, {})).toThrow(invalidParams);
  });

  it('refuses a placeholder value that is not an integer, so nothing else is written into the name', () => {
    const labelled = sqlDataType('t/labelled', {
      read: (json) => json,
      params: type({ label: 'string' }),
      texts: [{ text: 'labelled({label})', written: true }],
    });
    expect(() => renderSqlTypeName(labelled, { label: '1); DROP TABLE users; --' })).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.TYPE_PARAMS_INVALID',
        meta: { dataType: 't/labelled', parameters: ['label'] },
      }),
    );
  });
});

describe('renderSqlCatalogText', () => {
  it('prints the catalog text for the normal form of the parameters', () => {
    expect(renderSqlCatalogText(numeric, { precision: 10 })).toBe('numeric(10,0)');
    expect(renderSqlCatalogText(numeric, { precision: 10, scale: 2 })).toBe('numeric(10,2)');
    expect(renderSqlCatalogText(numeric, {})).toBe('numeric');
    expect(renderSqlCatalogText(char, {})).toBe('character(1)');
    expect(renderSqlCatalogText(int4, {})).toBe('integer');
  });

  it('keeps a placeholder in the middle of the text', () => {
    expect(renderSqlCatalogText(timestamp, { precision: 3 })).toBe(
      'timestamp(3) without time zone',
    );
    expect(renderSqlCatalogText(timestamp, {})).toBe('timestamp without time zone');
  });

  it('prints the normal form of the parameters for a type that declares no catalog parameters', () => {
    expect([
      renderSqlCatalogText(datetime, { precision: 0 }),
      renderSqlCatalogText(datetime, {}),
      renderSqlCatalogText(datetime, { precision: 3 }),
    ]).toEqual(['datetime', 'datetime', 'datetime(3)']);
  });

  it('prints the parameters a type declares its catalog prints for those written', () => {
    expect([
      renderSqlCatalogText(timestamptz, {}),
      renderSqlCatalogText(timestamptz, { precision: 6 }),
      renderSqlCatalogText(timestamptz, { precision: 3 }),
    ]).toEqual([
      'timestamp with time zone',
      'timestamp(6) with time zone',
      'timestamp(3) with time zone',
    ]);
  });

  it('prints the display when the text has one', () => {
    expect(renderSqlCatalogText(geometry, { srid: 4326 })).toBe('geometry(Geometry,4326)');
  });

  it('refuses parameters the schema refuses', () => {
    expect(() => renderSqlCatalogText(timestamp, { precision: 7 })).toThrow(invalidParams);
  });

  it('refuses a parameter set no catalog text takes', () => {
    expect(() => renderSqlCatalogText(character, { length: 3 })).toThrow(invalidParams);
    expect(() => renderSqlCatalogText(character, {})).toThrow(/t\/character/);
  });

  it('is what render gives for a type whose name is its catalog text', () => {
    const named = sqlDataType<{ name: string }>('t/named', {
      read: (json) => json,
      params: type({ name: 'string' }),
      nameIsCatalogText: true,
      render: ({ name }) => name,
    });
    expect(renderSqlCatalogText(named, { name: 'circle' })).toBe('circle');
  });

  it('refuses a type that claims a kind, which has no catalog text', () => {
    expect(() => renderSqlCatalogText(enumType, { typeName: 'status' })).toThrow(InternalError);
  });
});
