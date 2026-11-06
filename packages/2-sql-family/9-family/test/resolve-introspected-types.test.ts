import type { DataType } from '@internal/framework-components/codec';
import { sqlDataType } from '@internal/sql-contract/data-type';
import type { ReportedSqlType } from '@internal/sql-schema-ir/types';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { resolveIntrospectedColumnType } from '../src/core/resolve-introspected-types';

const text = sqlDataType('test/text', {
  read: (json) => json,
  texts: [{ text: 'text', written: true, catalog: true }],
});
const numeric = sqlDataType('test/numeric', {
  read: (json) => json,
  params: type({ 'precision?': 'number.integer >= 1', 'scale?': 'number.integer' }),
  texts: [
    { text: 'numeric', written: true, catalog: true },
    { text: 'numeric({precision})' },
    { text: 'numeric({precision},{scale})', written: true, catalog: true },
  ],
  normalize: (params) =>
    params.precision !== undefined && params.scale === undefined ? { ...params, scale: 0 } : params,
});
const enumType = sqlDataType('test/enum', {
  read: (json) => json,
  params: type({ typeName: 'string > 0' }),
  claimsKind: 'enum',
  render: ({ typeName }) => `"${typeName}"`,
  fromReported: (reported) => ({ typeName: reported.name ?? '' }),
});
const thing = sqlDataType('testext/thing', {
  read: (json) => json,
  params: type({ size: 'number.integer >= 1' }),
  texts: [{ text: 'thing({size})', written: true, catalog: true }],
});

const baseTypes: readonly DataType[] = [text, numeric, enumType];

const reported = (text: string, kind?: string): ReportedSqlType => ({
  text,
  kind,
  schema: 'public',
  name: text,
});

function resolved(reportedType: ReportedSqlType, dataTypes = baseTypes) {
  const { storedType, storedTypeParams } = resolveIntrospectedColumnType(reportedType, dataTypes);
  return { storedType: storedType?.id, storedTypeParams };
}

describe('resolveIntrospectedColumnType', () => {
  it('gives a base type its stored type and no parameters', () => {
    expect(resolved(reported('text'))).toEqual({ storedType: 'test/text', storedTypeParams: {} });
  });

  it('is stored as the type that claims it', () => {
    const { storedType } = resolveIntrospectedColumnType(reported('numeric(4,2)'), baseTypes);
    expect(storedType).toBe(numeric);
  });

  it('gives a parameterised type its parameters in normal form', () => {
    expect({
      short: resolved(reported('numeric(10)')),
      long: resolved(reported('NUMERIC(10, 0)')),
    }).toEqual({
      short: { storedType: 'test/numeric', storedTypeParams: { precision: 10, scale: 0 } },
      long: { storedType: 'test/numeric', storedTypeParams: { precision: 10, scale: 0 } },
    });
  });

  it('gives a type of a kind the parameters its claimant reads from the report', () => {
    expect(resolved(reported('mood', 'enum'))).toEqual({
      storedType: 'test/enum',
      storedTypeParams: { typeName: 'mood' },
    });
  });

  it('gives a type nothing claims no data type', () => {
    expect({
      domain: resolveIntrospectedColumnType(reported('positive', 'domain'), baseTypes),
      unknown: resolveIntrospectedColumnType(reported('hstore'), baseTypes),
    }).toEqual({ domain: {}, unknown: {} });
  });

  it('resolves an extension type only when its pack is in the stack', () => {
    expect({
      with: resolved(reported('thing(3)'), [...baseTypes, thing]),
      without: resolved(reported('thing(3)')),
    }).toEqual({
      with: { storedType: 'testext/thing', storedTypeParams: { size: 3 } },
      without: { storedType: undefined, storedTypeParams: undefined },
    });
  });
});
