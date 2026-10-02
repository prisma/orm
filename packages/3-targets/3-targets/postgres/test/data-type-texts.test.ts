import type { DataType } from '@internal/framework-components/codec';
import {
  isSqlDataType,
  type ReportedSqlType,
  renderSqlCatalogText,
  renderSqlTypeName,
  resolveReportedSqlType,
  type SqlDataType,
  type SqlTypeParams,
  sqlBaseName,
} from '@internal/sql-contract/data-type';
import { InternalError } from '@internal/utils/internal-error';
import { describe, expect, it } from 'vitest';
import {
  pgBit,
  pgBool,
  pgBytea,
  pgChar,
  pgDate,
  pgEnum,
  pgFloat4,
  pgFloat8,
  pgInet,
  pgInt2,
  pgInt4,
  pgInt8,
  pgInterval,
  pgJson,
  pgJsonb,
  pgNumeric,
  pgText,
  pgTextArray,
  pgTime,
  pgTimestamp,
  pgTimestamptz,
  pgTimetz,
  pgTsquery,
  pgUuid,
  pgVarbit,
  pgVarchar,
  postgresDataTypes,
} from '../src/core/data-types';

const invalidParams = expect.objectContaining({ code: 'CONTRACT.TYPE_PARAMS_INVALID' });

function reported(text: string, rest: Partial<ReportedSqlType> = {}): ReportedSqlType {
  return { text, kind: undefined, schema: undefined, name: undefined, ...rest };
}

const resolve = (text: string) => resolveReportedSqlType(reported(text), postgresDataTypes);

function sqlTypeOf(type: DataType): SqlDataType {
  const declared = postgresDataTypes.find((candidate) => candidate.id === type.id);
  if (declared === undefined || !isSqlDataType(declared)) {
    throw new Error(`${type.id} is not a registered SQL data type`);
  }
  return declared;
}

/**
 * Inventory `data-types.md` section 1.3: what a migration writes for each parameter object today,
 * what the database reports for the column it creates, and the parameters that report reads as.
 */
const ROUND_TRIPS: ReadonlyArray<
  readonly [DataType, SqlTypeParams, string, string, SqlTypeParams]
> = [
  [pgText, {}, 'text', 'text', {}],
  [pgInt2, {}, 'int2', 'smallint', {}],
  [pgInt4, {}, 'int4', 'integer', {}],
  [pgInt8, {}, 'int8', 'bigint', {}],
  [pgFloat4, {}, 'float4', 'real', {}],
  [pgFloat8, {}, 'float8', 'double precision', {}],
  [pgBool, {}, 'bool', 'boolean', {}],
  [pgJson, {}, 'json', 'json', {}],
  [pgJsonb, {}, 'jsonb', 'jsonb', {}],
  [pgUuid, {}, 'uuid', 'uuid', {}],
  [pgInet, {}, 'inet', 'inet', {}],
  [pgBytea, {}, 'bytea', 'bytea', {}],
  [pgDate, {}, 'date', 'date', {}],
  [pgTsquery, {}, 'tsquery', 'tsquery', {}],
  [pgNumeric, {}, 'numeric', 'numeric', {}],
  [pgNumeric, { precision: 10 }, 'numeric(10)', 'numeric(10,0)', { precision: 10, scale: 0 }],
  [
    pgNumeric,
    { precision: 10, scale: 2 },
    'numeric(10,2)',
    'numeric(10,2)',
    { precision: 10, scale: 2 },
  ],
  [pgChar, {}, 'character', 'character(1)', { length: 1 }],
  [pgChar, { length: 5 }, 'character(5)', 'character(5)', { length: 5 }],
  [pgVarchar, {}, 'character varying', 'character varying', {}],
  [pgVarchar, { length: 255 }, 'character varying(255)', 'character varying(255)', { length: 255 }],
  [pgBit, {}, 'bit', 'bit(1)', { length: 1 }],
  [pgBit, { length: 8 }, 'bit(8)', 'bit(8)', { length: 8 }],
  [pgVarbit, {}, 'bit varying', 'bit varying', {}],
  [pgVarbit, { length: 8 }, 'bit varying(8)', 'bit varying(8)', { length: 8 }],
  [pgTime, {}, 'time', 'time without time zone', {}],
  [pgTime, { precision: 3 }, 'time(3)', 'time(3) without time zone', { precision: 3 }],
  [pgTimetz, {}, 'timetz', 'time with time zone', {}],
  [pgTimetz, { precision: 3 }, 'timetz(3)', 'time(3) with time zone', { precision: 3 }],
  [pgTimestamp, {}, 'timestamp', 'timestamp without time zone', {}],
  [
    pgTimestamp,
    { precision: 3 },
    'timestamp(3)',
    'timestamp(3) without time zone',
    { precision: 3 },
  ],
  [
    pgTimestamp,
    { precision: 0 },
    'timestamp(0)',
    'timestamp(0) without time zone',
    { precision: 0 },
  ],
  [pgTimestamptz, {}, 'timestamptz', 'timestamp with time zone', {}],
  [
    pgTimestamptz,
    { precision: 3 },
    'timestamptz(3)',
    'timestamp(3) with time zone',
    { precision: 3 },
  ],
  [pgInterval, {}, 'interval', 'interval', {}],
  [pgInterval, { precision: 3 }, 'interval(3)', 'interval(3)', { precision: 3 }],
];

const cases = ROUND_TRIPS.map(
  ([type, params, writtenText, reportedText, readsAs]) =>
    [type.id, JSON.stringify(params), type, params, writtenText, reportedText, readsAs] as const,
);

describe('Postgres data type texts, per inventory section 1.3', () => {
  it.each(cases)('%s %s is written as today', (_id, _p, type, params, writtenText) => {
    expect(renderSqlTypeName(sqlTypeOf(type), params)).toBe(writtenText);
  });

  it.each(cases)(
    '%s %s is reported as the database reports it',
    (_id, _p, type, params, _w, reportedText) => {
      expect(renderSqlCatalogText(sqlTypeOf(type), params)).toBe(reportedText);
    },
  );

  it.each(cases)(
    '%s %s reads back from its report',
    (_id, _p, type, _params, _w, reportedText, readsAs) => {
      expect(resolve(reportedText)).toEqual({ dataType: type.id, typeParams: readsAs });
    },
  );

  it('refuses a scale without a precision', () => {
    expect(() => renderSqlTypeName(sqlTypeOf(pgNumeric), { scale: 2 })).toThrow(invalidParams);
  });
});

describe('the enum, which claims a kind', () => {
  const enumType = sqlTypeOf(pgEnum);

  it('writes its type name quoted, part by part at the first dot', () => {
    expect(renderSqlTypeName(enumType, { typeName: 'Mood' })).toBe('"Mood"');
    expect(renderSqlTypeName(enumType, { typeName: 'app.status' })).toBe('"app"."status"');
    expect(renderSqlTypeName(enumType, { typeName: 'app.odd.name' })).toBe('"app"."odd.name"');
    expect(renderSqlTypeName(enumType, { typeName: 'say "hi"' })).toBe('"say ""hi"""');
  });

  it('reads a reported enum as its name, qualified outside public', () => {
    const inPublic = reported('mood', { kind: 'enum', schema: 'public', name: 'mood' });
    const elsewhere = reported('app.status', { kind: 'enum', schema: 'app', name: 'status' });
    expect(resolveReportedSqlType(inPublic, postgresDataTypes)).toEqual({
      dataType: 'pg/enum',
      typeParams: { typeName: 'mood' },
    });
    expect(resolveReportedSqlType(elsewhere, postgresDataTypes)).toEqual({
      dataType: 'pg/enum',
      typeParams: { typeName: 'app.status' },
    });
  });

  it('reads an enum reported with no schema as its unqualified name', () => {
    const noSchema = reported('mood', { kind: 'enum', schema: undefined, name: 'mood' });
    expect(resolveReportedSqlType(noSchema, postgresDataTypes)).toEqual({
      dataType: 'pg/enum',
      typeParams: { typeName: 'mood' },
    });
  });

  it('claims no other kind', () => {
    const domain = reported('int4', { kind: 'domain', schema: 'public', name: 'positive' });
    expect(resolveReportedSqlType(domain, postgresDataTypes)).toBeUndefined();
  });

  it('refuses a missing or empty type name', () => {
    expect(() => renderSqlTypeName(enumType, {})).toThrow(invalidParams);
    expect(() => renderSqlTypeName(enumType, { typeName: '' })).toThrow(invalidParams);
  });
});

describe('sqlBaseName', () => {
  it.each([
    [pgText, 'text'],
    [pgInt2, 'int2'],
    [pgInt4, 'int4'],
    [pgInt8, 'int8'],
    [pgFloat4, 'float4'],
    [pgFloat8, 'float8'],
    [pgBool, 'bool'],
    [pgNumeric, 'numeric'],
    [pgJson, 'json'],
    [pgJsonb, 'jsonb'],
    [pgUuid, 'uuid'],
    [pgInet, 'inet'],
    [pgBytea, 'bytea'],
    [pgDate, 'date'],
    [pgTsquery, 'tsquery'],
    [pgChar, 'character'],
    [pgVarchar, 'character varying'],
    [pgBit, 'bit'],
    [pgVarbit, 'bit varying'],
    [pgTime, 'time'],
    [pgTimetz, 'timetz'],
    [pgTimestamp, 'timestamp'],
    [pgTimestamptz, 'timestamptz'],
    [pgInterval, 'interval'],
  ] as const)('of %s is %s, whatever its parameters', (type, name) => {
    expect(sqlBaseName(sqlTypeOf(type), {})).toBe(name);
    expect(sqlBaseName(sqlTypeOf(type), { precision: 3, scale: 1, length: 5 })).toBe(name);
  });

  it('of the enum is its quoted type name', () => {
    expect(sqlBaseName(sqlTypeOf(pgEnum), { typeName: 'app.status' })).toBe('"app"."status"');
  });

  it('does not exist for the text array, which is never written', () => {
    expect(() => sqlBaseName(sqlTypeOf(pgTextArray), {})).toThrow(InternalError);
  });
});

/** Every claiming text of design 2.6, with a value for each placeholder and what it reads as. */
const CLAIMING_TEXTS: ReadonlyArray<readonly [string, string, SqlTypeParams]> = [
  ['text', 'pg/text', {}],
  ['smallint', 'pg/int2', {}],
  ['integer', 'pg/int4', {}],
  ['int', 'pg/int4', {}],
  ['bigint', 'pg/int8', {}],
  ['real', 'pg/float4', {}],
  ['double precision', 'pg/float8', {}],
  ['float', 'pg/float8', {}],
  ['boolean', 'pg/bool', {}],
  ['numeric', 'pg/numeric', {}],
  ['numeric(10,2)', 'pg/numeric', { precision: 10, scale: 2 }],
  ['decimal', 'pg/numeric', {}],
  ['decimal(10)', 'pg/numeric', { precision: 10, scale: 0 }],
  ['decimal(10,2)', 'pg/numeric', { precision: 10, scale: 2 }],
  ['json', 'pg/json', {}],
  ['jsonb', 'pg/jsonb', {}],
  ['uuid', 'pg/uuid', {}],
  ['inet', 'pg/inet', {}],
  ['bytea', 'pg/bytea', {}],
  ['date', 'pg/date', {}],
  ['tsquery', 'pg/tsquery', {}],
  ['character(5)', 'pg/char', { length: 5 }],
  ['char', 'pg/char', { length: 1 }],
  ['char(5)', 'pg/char', { length: 5 }],
  ['character varying', 'pg/varchar', {}],
  ['character varying(255)', 'pg/varchar', { length: 255 }],
  ['varchar', 'pg/varchar', {}],
  ['varchar(255)', 'pg/varchar', { length: 255 }],
  ['bit(8)', 'pg/bit', { length: 8 }],
  ['bit varying', 'pg/varbit', {}],
  ['bit varying(8)', 'pg/varbit', { length: 8 }],
  ['varbit', 'pg/varbit', {}],
  ['varbit(8)', 'pg/varbit', { length: 8 }],
  ['time without time zone', 'pg/time', {}],
  ['time(3) without time zone', 'pg/time', { precision: 3 }],
  ['time with time zone', 'pg/timetz', {}],
  ['time(3) with time zone', 'pg/timetz', { precision: 3 }],
  ['timestamp without time zone', 'pg/timestamp', {}],
  ['timestamp(3) without time zone', 'pg/timestamp', { precision: 3 }],
  ['timestamp with time zone', 'pg/timestamptz', {}],
  ['timestamp(3) with time zone', 'pg/timestamptz', { precision: 3 }],
  ['interval', 'pg/interval', {}],
  ['interval(3)', 'pg/interval', { precision: 3 }],
];

function spacedOut(text: string): string {
  return `  ${text.replaceAll(' ', '   ').replaceAll('(', '( ').replaceAll(',', ', ').replaceAll(')', ' )')} `;
}

describe('resolveReportedSqlType over the Postgres declarations', () => {
  it.each(CLAIMING_TEXTS)('claims %s as %s', (text, dataType, typeParams) => {
    expect(resolve(text)).toEqual({ dataType, typeParams });
  });

  it.each(CLAIMING_TEXTS)('claims %s in upper case', (text, dataType, typeParams) => {
    expect(resolve(text.toUpperCase())).toEqual({ dataType, typeParams });
  });

  it.each(CLAIMING_TEXTS)('claims %s with extra spaces', (text, dataType, typeParams) => {
    expect(resolve(spacedOut(text))).toEqual({ dataType, typeParams });
  });

  it.each([
    ['int2'],
    ['int4'],
    ['int8'],
    ['float4'],
    ['float8'],
    ['bool'],
    ['numeric(10)'],
    ['character'],
    ['bit'],
    ['time'],
    ['time(3)'],
    ['timetz'],
    ['timetz(3)'],
    ['timestamp'],
    ['timestamp(3)'],
    ['timestamptz'],
    ['timestamptz(3)'],
  ])('does not claim %s, which is only ever written', (text) => {
    expect(resolve(text)).toBeUndefined();
  });

  it.each([['"char"'], ['bpchar'], ['interval year to month'], ['text[]']])(
    'does not claim %s, which no data type declares',
    (text) => {
      expect(resolve(text)).toBeUndefined();
    },
  );
});

describe('normal forms', () => {
  it.each(cases)('%s %s normalizes once and for all', (_id, _p, type, params) => {
    const { normalize } = sqlTypeOf(type).sql;
    expect(normalize(normalize(params))).toEqual(normalize(params));
  });
});
