import { describe, expect, it } from 'vitest';
import { createPostgresTypeMap } from '../../src/core/psl-build/postgres-type-map';
import { postgresCodecDescriptorRegistry } from '../../src/core/registry';
import { postgresPslTypeConstructors } from '../../src/core/type-constructors';

const typeConstructors: Readonly<
  Record<string, { readonly output: { readonly codecId: string } }>
> = postgresPslTypeConstructors;

describe('createPostgresTypeMap', () => {
  const typeMap = createPostgresTypeMap();

  it('maps basic scalar types', () => {
    expect(typeMap.resolve('text')).toEqual({ pslType: { name: 'String' }, nativeType: 'text' });
    expect(typeMap.resolve('int4')).toEqual({ pslType: { name: 'Int' }, nativeType: 'int4' });
    expect(typeMap.resolve('bool')).toEqual({ pslType: { name: 'Boolean' }, nativeType: 'bool' });
    expect(typeMap.resolve('float8')).toEqual({ pslType: { name: 'Float' }, nativeType: 'float8' });
    expect(typeMap.resolve('numeric')).toEqual({
      pslType: { name: 'Numeric' },
      nativeType: 'numeric',
    });
    expect(typeMap.resolve('timestamptz')).toEqual({
      pslType: { name: 'TimestamptzString' },
      nativeType: 'timestamptz',
    });
    expect(typeMap.resolve('timestamp with time zone')).toEqual({
      pslType: { name: 'TimestamptzString' },
      nativeType: 'timestamp with time zone',
    });
    expect(typeMap.resolve('jsonb')).toEqual({ pslType: { name: 'Jsonb' }, nativeType: 'jsonb' });
    expect(typeMap.resolve('bytea')).toEqual({ pslType: { name: 'Bytes' }, nativeType: 'bytea' });
    expect(typeMap.resolve('int8')).toEqual({ pslType: { name: 'BigInt' }, nativeType: 'int8' });
    expect(typeMap.resolve('uuid')).toEqual({
      pslType: { name: 'Uuid' },
      nativeType: 'uuid',
    });
    expect(typeMap.resolve('inet')).toEqual({
      pslType: { name: 'Inet' },
      nativeType: 'inet',
    });
  });

  it('maps alias types', () => {
    expect(typeMap.resolve('integer')).toEqual({ pslType: { name: 'Int' }, nativeType: 'integer' });
    expect(typeMap.resolve('boolean')).toEqual({
      pslType: { name: 'Boolean' },
      nativeType: 'boolean',
    });
    expect(typeMap.resolve('bigint')).toEqual({
      pslType: { name: 'BigInt' },
      nativeType: 'bigint',
    });
    expect(typeMap.resolve('real')).toEqual({
      pslType: { name: 'Real' },
      nativeType: 'real',
    });
    expect(typeMap.resolve('double precision')).toEqual({
      pslType: { name: 'Float' },
      nativeType: 'double precision',
    });
  });

  it('handles parameterized types', () => {
    const result = typeMap.resolve('character varying(255)');
    expect(result).toEqual({
      pslType: { name: 'VarChar', args: ['255'] },
      nativeType: 'character varying(255)',
      typeParams: { baseType: 'character varying', params: '255' },
    });
  });

  it('handles character type with parameter', () => {
    const result = typeMap.resolve('character(20)');
    expect(result).toEqual({
      pslType: { name: 'Char', args: ['20'] },
      nativeType: 'character(20)',
      typeParams: { baseType: 'character', params: '20' },
    });
  });

  it('preserves bare varchar in type position', () => {
    expect(typeMap.resolve('varchar')).toEqual({
      pslType: { name: 'VarChar' },
      nativeType: 'varchar',
    });
  });

  it('preserves non-default timestamp, date, time, json, and integer types', () => {
    expect(typeMap.resolve('timestamp')).toEqual({
      pslType: { name: 'TimestampString' },
      nativeType: 'timestamp',
    });
    expect(typeMap.resolve('time(3)')).toEqual({
      pslType: { name: 'TimeString', args: ['3'] },
      nativeType: 'time(3)',
      typeParams: { baseType: 'time', params: '3' },
    });
    expect(typeMap.resolve('date')).toEqual({
      pslType: { name: 'DateString' },
      nativeType: 'date',
    });
    expect(typeMap.resolve('json')).toEqual({
      pslType: { name: 'Json' },
      nativeType: 'json',
    });
    expect(typeMap.resolve('int2')).toEqual({
      pslType: { name: 'SmallInt' },
      nativeType: 'int2',
    });
  });

  it('returns unsupported for unknown types', () => {
    expect(typeMap.resolve('geometry')).toEqual({ unsupported: true, nativeType: 'geometry' });
    expect(typeMap.resolve('hstore')).toEqual({ unsupported: true, nativeType: 'hstore' });
  });

  it('ignores prototype-chain property names', () => {
    expect(typeMap.resolve('constructor')).toEqual({
      unsupported: true,
      nativeType: 'constructor',
    });
    expect(typeMap.resolve('constructor(1)')).toEqual({
      unsupported: true,
      nativeType: 'constructor(1)',
    });
  });

  it('detects enum types when provided', () => {
    const enumTypes = new Set(['user_role', 'status']);
    const enumTypeMap = createPostgresTypeMap(enumTypes);

    expect(enumTypeMap.resolve('user_role')).toEqual({
      pslType: { name: 'user_role' },
      nativeType: 'user_role',
    });
    expect(enumTypeMap.resolve('status')).toEqual({
      pslType: { name: 'status' },
      nativeType: 'status',
    });
    expect(enumTypeMap.resolve('text')).toEqual({
      pslType: { name: 'String' },
      nativeType: 'text',
    });
  });
});

describe('contract infer writes the text-backed date and time types', () => {
  const map = createPostgresTypeMap();

  it.each([
    ['timestamp', 'TimestampString', undefined],
    ['timestamp without time zone', 'TimestampString', undefined],
    ['timestamp(3)', 'TimestampString', ['3']],
    ['timestamptz', 'TimestamptzString', undefined],
    ['timestamp with time zone', 'TimestamptzString', undefined],
    ['timestamptz(6)', 'TimestamptzString', ['6']],
    ['date', 'DateString', undefined],
    ['time', 'TimeString', undefined],
    ['time without time zone', 'TimeString', undefined],
    ['time(3)', 'TimeString', ['3']],
    ['timetz', 'Timetz', undefined],
    ['time with time zone', 'Timetz', undefined],
    ['timetz(3)', 'Timetz', ['3']],
  ])('resolves %s to %s', (nativeType, name, args) => {
    const resolution = map.resolve(nativeType);
    expect('pslType' in resolution ? resolution.pslType : resolution).toEqual(
      args === undefined ? { name } : { name, args },
    );
  });

  it('binds every spelling to a codec that reads and writes without Temporal', async () => {
    const wireValues = {
      timestamp: '2024-01-01 00:00:00',
      'timestamp without time zone': '2024-01-01 00:00:00',
      'timestamp(3)': '2024-01-01 00:00:00.123',
      timestamptz: '2024-01-01 00:00:00+00',
      'timestamp with time zone': '2024-01-01 00:00:00+00',
      'timestamptz(6)': '2024-01-01 00:00:00.123456+00',
      date: '2024-01-01',
      time: '12:34:56',
      'time without time zone': '12:34:56',
      'time(3)': '12:34:56.123',
      timetz: '12:34:56+02',
      'time with time zone': '12:34:56+02',
      'timetz(3)': '12:34:56.123+02',
    } as const;

    const roundTripped = await withoutTemporal(async () => {
      const results: Record<string, unknown> = {};
      for (const [nativeType, wire] of Object.entries(wireValues)) {
        const resolution = map.resolve(nativeType);
        const codecId =
          'pslType' in resolution
            ? typeConstructors[resolution.pslType.name]?.output.codecId
            : undefined;
        const descriptor =
          codecId === undefined
            ? undefined
            : postgresCodecDescriptorRegistry.descriptorFor(codecId);
        if (descriptor === undefined) {
          results[nativeType] = `no codec for ${nativeType}`;
          continue;
        }
        const codec = descriptor.factory({})({ name: nativeType });
        try {
          results[nativeType] = await codec.toWire(await codec.fromWire(wire, {}), {});
        } catch (error) {
          results[nativeType] = error instanceof Error ? error.message : error;
        }
      }
      return results;
    });

    expect(roundTripped).toEqual(wireValues);
  });
});

async function withoutTemporal<T>(body: () => Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'Temporal');
  Reflect.deleteProperty(globalThis, 'Temporal');
  try {
    return await body();
  } finally {
    if (original === undefined) Reflect.deleteProperty(globalThis, 'Temporal');
    else Object.defineProperty(globalThis, 'Temporal', original);
  }
}
