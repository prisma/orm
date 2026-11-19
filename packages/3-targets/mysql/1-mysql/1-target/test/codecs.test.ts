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
  mysqlBigintNumberDescriptor,
  mysqlDatetimeDescriptor,
  mysqlDoubleDescriptor,
  mysqlEnumDescriptor,
  mysqlIntDescriptor,
  mysqlSqlVarcharDescriptor,
  mysqlTextDescriptor,
} from '../src/core/codecs';
import {
  mysqlBigint,
  mysqlDatetime,
  mysqlDouble,
  mysqlEnum,
  mysqlInt,
} from '../src/core/data-types';

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

  it('reads a bigint from its decimal text and writes it as the bigint, which the driver writes as bare digits, without losing digits', async () => {
    const codec = mysqlBigintDescriptor.factory()(instance);
    expect(await codec.fromWire('9007199254740993', ctx)).toBe(9007199254740993n);
    expect(await codec.fromWire(-7n, ctx)).toBe(-7n);
    expect(await codec.toWire(9007199254740993n, ctx)).toBe(9007199254740993n);
    await expect(codec.toWire(Object(1n), ctx)).rejects.toThrow(/must be a bigint/);
    await expect(codec.fromWire('x', ctx)).rejects.toThrow(/decimal text/);
    expect(codec.toDataTypeValue(12n)).toEqual(value(mysqlBigint, '12'));
    expect(codec.fromDataTypeValue(value(mysqlBigint, '12'))).toBe(12n);
  });

  it('reads a bigint as a number within the safe integer range, and refuses one outside it rather than round it', async () => {
    const codec = mysqlBigintNumberDescriptor.factory()(instance);
    expect([
      await codec.fromWire('9007199254740991', ctx),
      await codec.fromWire(-7, ctx),
      await codec.toWire(5, ctx),
    ]).toEqual([9007199254740991, -7, 5]);
    for (const wire of ['9007199254740992', '-9007199254740992', 2 ** 53, '1.5', 'x']) {
      await expect(codec.fromWire(wire, ctx)).rejects.toMatchObject({
        code: 'RUNTIME.DECODE_FAILED',
      });
    }
    await expect(codec.toWire(2 ** 53, ctx)).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
    });
    expect(codec.toDataTypeValue(12)).toEqual(value(mysqlBigint, '12'));
    expect(codec.fromDataTypeValue(value(mysqlBigint, '12'))).toBe(12);
    expect(() => codec.fromDataTypeValue(value(mysqlBigint, '9007199254740993'))).toThrow();
  });

  it('reads a double from the text MySQL prints for it, exponent included, and refuses a value MySQL cannot hold', async () => {
    const codec = mysqlDoubleDescriptor.factory()(instance);
    expect([
      await codec.fromWire('1.6666666666666667', ctx),
      await codec.fromWire('9.007199254740992e15', ctx),
      await codec.fromWire(2.5, ctx),
      await codec.toWire(0.1, ctx),
    ]).toEqual([5 / 3, 9007199254740992, 2.5, 0.1]);
    for (const wire of ['', 'NaN', 'x', '0x10', '0b11', ' 1 ', '1e', Number.POSITIVE_INFINITY]) {
      await expect(codec.fromWire(wire, ctx)).rejects.toMatchObject({
        code: 'RUNTIME.DECODE_FAILED',
      });
    }
    await expect(codec.toWire(Number.NaN, ctx)).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
    });
    expect(codec.toDataTypeValue(1.5)).toEqual(value(mysqlDouble, 1.5));
    expect(codec.fromDataTypeValue(value(mysqlDouble, 1.5))).toBe(1.5);
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
    expect(() => decodeMysqlDatetime('yesterday')).toThrow(/as MySQL and MariaDB print it/);
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
      /is not a codec descriptor of the MySQL and MariaDB targets/,
    );
    expect(() =>
      buildMysqlCodecDescriptorRegistry([mysqlIntDescriptor, mysqlIntDescriptor]),
    ).toThrow(/Duplicate codec descriptor id 'mysql\/int@1'/);
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

describe('the MySQL number codecs name the column they cannot read', () => {
  const column = { table: 'Counter', name: 'total' };

  it.each(['9007199254740992', '-9007199254740992', '1.5'])(
    'refuses to read %s as a bigint read as a number, naming the column',
    async (wire) => {
      await expect(
        mysqlBigintNumberDescriptor.factory()(instance).fromWire(wire, { column }),
      ).rejects.toMatchObject({
        code: 'RUNTIME.DECODE_FAILED',
        message: `Column "Counter"."total" holds ${wire}, which is not an integer within the safe integer range. mysql/bigintnumber@1 reads a JavaScript number, an integer within ±(2^53 − 1).`,
        fix: 'Read the column as BigInt, which reads a JavaScript bigint, or keep its values within ±(2^53 − 1).',
        meta: { codecId: 'mysql/bigintnumber@1', table: 'Counter', column: 'total' },
      });
    },
  );

  it.each([
    ['18014398509481982', 'a sum'],
    [9007199254740994, 'a max or a raw query read as a number'],
  ])(
    'says what to do for every reader of %s past the safe integer range read without a column, %s',
    async (wire) => {
      await expect(
        mysqlBigintNumberDescriptor.factory()(instance).fromWire(wire, {}),
      ).rejects.toMatchObject({
        code: 'RUNTIME.DECODE_FAILED',
        message: `A mysql/bigintnumber@1 value is ${wire}, which is not an integer within the safe integer range. mysql/bigintnumber@1 reads a JavaScript number, an integer within ±(2^53 − 1).`,
        fix: "The value does not fit a JavaScript number. Use an aggregate's BigInt form, such as sumBigInt or countBigInt; for a column's value, such as its min or max, declare the field BigInt, or read it as mysql/bigint@1 in a raw query.",
      });
    },
  );

  it('refuses to write a number outside the safe integer range, which the column would not read back', async () => {
    await expect(
      mysqlBigintNumberDescriptor
        .factory()(instance)
        .toWire(2 ** 53, {}),
    ).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      message:
        'Cannot write 9007199254740992 to a mysql/bigintnumber@1 value, which holds integers read as JavaScript numbers, within ±(2^53 − 1).',
    });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'refuses to write %s to a double, which MySQL and MariaDB do not store',
    async (value) => {
      await expect(
        mysqlDoubleDescriptor.factory()(instance).toWire(value, {}),
      ).rejects.toMatchObject({
        code: 'RUNTIME.ENCODE_FAILED',
        message: `Cannot write ${value} to a mysql/double@1 value, which holds finite numbers only: MySQL and MariaDB store no NaN or infinity.`,
      });
    },
  );

  it('refuses to read text that is not a double, naming the column', async () => {
    await expect(
      mysqlDoubleDescriptor.factory()(instance).fromWire('x', { column }),
    ).rejects.toMatchObject({
      code: 'RUNTIME.DECODE_FAILED',
      message:
        'Column "Counter"."total" holds "x", which is not a finite number. mysql/double@1 reads the text MySQL and MariaDB print for a double, such as 1.5 or 9.007199254740992e15.',
    });
  });
});
