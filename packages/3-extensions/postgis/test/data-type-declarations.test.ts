import {
  instantiateAuthoringTypeConstructor,
  validateAuthoringHelperArguments,
} from '@internal/framework-components/authoring';
import {
  isSqlDataType,
  type ReportedSqlType,
  renderSqlCatalogText,
  renderSqlTypeName,
  resolveReportedSqlType,
  type SqlDataType,
  sqlBaseName,
} from '@internal/sql-contract/data-type';
import { describe, expect, it } from 'vitest';
import { postgisGeometryDescriptor } from '../src/core/codecs';
import { postgisPackMeta } from '../src/core/descriptor-meta';

const invalidParams = expect.objectContaining({ code: 'CONTRACT.TYPE_PARAMS_INVALID' });

function reported(text: string): ReportedSqlType {
  return { text, kind: undefined, schema: undefined, name: undefined };
}

function geometryType(): SqlDataType {
  const [type] = postgisPackMeta.dataTypes;
  if (type === undefined || !isSqlDataType(type)) {
    throw new Error('postgis registers no SQL data type');
  }
  return type;
}

describe('the postgis data type declaration', () => {
  it('registers exactly the data type design 2.6 declares', () => {
    expect(postgisPackMeta.dataTypes.map((type) => type.id)).toEqual(['postgis/geometry']);
  });

  it('is declared as design 2.6 says', () => {
    expect(geometryType().sql.texts).toEqual([
      { text: 'geometry', written: true, catalog: true },
      {
        text: 'geometry(geometry,{srid})',
        written: true,
        catalog: true,
        display: 'geometry(Geometry,{srid})',
      },
    ]);
    expect(geometryType().sql.claimsKind).toBeUndefined();
  });

  it.each([
    [{}, 'geometry'],
    [{ srid: 4326 }, 'geometry(Geometry,4326)'],
  ])('writes and reports %j as %s', (params, text) => {
    expect(renderSqlTypeName(geometryType(), params)).toBe(text);
    expect(renderSqlCatalogText(geometryType(), params)).toBe(text);
  });

  it('has the base name geometry', () => {
    expect(sqlBaseName(geometryType(), { srid: 4326 })).toBe('geometry');
  });

  it('reads a reported geometry back with its SRID', () => {
    const dataTypes = postgisPackMeta.dataTypes;
    expect(resolveReportedSqlType(reported('geometry'), dataTypes)).toEqual({
      dataType: 'postgis/geometry',
      typeParams: {},
    });
    expect(resolveReportedSqlType(reported('geometry(Geometry,4326)'), dataTypes)).toEqual({
      dataType: 'postgis/geometry',
      typeParams: { srid: 4326 },
    });
    expect(resolveReportedSqlType(reported('geometry(Point,4326)'), dataTypes)).toBeUndefined();
  });

  it('accepts an SRID of 1 or no SRID', () => {
    expect(renderSqlTypeName(geometryType(), { srid: 1 })).toBe('geometry(Geometry,1)');
    expect(renderSqlTypeName(geometryType(), {})).toBe('geometry');
  });

  it.each([[{ srid: 0 }], [{ srid: -1 }], [{ srid: 1.5 }]])('refuses %j', (params) => {
    expect(() => renderSqlTypeName(geometryType(), params)).toThrow(invalidParams);
  });

  it('normalizes to itself', () => {
    const { normalize } = geometryType().sql;
    expect(normalize(normalize({ srid: 4326 }))).toEqual({ srid: 4326 });
  });

  it('is the parameter schema of the geometry codec', () => {
    expect(postgisGeometryDescriptor.dataType).toBe(geometryType().id);
    expect(postgisGeometryDescriptor.paramsSchema).toBe(geometryType().params);
  });
});

describe('the postgis type constructor', () => {
  it('takes its SRID as an optional argument', () => {
    const geometryConstructor = postgisPackMeta.authoring.type.postgis.Geometry;
    expect(() =>
      validateAuthoringHelperArguments('postgis.Geometry', geometryConstructor.args, []),
    ).not.toThrow();
    expect(instantiateAuthoringTypeConstructor(geometryConstructor, [])).toEqual({
      codecId: 'pg/geometry@1',
    });
    expect(instantiateAuthoringTypeConstructor(geometryConstructor, [4326])).toEqual({
      codecId: 'pg/geometry@1',
      typeParams: { srid: 4326 },
    });
  });

  it('is the one contract infer prints for its data type', () => {
    expect(postgisPackMeta.authoring.type.postgis.Geometry).toHaveProperty('inferred', true);
  });
});
