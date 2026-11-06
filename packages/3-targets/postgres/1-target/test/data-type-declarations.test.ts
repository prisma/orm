import type { DataType } from '@internal/framework-components/codec';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import { isSqlDataType, type SqlTypeText, sqlRawDataType } from '@internal/sql-contract/data-type';
import { describe, expect, it } from 'vitest';
import { codecDescriptors } from '../src/core/codecs';
import { pgEnum } from '../src/core/data-types';
import { postgresTargetDescriptorMeta } from '../src/core/descriptor-meta';

const written = (text: string): SqlTypeText => ({ text, written: true });
const catalog = (text: string): SqlTypeText => ({ text, catalog: true });
const both = (text: string): SqlTypeText => ({ text, written: true, catalog: true });
const claimsOnly = (text: string): SqlTypeText => ({ text });

interface ExpectedDeclaration {
  readonly texts: readonly SqlTypeText[];
  readonly claimsKind?: string;
}

const ownName = (name: string): ExpectedDeclaration => ({ texts: [both(name)] });

const EXPECTED: Readonly<Record<string, ExpectedDeclaration>> = {
  'pg/text': ownName('text'),
  'pg/int2': { texts: [written('int2'), catalog('smallint')] },
  'pg/int4': { texts: [written('int4'), catalog('integer'), claimsOnly('int')] },
  'pg/int8': { texts: [written('int8'), catalog('bigint')] },
  'pg/float4': { texts: [written('float4'), catalog('real')] },
  'pg/float8': {
    texts: [written('float8'), catalog('double precision'), claimsOnly('float')],
  },
  'pg/bool': { texts: [written('bool'), catalog('boolean')] },
  'pg/numeric': {
    texts: [
      both('numeric'),
      written('numeric({precision})'),
      both('numeric({precision},{scale})'),
      claimsOnly('decimal'),
      claimsOnly('decimal({precision})'),
      claimsOnly('decimal({precision},{scale})'),
    ],
  },
  'pg/json': ownName('json'),
  'pg/jsonb': ownName('jsonb'),
  'pg/uuid': ownName('uuid'),
  'pg/inet': ownName('inet'),
  'pg/xml': ownName('xml'),
  'pg/oid': ownName('oid'),
  'pg/money': ownName('money'),
  'pg/bytea': ownName('bytea'),
  'pg/date': ownName('date'),
  'pg/tsquery': ownName('tsquery'),
  'pg/char': {
    texts: [
      written('character'),
      both('character({length})'),
      claimsOnly('char'),
      claimsOnly('char({length})'),
    ],
  },
  'pg/varchar': {
    texts: [
      both('character varying'),
      both('character varying({length})'),
      claimsOnly('varchar'),
      claimsOnly('varchar({length})'),
    ],
  },
  'pg/bit': { texts: [written('bit'), both('bit({length})')] },
  'pg/varbit': {
    texts: [
      both('bit varying'),
      both('bit varying({length})'),
      claimsOnly('varbit'),
      claimsOnly('varbit({length})'),
    ],
  },
  'pg/time': {
    texts: [
      written('time'),
      written('time({precision})'),
      catalog('time without time zone'),
      catalog('time({precision}) without time zone'),
    ],
  },
  'pg/timetz': {
    texts: [
      written('timetz'),
      written('timetz({precision})'),
      catalog('time with time zone'),
      catalog('time({precision}) with time zone'),
    ],
  },
  'pg/timestamp': {
    texts: [
      written('timestamp'),
      written('timestamp({precision})'),
      catalog('timestamp without time zone'),
      catalog('timestamp({precision}) without time zone'),
    ],
  },
  'pg/timestamptz': {
    texts: [
      written('timestamptz'),
      written('timestamptz({precision})'),
      catalog('timestamp with time zone'),
      catalog('timestamp({precision}) with time zone'),
    ],
  },
  'pg/interval': { texts: [both('interval'), both('interval({precision})')] },
  'pg/text-array': { texts: [] },
  'pg/enum': { texts: [], claimsKind: 'enum' },
  'sql/raw': { texts: [] },
};

const registered: readonly DataType[] = postgresTargetDescriptorMeta.dataTypes;

function declarationOf(type: DataType): ExpectedDeclaration {
  if (!isSqlDataType(type)) throw new Error(`${type.id} is not declared as a SQL data type`);
  return {
    texts: type.sql.texts,
    ...(type.sql.claimsKind === undefined ? {} : { claimsKind: type.sql.claimsKind }),
  };
}

describe('the Postgres data type declarations', () => {
  it.each(registered.map((type) => [type.id, type] as const))(
    '%s declares its texts and the kind it claims',
    (id, type) => {
      expect(EXPECTED).toHaveProperty([id]);
      expect(declarationOf(type)).toEqual(EXPECTED[id]);
    },
  );

  it('declares render only on the enum, which claims a kind, and on sql/raw, which declares no texts', () => {
    const rendering = registered.filter(
      (type) => isSqlDataType(type) && type.sql.render !== undefined,
    );
    expect(rendering.map((type) => type.id)).toEqual([pgEnum.id, sqlRawDataType.id]);
  });

  it('declares fromReported only on the enum, which claims a kind', () => {
    const reading = registered.filter(
      (type) => isSqlDataType(type) && type.sql.fromReported !== undefined,
    );
    expect(reading.map((type) => type.id)).toEqual([pgEnum.id]);
  });
});

describe('the parameter schema of every codec this target ships', () => {
  const dataTypes = createDataTypeLookup(registered);

  it.each(codecDescriptors.map((descriptor) => [descriptor.codecId, descriptor] as const))(
    '%s uses its data type’s parameter schema',
    (_codecId, descriptor) => {
      const type = dataTypes.get(descriptor.dataType);
      expect(type).toBeDefined();
      expect(descriptor.paramsSchema).toBe(type?.params);
      expect(descriptor.isParameterized).toBe(type?.params !== undefined);
    },
  );
});
