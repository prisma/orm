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

  it('takes no input of a result-only codec, which no column can be authored with', () => {
    expect(
      descriptors.flatMap((row) =>
        row.input.kind === 'codec' &&
        ['mysql/bigintnumber@1', 'mysql/double@1'].includes(row.input.codecId)
          ? [`${row.operation}:${row.input.codecId}`]
          : [],
      ),
    ).toEqual([]);
  });
});
