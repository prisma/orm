import { readContractValue } from '@internal/framework-components/codec';
import type { AggregateOutputCodec } from '@internal/framework-components/components';
import type { SqlAggregateDescriptor } from '@internal/sql-relational-core/aggregate-descriptor-registry';
import { describe, expect, it } from 'vitest';
import { sqliteAggregateDescriptors } from '../src/core/aggregates';
import { sqliteCodecRegistry } from '../src/core/registry';

/**
 * A non-nullable row answers with a value where no result row reached the
 * client at all, and it declares that value in its own result codec's canonical
 * JSON. The two have to agree: a declaration in the wrong form is a value the
 * codec refuses at the one moment a populated table never reaches.
 */

function outputCodecId(output: AggregateOutputCodec): string {
  if (output.kind !== 'codec') {
    throw new Error('a non-nullable aggregate row names its result codec outright');
  }
  return output.codecId;
}

function decodeEmptyResult(row: SqlAggregateDescriptor & { readonly nullable: false }): unknown {
  const descriptor = sqliteCodecRegistry.descriptorFor(outputCodecId(row.output));
  if (descriptor === undefined) {
    throw new Error(`no registered codec for '${outputCodecId(row.output)}'`);
  }
  const codec = descriptor.factory(undefined)({ name: 'empty-result' });
  return readContractValue(codec, row.emptyResultJson, {});
}

describe('SQLite empty-result declarations', () => {
  it('decodes every declared empty result through the codec its row names', () => {
    const answers = sqliteAggregateDescriptors.flatMap((row) =>
      row.nullable ? [] : [{ operation: row.operation, empty: decodeEmptyResult(row) }],
    );

    expect(answers).toEqual([
      { operation: 'count', empty: 0 },
      { operation: 'countBigInt', empty: 0n },
    ]);
  });
});
