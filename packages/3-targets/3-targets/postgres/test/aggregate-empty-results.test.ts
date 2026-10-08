import type { AggregateOutputCodec } from '@internal/framework-components/components';
import type { SqlAggregateDescriptor } from '@internal/sql-relational-core/aggregate-descriptor-registry';
import { describe, expect, it } from 'vitest';
import { postgresAggregateDescriptors } from '../src/core/aggregates';
import { postgresCodecRegistry } from '../src/core/registry';
import { fromContractJson } from './contract-json';

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
  const descriptor = postgresCodecRegistry.descriptorFor(outputCodecId(row.output));
  if (descriptor === undefined) {
    throw new Error(`no registered codec for '${outputCodecId(row.output)}'`);
  }
  return fromContractJson(
    descriptor.factory(undefined)({ name: 'empty-result' }),
    row.emptyResultJson,
  );
}

describe('PostgreSQL empty-result declarations', () => {
  it('decodes every declared empty result through the codec its row names', () => {
    const answers = postgresAggregateDescriptors.flatMap((row) =>
      row.nullable ? [] : [{ operation: row.operation, empty: decodeEmptyResult(row) }],
    );

    expect(answers).toEqual([
      { operation: 'count', empty: 0 },
      { operation: 'countBigInt', empty: 0n },
    ]);
  });
});
