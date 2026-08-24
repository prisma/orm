import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import {
  PG_BIT_CODEC_ID,
  PG_BOOL_CODEC_ID,
  PG_BYTEA_CODEC_ID,
  PG_CHAR_CODEC_ID,
  PG_ENUM_CODEC_ID,
  PG_FLOAT_CODEC_ID,
  PG_FLOAT4_CODEC_ID,
  PG_FLOAT8_CODEC_ID,
  PG_INT_CODEC_ID,
  PG_INT2_CODEC_ID,
  PG_INT4_CODEC_ID,
  PG_INT8_CODEC_ID,
  PG_INTERVAL_CODEC_ID,
  PG_JSON_CODEC_ID,
  PG_JSONB_CODEC_ID,
  PG_NUMERIC_CODEC_ID,
  PG_TEXT_ARRAY_CODEC_ID,
  PG_TEXT_CODEC_ID,
  PG_TIMETZ_CODEC_ID,
  PG_UUID_CODEC_ID,
  PG_VARBIT_CODEC_ID,
  PG_VARCHAR_CODEC_ID,
} from '../src/core/codec-ids';
import {
  pgBitColumn,
  pgBoolColumn,
  pgByteaColumn,
  pgByteaDescriptor,
  pgCharColumn,
  pgCharDescriptor,
  pgEnumDescriptor,
  pgFloat4Column,
  pgFloat8Column,
  pgFloatColumn,
  pgFloatDescriptor,
  pgInt2Column,
  pgInt4Column,
  pgInt8Column,
  pgIntColumn,
  pgIntDescriptor,
  pgIntervalColumn,
  pgJsonbColumn,
  pgJsonColumn,
  pgNumericColumn,
  pgTextArrayDescriptor,
  pgTextColumn,
  pgTimetzColumn,
  pgUuidColumn,
  pgVarbitColumn,
  pgVarcharColumn,
  pgVarcharDescriptor,
  postgresQualifyColumnType,
} from '../src/core/codecs';
import { DEFAULT_NAMESPACE_ID } from '../src/core/namespace-ids';
import { PostgresNativeEnum } from '../src/core/postgres-native-enum';

const instanceCtx = { name: '<test>' };
const callCtx = {};

describe('pg/enum@1 codec runtime', () => {
  const codec = pgEnumDescriptor.factory({ typeName: 'aal_level' })(instanceCtx);

  it('id proxies through the descriptor regardless of typeParams', () => {
    expect(codec.id).toBe(PG_ENUM_CODEC_ID);
  });

  it('encodes and decodes member values verbatim', async () => {
    expect(await codec.encode('aal1', callCtx)).toBe('aal1');
    expect(await codec.decode('aal1', callCtx)).toBe('aal1');
  });

  it('round-trips a member value through JSON identity', () => {
    expect(codec.encodeJson('aal2')).toBe('aal2');
    expect(codec.decodeJson('aal2')).toBe('aal2');
  });
});

describe('PgEnumDescriptor.columnFromEntity', () => {
  it('derives typeParams and nativeType from a PostgresNativeEnum entity', () => {
    const entity = new PostgresNativeEnum({ typeName: 'aal_level', members: ['aal1', 'aal2'] });
    expect(pgEnumDescriptor.columnFromEntity(entity)).toEqual({
      typeParams: { typeName: 'aal_level' },
      nativeType: 'aal_level',
    });
  });

  it('returns undefined for an entity that is not a PostgresNativeEnum', () => {
    expect(pgEnumDescriptor.columnFromEntity({ kind: 'table' })).toBeUndefined();
  });
});

describe('PgEnumDescriptor.qualifyNativeType', () => {
  it('leaves the type name bare for the default (public) namespace', () => {
    expect(pgEnumDescriptor.qualifyNativeType('aal_level', DEFAULT_NAMESPACE_ID)).toBe('aal_level');
  });

  it('leaves the type name bare for the unbound namespace', () => {
    expect(pgEnumDescriptor.qualifyNativeType('aal_level', UNBOUND_NAMESPACE_ID)).toBe('aal_level');
  });

  it('schema-qualifies the type name for a named namespace', () => {
    expect(pgEnumDescriptor.qualifyNativeType('aal_level', 'auth')).toBe('auth.aal_level');
  });
});

describe('postgresQualifyColumnType', () => {
  it('passes non-enum columns through unchanged', () => {
    const input = { codecId: PG_TEXT_CODEC_ID, nativeType: 'text' };
    expect(postgresQualifyColumnType(input, 'auth')).toBe(input);
  });

  it('passes an enum column through unchanged when typeParams.typeName is missing', () => {
    const input = { codecId: PG_ENUM_CODEC_ID, nativeType: 'aal_level' };
    expect(postgresQualifyColumnType(input, 'auth')).toBe(input);
  });

  it('passes an enum column through unchanged when typeName is not a string', () => {
    const input = {
      codecId: PG_ENUM_CODEC_ID,
      nativeType: 'aal_level',
      typeParams: { typeName: 42 },
    };
    expect(postgresQualifyColumnType(input, 'auth')).toBe(input);
  });

  it('schema-qualifies an enum column nativeType and typeParams.typeName for a named namespace', () => {
    const input = {
      codecId: PG_ENUM_CODEC_ID,
      nativeType: 'aal_level',
      typeParams: { typeName: 'aal_level' },
    };
    expect(postgresQualifyColumnType(input, 'auth')).toEqual({
      nativeType: 'auth.aal_level',
      typeParams: { typeName: 'auth.aal_level' },
    });
  });

  it('keeps the nativeType bare for the default namespace', () => {
    const input = {
      codecId: PG_ENUM_CODEC_ID,
      nativeType: 'aal_level',
      typeParams: { typeName: 'aal_level' },
    };
    expect(postgresQualifyColumnType(input, DEFAULT_NAMESPACE_ID)).toEqual({
      nativeType: 'aal_level',
      typeParams: { typeName: 'aal_level' },
    });
  });
});

describe('pg/bytea@1 codec runtime (direct instantiation)', () => {
  const codec = pgByteaDescriptor.factory()(instanceCtx);

  it('id proxies through the descriptor', () => {
    expect(codec.id).toBe(PG_BYTEA_CODEC_ID);
  });

  it('round-trips a Uint8Array payload verbatim', async () => {
    const input = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    expect(await codec.encode(input, callCtx)).toBe(input);
    expect(await codec.decode(input, callCtx)).toBe(input);
  });

  it('normalizes a Buffer wire value to a plain Uint8Array view', async () => {
    const buffer = Buffer.from([0x09, 0x08, 0x07]);
    const decoded = await codec.decode(buffer, callCtx);
    expect(decoded).toBeInstanceOf(Uint8Array);
    expect(decoded.constructor).toBe(Uint8Array);
    expect(Array.from(decoded)).toEqual([0x09, 0x08, 0x07]);
  });

  it('round-trips a payload through encodeJson / decodeJson', () => {
    const input = new Uint8Array([0xca, 0xfe]);
    const json = codec.encodeJson(input);
    expect(json).toBe('yv4=');
    expect(Array.from(codec.decodeJson(json))).toEqual([0xca, 0xfe]);
  });
});

describe('pg/text-array@1 codec', () => {
  const codec = pgTextArrayDescriptor.factory()(instanceCtx);

  it('id proxies through the descriptor', () => {
    expect(codec.id).toBe(PG_TEXT_ARRAY_CODEC_ID);
  });

  it('exposes equality-only traits and the text[] target/native types', () => {
    expect(pgTextArrayDescriptor.traits).toEqual(['equality']);
    expect(pgTextArrayDescriptor.targetTypes).toEqual(['text[]']);
    expect(pgTextArrayDescriptor.nativeTypeFor({ codecId: pgTextArrayDescriptor.codecId })).toBe(
      'text[]',
    );
  });

  it('round-trips a string array verbatim', async () => {
    const input = ['a', 'b', 'c'];
    expect(await codec.encode(input, callCtx)).toBe(input);
    expect(await codec.decode(input, callCtx)).toBe(input);
  });

  it('encodeJson produces a plain array copy', () => {
    const input = ['x', 'y'];
    const json = codec.encodeJson(input);
    expect(json).toEqual(['x', 'y']);
    expect(json).not.toBe(input);
  });

  it('decodeJson stringifies non-string array entries', () => {
    expect(codec.decodeJson(['a', 1, true])).toEqual(['a', '1', 'true']);
  });

  it('decodeJson returns an empty array for a non-array JSON value', () => {
    expect(codec.decodeJson('not-an-array')).toEqual([]);
    expect(codec.decodeJson(null)).toEqual([]);
  });
});

describe('renderValueLiteral for the SQL-aliased descriptors', () => {
  it('pg/char@1 renders a quoted string literal', () => {
    expect(pgCharDescriptor.renderValueLiteral?.('A')).toBe('"A"');
  });

  it('pg/varchar@1 renders a quoted string literal', () => {
    expect(pgVarcharDescriptor.renderValueLiteral?.('hello')).toBe('"hello"');
  });

  it('pg/int@1 renders a numeric literal', () => {
    expect(pgIntDescriptor.renderValueLiteral?.(5)).toBe('5');
  });

  it('pg/float@1 renders a numeric literal', () => {
    expect(pgFloatDescriptor.renderValueLiteral?.(3.5)).toBe('3.5');
  });
});

describe('column helpers', () => {
  it('pgBitColumn packages a ColumnSpec for pg/bit@1', () => {
    const spec = pgBitColumn({ length: 8 });
    expect(spec.codecId).toBe(PG_BIT_CODEC_ID);
    expect(spec.nativeType).toBe('bit');
    expect(spec.typeParams).toEqual({ length: 8 });
    expect(spec.codecFactory(instanceCtx).id).toBe(PG_BIT_CODEC_ID);
  });

  it('pgBitColumn defaults typeParams to {} when called with no args', () => {
    const spec = pgBitColumn();
    expect(spec.typeParams).toEqual({});
  });

  it('pgBoolColumn packages a ColumnSpec for pg/bool@1', () => {
    const spec = pgBoolColumn();
    expect(spec.codecId).toBe(PG_BOOL_CODEC_ID);
    expect(spec.nativeType).toBe('bool');
    expect(spec.typeParams).toBeUndefined();
    expect(spec.codecFactory(instanceCtx).id).toBe(PG_BOOL_CODEC_ID);
  });

  it('pgByteaColumn packages a ColumnSpec for pg/bytea@1', () => {
    const spec = pgByteaColumn();
    expect(spec.codecId).toBe(PG_BYTEA_CODEC_ID);
    expect(spec.nativeType).toBe('bytea');
    expect(spec.codecFactory(instanceCtx).id).toBe(PG_BYTEA_CODEC_ID);
  });

  it('pgCharColumn packages a ColumnSpec for pg/char@1', () => {
    const spec = pgCharColumn({ length: 10 });
    expect(spec.codecId).toBe(PG_CHAR_CODEC_ID);
    expect(spec.nativeType).toBe('character');
    expect(spec.typeParams).toEqual({ length: 10 });
    expect(spec.codecFactory(instanceCtx).id).toBe(PG_CHAR_CODEC_ID);
  });

  it('pgFloat4Column packages a ColumnSpec for pg/float4@1', () => {
    const spec = pgFloat4Column();
    expect(spec.codecId).toBe(PG_FLOAT4_CODEC_ID);
    expect(spec.nativeType).toBe('float4');
    expect(spec.codecFactory(instanceCtx).id).toBe(PG_FLOAT4_CODEC_ID);
  });

  it('pgFloat8Column packages a ColumnSpec for pg/float8@1', () => {
    const spec = pgFloat8Column();
    expect(spec.codecId).toBe(PG_FLOAT8_CODEC_ID);
    expect(spec.nativeType).toBe('float8');
    expect(spec.codecFactory(instanceCtx).id).toBe(PG_FLOAT8_CODEC_ID);
  });

  it('pgFloatColumn packages a ColumnSpec for pg/float@1', () => {
    const spec = pgFloatColumn();
    expect(spec.codecId).toBe(PG_FLOAT_CODEC_ID);
    expect(spec.nativeType).toBe('float8');
    expect(spec.codecFactory(instanceCtx).id).toBe(PG_FLOAT_CODEC_ID);
  });

  it('pgInt2Column packages a ColumnSpec for pg/int2@1', () => {
    const spec = pgInt2Column();
    expect(spec.codecId).toBe(PG_INT2_CODEC_ID);
    expect(spec.nativeType).toBe('int2');
    expect(spec.codecFactory(instanceCtx).id).toBe(PG_INT2_CODEC_ID);
  });

  it('pgInt4Column packages a ColumnSpec for pg/int4@1', () => {
    const spec = pgInt4Column();
    expect(spec.codecId).toBe(PG_INT4_CODEC_ID);
    expect(spec.nativeType).toBe('int4');
    expect(spec.codecFactory(instanceCtx).id).toBe(PG_INT4_CODEC_ID);
  });

  it('pgInt8Column packages a ColumnSpec for pg/int8@1', () => {
    const spec = pgInt8Column();
    expect(spec.codecId).toBe(PG_INT8_CODEC_ID);
    expect(spec.nativeType).toBe('int8');
    expect(spec.codecFactory(instanceCtx).id).toBe(PG_INT8_CODEC_ID);
  });

  it('pgIntColumn packages a ColumnSpec for pg/int@1', () => {
    const spec = pgIntColumn();
    expect(spec.codecId).toBe(PG_INT_CODEC_ID);
    expect(spec.nativeType).toBe('int4');
    expect(spec.codecFactory(instanceCtx).id).toBe(PG_INT_CODEC_ID);
  });

  it('pgIntervalColumn packages a ColumnSpec for pg/interval@1', () => {
    const spec = pgIntervalColumn({ precision: 3 });
    expect(spec.codecId).toBe(PG_INTERVAL_CODEC_ID);
    expect(spec.nativeType).toBe('interval');
    expect(spec.typeParams).toEqual({ precision: 3 });
    expect(spec.codecFactory(instanceCtx).id).toBe(PG_INTERVAL_CODEC_ID);
  });

  it('pgJsonColumn packages a ColumnSpec for pg/json@1', () => {
    const spec = pgJsonColumn();
    expect(spec.codecId).toBe(PG_JSON_CODEC_ID);
    expect(spec.nativeType).toBe('json');
    expect(spec.codecFactory(instanceCtx).id).toBe(PG_JSON_CODEC_ID);
  });

  it('pgJsonbColumn packages a ColumnSpec for pg/jsonb@1', () => {
    const spec = pgJsonbColumn();
    expect(spec.codecId).toBe(PG_JSONB_CODEC_ID);
    expect(spec.nativeType).toBe('jsonb');
    expect(spec.codecFactory(instanceCtx).id).toBe(PG_JSONB_CODEC_ID);
  });

  it('pgNumericColumn packages a ColumnSpec for pg/numeric@1', () => {
    const spec = pgNumericColumn({ precision: 10, scale: 2 });
    expect(spec.codecId).toBe(PG_NUMERIC_CODEC_ID);
    expect(spec.nativeType).toBe('numeric');
    expect(spec.typeParams).toEqual({ precision: 10, scale: 2 });
    expect(spec.codecFactory(instanceCtx).id).toBe(PG_NUMERIC_CODEC_ID);
  });

  it('pgNumericColumn defaults typeParams to {} when called with no args (unbounded numeric / bare Decimal)', () => {
    const spec = pgNumericColumn();
    expect(spec.typeParams).toEqual({});
  });

  it('pgTextColumn packages a ColumnSpec for pg/text@1', () => {
    const spec = pgTextColumn();
    expect(spec.codecId).toBe(PG_TEXT_CODEC_ID);
    expect(spec.nativeType).toBe('text');
    expect(spec.codecFactory(instanceCtx).id).toBe(PG_TEXT_CODEC_ID);
  });

  it('pgTimetzColumn packages a ColumnSpec for pg/timetz@1', () => {
    const spec = pgTimetzColumn();
    expect(spec.codecId).toBe(PG_TIMETZ_CODEC_ID);
    expect(spec.nativeType).toBe('timetz');
    expect(spec.codecFactory(instanceCtx).id).toBe(PG_TIMETZ_CODEC_ID);
  });

  it('pgUuidColumn packages a ColumnSpec for pg/uuid@1', () => {
    const spec = pgUuidColumn();
    expect(spec.codecId).toBe(PG_UUID_CODEC_ID);
    expect(spec.nativeType).toBe('uuid');
    expect(spec.codecFactory(instanceCtx).id).toBe(PG_UUID_CODEC_ID);
  });

  it('pgVarbitColumn packages a ColumnSpec for pg/varbit@1', () => {
    const spec = pgVarbitColumn({ length: 16 });
    expect(spec.codecId).toBe(PG_VARBIT_CODEC_ID);
    expect(spec.nativeType).toBe('bit varying');
    expect(spec.typeParams).toEqual({ length: 16 });
    expect(spec.codecFactory(instanceCtx).id).toBe(PG_VARBIT_CODEC_ID);
  });

  it('pgVarcharColumn packages a ColumnSpec for pg/varchar@1', () => {
    const spec = pgVarcharColumn({ length: 255 });
    expect(spec.codecId).toBe(PG_VARCHAR_CODEC_ID);
    expect(spec.nativeType).toBe('character varying');
    expect(spec.typeParams).toEqual({ length: 255 });
    expect(spec.codecFactory(instanceCtx).id).toBe(PG_VARCHAR_CODEC_ID);
  });
});
