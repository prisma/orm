import { aggregateDescriptorKey } from '@internal/framework-components/components';
import type { SqlAggregateDescriptor } from '@internal/sql-relational-core/aggregate-descriptor-registry';
import { describe, expect, it } from 'vitest';
import { mysqlAggregateDescriptors } from '../src/core/aggregates';
import { mysqlCodecRegistry } from '../src/core/registry';

const descriptors: ReadonlyArray<SqlAggregateDescriptor> = mysqlAggregateDescriptors;

function codecOf(codecId: string) {
  const descriptor = mysqlCodecRegistry.descriptorFor(codecId);
  if (descriptor === undefined) throw new Error(`no registered codec for '${codecId}'`);
  return descriptor.factory(undefined)({ name: 'aggregate' });
}

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

  it('names only registered codecs, and claims each overload once', () => {
    const named = descriptors.flatMap((row) => [
      ...(row.input.kind === 'codec' ? [row.input.codecId] : []),
      ...(row.output.kind === 'codec' ? [row.output.codecId] : []),
    ]);
    expect(
      named.filter((codecId) => mysqlCodecRegistry.descriptorFor(codecId) === undefined),
    ).toEqual([]);
    const keys = descriptors.map(aggregateDescriptorKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('reads count and the sum of integers as numbers, the lossless variants as bigints, and an integer mean as a double', () => {
    const resultOf = (operation: string, codecId: string) =>
      descriptors.find(
        (row) =>
          row.operation === operation &&
          (row.input.kind === 'any' ||
            (row.input.kind === 'codec' && row.input.codecId === codecId)),
      )?.output;
    expect({
      count: resultOf('count', 'mysql/int@1'),
      countBigInt: resultOf('countBigInt', 'mysql/int@1'),
      sumInt: resultOf('sum', 'mysql/int@1'),
      sumBigint: resultOf('sum', 'mysql/bigint@1'),
      sumBigIntOfBigint: resultOf('sumBigInt', 'mysql/bigint@1'),
      avgInt: resultOf('avg', 'mysql/int@1'),
      avgBigint: resultOf('avg', 'mysql/bigint@1'),
      avgDecimal: resultOf('avgDecimal', 'mysql/int@1'),
      sumText: resultOf('sum', 'mysql/text@1'),
      sumDatetime: resultOf('sum', 'mysql/datetime@1'),
      minDuration: resultOf('min', 'mysql/duration-string@1'),
    }).toEqual({
      count: { kind: 'codec', codecId: 'mysql/bigintnumber@1' },
      countBigInt: { kind: 'codec', codecId: 'mysql/bigint@1' },
      sumInt: { kind: 'codec', codecId: 'mysql/bigintnumber@1' },
      sumBigint: { kind: 'codec', codecId: 'mysql/bigintnumber@1' },
      sumBigIntOfBigint: { kind: 'codec', codecId: 'mysql/bigint@1' },
      avgInt: { kind: 'codec', codecId: 'mysql/double@1' },
      avgBigint: { kind: 'codec', codecId: 'mysql/double@1' },
      avgDecimal: undefined,
      sumText: undefined,
      sumDatetime: undefined,
      minDuration: undefined,
    });
  });
});
