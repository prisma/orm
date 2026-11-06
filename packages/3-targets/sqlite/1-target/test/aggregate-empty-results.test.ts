import type { AggregateOutputCodec } from '@internal/framework-components/components';
import type { SqlAggregateDescriptor } from '@internal/sql-relational-core/aggregate-descriptor-registry';
import { describe, expect, it } from 'vitest';
import { sqliteAggregateDescriptors } from '../src/core/aggregates';
import { sqliteCodecRegistry } from '../src/core/registry';

/**
 * A non-nullable row answers with a value where no result row reached the
 * client at all, and it declares that value as a wire value of its own result
 * codec. The two have to agree: a declaration in the wrong form is a value the
 * codec refuses at the one moment a populated table never reaches.
 */

function outputCodecId(output: AggregateOutputCodec): string {
  if (output.kind !== 'codec') {
    throw new Error('a non-nullable aggregate row names its result codec outright');
  }
  return output.codecId;
}

async function decodeEmptyResult(
  row: SqlAggregateDescriptor & { readonly nullable: false },
): Promise<unknown> {
  const descriptor = sqliteCodecRegistry.descriptorFor(outputCodecId(row.output));
  if (descriptor === undefined) {
    throw new Error(`no registered codec for '${outputCodecId(row.output)}'`);
  }
  const codec = descriptor.factory(undefined)({ name: 'empty-result' });
  return codec.fromWire(row.emptyResultWire, {});
}

describe('SQLite empty-result declarations', () => {
  it('reads every declared empty result with the fromWire of the codec its row names', async () => {
    const answers = await Promise.all(
      sqliteAggregateDescriptors.flatMap((row) =>
        row.nullable
          ? []
          : [decodeEmptyResult(row).then((empty) => ({ operation: row.operation, empty }))],
      ),
    );

    expect(answers).toEqual([
      { operation: 'count', empty: 0 },
      { operation: 'countBigInt', empty: 0n },
    ]);
  });
});
