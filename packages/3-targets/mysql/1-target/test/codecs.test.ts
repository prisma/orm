import type { JsonValue } from '@internal/contract/types';
import type { DataTypeValue } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import {
  buildMysqlCodecDescriptorRegistry,
  isMysqlCodecDescriptor,
} from '../src/core/codec-descriptor';
import {
  assembleMysqlCodecRegistry,
  createMysqlBuiltinCodecLookup,
} from '../src/core/codec-registry';
import {
  codecDescriptors,
  decodeMysqlDatetime,
  encodeMysqlDatetime,
  mysqlBigintDescriptor,
  mysqlDatetimeDescriptor,
  mysqlEnumDescriptor,
  mysqlIntDescriptor,
  mysqlSqlVarcharDescriptor,
  mysqlTextDescriptor,
} from '../src/core/codecs';
import { mysqlBigint, mysqlDatetime, mysqlEnum, mysqlInt } from '../src/core/data-types';

const ctx = {};
const instance = { name: 'test' };
const value = <T extends JsonValue>(
  type: { valueFrom(json: never, params: object): DataTypeValue },
  json: T,
): DataTypeValue<T> => type.valueFrom(json as never, {}) as DataTypeValue<T>;

describe('MySQL codecs read the text MySQL sends', () => {
  it('reads an int from its decimal text', async () => {
    const codec = mysqlIntDescriptor.factory()(instance);
    expect(await codec.fromWire('42', ctx)).toBe(42);
    expect(await codec.fromWire(-7, ctx)).toBe(-7);
    expect(await codec.toWire(5, ctx)).toBe(5);
    await expect(codec.fromWire('4.2', ctx)).rejects.toThrow(/decimal text of an integer/);
    await expect(codec.toWire(1.5, ctx)).rejects.toThrow(/must be an integer/);
    expect(codec.toDataTypeValue(3)).toEqual(value(mysqlInt, 3));
    expect(codec.fromDataTypeValue(value(mysqlInt, 3))).toBe(3);
  });

  it('reads a bigint from its decimal text without losing digits', async () => {
    const codec = mysqlBigintDescriptor.factory()(instance);
    expect(await codec.fromWire('9007199254740993', ctx)).toBe(9007199254740993n);
    expect(await codec.toWire(9007199254740993n, ctx)).toBe(9007199254740993n);
    await expect(codec.fromWire('x', ctx)).rejects.toThrow(/decimal text/);
    expect(codec.toDataTypeValue(12n)).toEqual(value(mysqlBigint, '12'));
    expect(codec.fromDataTypeValue(value(mysqlBigint, '12'))).toBe(12n);
  });

  it('refuses a stored datetime with digits below a millisecond, and reads a row with them at the millisecond', async () => {
    const codec = mysqlDatetimeDescriptor.factory({ precision: 6 })(instance);
    expect(() =>
      codec.fromDataTypeValue(
        mysqlDatetime.valueFrom('2024-01-02T03:04:05.678912', { precision: 6 }),
      ),
    ).toThrow(/2024-01-02T03:04:05\.678912/);
    expect(await codec.fromWire('2024-01-02 03:04:05.678912', ctx)).toEqual(
      new Date('2024-01-02T03:04:05.678Z'),
    );
  });

  it('reads a datetime as the instant it names in UTC', async () => {
    const codec = mysqlDatetimeDescriptor.factory({ precision: 3 })(instance);
    const instant = new Date('2024-01-02T03:04:05.678Z');
    expect(await codec.fromWire('2024-01-02 03:04:05.678', ctx)).toEqual(instant);
    expect(await codec.toWire(instant, ctx)).toBe('2024-01-02 03:04:05.678');
    expect(codec.toDataTypeValue(instant)).toEqual(
      mysqlDatetime.valueFrom('2024-01-02T03:04:05.678', { precision: 3 }),
    );
    expect(codec.fromDataTypeValue(value(mysqlDatetime, '2024-01-02T03:04:05.678'))).toEqual(
      instant,
    );
  });

  it('refuses text that names no date and time, and an invalid Date', () => {
    expect(() => decodeMysqlDatetime('yesterday')).toThrow(/as MySQL prints it/);
    expect(() => encodeMysqlDatetime(new Date('nope'))).toThrow(/valid Date/);
  });

  it('reads text and enum members unchanged', async () => {
    const text = mysqlTextDescriptor.factory()(instance);
    const member = mysqlEnumDescriptor.factory({ values: ['USER', 'ADMIN'] })(instance);
    expect([await text.fromWire('a', ctx), await text.toWire('b', ctx)]).toEqual(['a', 'b']);
    expect([await member.fromWire('USER', ctx), await member.toWire('ADMIN', ctx)]).toEqual([
      'USER',
      'ADMIN',
    ]);
    expect(member.toDataTypeValue('USER')).toEqual(
      mysqlEnum.valueFrom('USER', { values: ['USER', 'ADMIN'] }),
    );
    expect(() => member.toDataTypeValue('OWNER')).toThrow(/one of the members/);
  });

  it('renders member literals for the emitted types', () => {
    expect(mysqlEnumDescriptor.renderValueLiteral('USER')).toBe('"USER"');
    expect(mysqlIntDescriptor.renderValueLiteral(1)).toBe('1');
    expect(mysqlBigintDescriptor.renderValueLiteral('1')).toBe('1n');
  });
});

describe('MySQL codec descriptors', () => {
  it('adapts the family varchar codec to mysql/varchar with its length', async () => {
    const codec = mysqlSqlVarcharDescriptor.factory({ length: 191 })(instance);
    expect({
      dataType: mysqlSqlVarcharDescriptor.dataType,
      wire: await codec.fromWire('x', ctx),
    }).toEqual({
      dataType: 'mysql/varchar',
      wire: 'x',
    });
  });

  it('builds a registry of every built-in codec', () => {
    const registry = createMysqlBuiltinCodecLookup();
    expect(Array.from(registry.values(), (descriptor) => descriptor.codecId).sort()).toEqual(
      codecDescriptors.map((descriptor) => descriptor.codecId).sort(),
    );
    expect(registry.descriptorFor('mysql/enum@1')).toBe(mysqlEnumDescriptor);
    expect(assembleMysqlCodecRegistry({}, []).descriptorFor('mysql/int@1')).toBe(
      mysqlIntDescriptor,
    );
  });

  it('refuses a descriptor that is not a MySQL one, and a codec id given twice', () => {
    expect(isMysqlCodecDescriptor({ codecId: 'x' })).toBe(false);
    expect(() => buildMysqlCodecDescriptorRegistry([{ codecId: 'pg/int4@1' }])).toThrow(
      /not a valid MySQL codec descriptor/,
    );
    expect(() =>
      buildMysqlCodecDescriptorRegistry([mysqlIntDescriptor, mysqlIntDescriptor]),
    ).toThrow(/Duplicate MySQL codec descriptor id 'mysql\/int@1'/);
  });
});

describe('the MySQL bigint codec', () => {
  it('writes every value a signed bigint column holds, and refuses one outside that range', async () => {
    const codec = mysqlBigintDescriptor.factory()(instance);
    expect([
      await codec.toWire(2n ** 63n - 1n, ctx),
      await codec.toWire(-(2n ** 63n), ctx),
    ]).toEqual([2n ** 63n - 1n, -(2n ** 63n)]);
    for (const value of [2n ** 63n, -(2n ** 63n) - 1n, 2n ** 64n - 1n]) {
      await expect(codec.toWire(value, ctx)).rejects.toMatchObject({
        code: 'RUNTIME.ENCODE_FAILED',
      });
    }
  });
});
