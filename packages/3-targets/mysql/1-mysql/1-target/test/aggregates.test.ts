import type { CodecRef } from '@internal/framework-components/codec';
import type { SqlAggregateDescriptor } from '@internal/sql-relational-core/aggregate-descriptor-registry';
import { buildSqlAggregateDescriptorRegistry } from '@internal/sql-relational-core/aggregate-descriptor-registry';
import { describe, expect, it } from 'vitest';
import { mysqlAggregateDescriptors } from '../src/core/aggregates';
import { mysqlCodecRegistry } from '../src/core/registry';

const descriptors: ReadonlyArray<SqlAggregateDescriptor> = mysqlAggregateDescriptors;
const registry = buildSqlAggregateDescriptorRegistry(descriptors, mysqlCodecRegistry);

function codecOf(codecId: string) {
  const descriptor = mysqlCodecRegistry.descriptorFor(codecId);
  if (descriptor === undefined) throw new Error(`no registered codec for '${codecId}'`);
  return descriptor.factory(undefined)({ name: 'aggregate' });
}

const resultOf = (operation: string, codecId: string) => {
  const input: CodecRef = { codecId };
  return registry.resolve(operation, input)?.output.codecId;
};

describe('MySQL aggregate descriptors', () => {
  it('reads every declared empty result with the fromWire of the codec its row names', async () => {
    const answers = await Promise.all(
      descriptors.flatMap((row) =>
        row.nullable || row.output.kind !== 'codec'
          ? []
          : [
              codecOf(row.output.codecId)
                .fromWire(row.emptyResultWire, {})
                .then((empty) => ({ operation: row.operation, empty })),
            ],
      ),
    );
    expect(answers).toEqual([
      { operation: 'count', empty: 0 },
      { operation: 'countBigInt', empty: 0n },
    ]);
  });

  it('resolves count and the sum of integers to numbers, the lossless variants to bigints, and an integer mean to a double', () => {
    expect({
      count: resultOf('count', 'mysql/int@1'),
      countBigInt: resultOf('countBigInt', 'mysql/text@1'),
      sumInt: resultOf('sum', 'mysql/int@1'),
      sumBigint: resultOf('sum', 'mysql/bigint@1'),
      sumBigIntOfBigint: resultOf('sumBigInt', 'mysql/bigint@1'),
      avgInt: resultOf('avg', 'mysql/int@1'),
      avgBigint: resultOf('avg', 'mysql/bigint@1'),
      avgDecimal: resultOf('avgDecimal', 'mysql/int@1'),
    }).toEqual({
      count: 'mysql/bigintnumber@1',
      countBigInt: 'mysql/bigint@1',
      sumInt: 'mysql/bigintnumber@1',
      sumBigint: 'mysql/bigintnumber@1',
      sumBigIntOfBigint: 'mysql/bigint@1',
      avgInt: 'mysql/double@1',
      avgBigint: 'mysql/double@1',
      avgDecimal: undefined,
    });
  });

  it('resolves min and max through the input codec, traits included, and leaves out text sums, date sums and duration extremes', () => {
    expect({
      minText: resultOf('min', 'mysql/text@1'),
      minEnum: resultOf('max', 'mysql/enum@1'),
      minVarchar: resultOf('min', 'sql/varchar@1'),
      minDatetime: resultOf('min', 'mysql/datetime@1'),
      minDuration: resultOf('min', 'mysql/duration-string@1'),
      sumText: resultOf('sum', 'mysql/text@1'),
      sumDatetime: resultOf('sum', 'mysql/datetime@1'),
      avgTime: resultOf('avg', 'mysql/time-string@1'),
    }).toEqual({
      minText: 'mysql/text@1',
      minEnum: 'mysql/enum@1',
      minVarchar: 'sql/varchar@1',
      minDatetime: 'mysql/datetime@1',
      minDuration: undefined,
      sumText: undefined,
      sumDatetime: undefined,
      avgTime: undefined,
    });
  });

  it('sums and averages a double as a double, sums a decimal exactly as a decimal, and averages no decimal', () => {
    expect({
      sumDouble: resultOf('sum', 'mysql/double@1'),
      avgDouble: resultOf('avg', 'mysql/double@1'),
      sumDecimal: resultOf('sum', 'mysql/decimal@1'),
      avgDecimal: resultOf('avg', 'mysql/decimal@1'),
      maxDecimal: resultOf('max', 'mysql/decimal@1'),
      minDouble: resultOf('min', 'mysql/double@1'),
    }).toEqual({
      sumDouble: 'mysql/double@1',
      avgDouble: 'mysql/double@1',
      sumDecimal: 'mysql/decimal@1',
      avgDecimal: undefined,
      maxDecimal: 'mysql/decimal@1',
      minDouble: 'mysql/double@1',
    });
  });

  it.each([
    [
      { precision: 10, scale: 2 },
      { precision: 32, scale: 2 },
    ],
    [
      { precision: 40, scale: 30 },
      { precision: 62, scale: 30 },
    ],
    [
      { precision: 65, scale: 0 },
      { precision: 65, scale: 0 },
    ],
    [{ precision: 10 }, { precision: 32, scale: 0 }],
  ])(
    'sums a decimal column of %j as the server types the total, a decimal of %j',
    (typeParams, total) => {
      const input: CodecRef = { codecId: 'mysql/decimal@1', typeParams };
      expect(registry.resolve('sum', input)?.output).toEqual({
        codecId: 'mysql/decimal@1',
        typeParams: total,
      });
    },
  );

  it('gives the sum of a decimal reference without a precision, which is of no column, no precision either', () => {
    expect(registry.resolve('sum', { codecId: 'mysql/decimal@1' })?.output).toStrictEqual({
      codecId: 'mysql/decimal@1',
    });
  });

  it('reads the sum and mean of a bigint read as a number as those of any integer', () => {
    expect({
      sum: resultOf('sum', 'mysql/bigintnumber@1'),
      sumBigInt: resultOf('sumBigInt', 'mysql/bigintnumber@1'),
      avg: resultOf('avg', 'mysql/bigintnumber@1'),
      max: resultOf('max', 'mysql/bigintnumber@1'),
    }).toEqual({
      sum: 'mysql/bigintnumber@1',
      sumBigInt: 'mysql/bigint@1',
      avg: 'mysql/double@1',
      max: 'mysql/bigintnumber@1',
    });
  });
});
