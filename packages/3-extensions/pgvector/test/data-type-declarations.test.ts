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
import { pgVectorDescriptor } from '../src/core/codecs';
import { pgvectorPackMeta } from '../src/core/descriptor-meta';

const invalidParams = expect.objectContaining({ code: 'CONTRACT.TYPE_PARAMS_INVALID' });

function reported(text: string): ReportedSqlType {
  return { text, kind: undefined, schema: undefined, name: undefined };
}

function vectorType(): SqlDataType {
  const [type] = pgvectorPackMeta.dataTypes;
  if (type === undefined || !isSqlDataType(type)) {
    throw new Error('pgvector registers no SQL data type');
  }
  return type;
}

describe('the pgvector data type declaration', () => {
  it('registers exactly this data type', () => {
    expect(pgvectorPackMeta.dataTypes.map((type) => type.id)).toEqual(['pgvector/vector']);
  });

  it('declares its texts and claims no kind', () => {
    expect(vectorType().sql.texts).toEqual([
      { text: 'vector({length})', written: true, catalog: true },
    ]);
    expect(vectorType().sql.claimsKind).toBeUndefined();
  });

  it('writes and reports the length', () => {
    expect(renderSqlTypeName(vectorType(), { length: 1536 })).toBe('vector(1536)');
    expect(renderSqlCatalogText(vectorType(), { length: 1536 })).toBe('vector(1536)');
  });

  it('has the base name vector', () => {
    expect(sqlBaseName(vectorType(), { length: 3 })).toBe('vector');
    expect(sqlBaseName(vectorType(), {})).toBe('vector');
  });

  it('reads a reported vector back with its length', () => {
    const dataTypes = pgvectorPackMeta.dataTypes;
    expect(resolveReportedSqlType(reported('vector(1536)'), dataTypes)).toEqual({
      dataType: 'pgvector/vector',
      typeParams: { length: 1536 },
    });
    expect(resolveReportedSqlType(reported('VECTOR( 3 )'), dataTypes)).toEqual({
      dataType: 'pgvector/vector',
      typeParams: { length: 3 },
    });
    expect(resolveReportedSqlType(reported('vector'), dataTypes)).toBeUndefined();
    expect(resolveReportedSqlType(reported('vector(16001)'), dataTypes)).toBeUndefined();
  });

  it.each([[1], [16000]])('accepts a length of %s', (length) => {
    expect(renderSqlTypeName(vectorType(), { length })).toBe(`vector(${length})`);
  });

  it.each([[{ length: 0 }], [{ length: 16001 }], [{ length: 1.5 }], [{}]])(
    'refuses %j',
    (params) => {
      expect(() => renderSqlTypeName(vectorType(), params)).toThrow(invalidParams);
    },
  );

  it('normalizes to itself', () => {
    const { normalize } = vectorType().sql;
    expect(normalize(normalize({ length: 3 }))).toEqual({ length: 3 });
  });

  it('is the parameter schema of the vector codec', () => {
    expect(pgVectorDescriptor.dataType).toBe(vectorType().id);
    expect(pgVectorDescriptor.paramsSchema).toBe(vectorType().params);
  });
});

describe('the pgvector type constructor', () => {
  it('is the one contract infer prints for its data type', () => {
    expect(pgvectorPackMeta.authoring.type.pgvector.Vector).toHaveProperty('inferred', true);
  });
});
