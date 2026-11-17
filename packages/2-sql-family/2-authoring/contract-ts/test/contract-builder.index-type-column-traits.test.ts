/**
 * An index type may require the codecs of the columns it covers to carry
 * traits. The contract build checks it through the contract's codec lookup,
 * so an index written through the general index API cannot cover a column
 * its type cannot index.
 */

import type { CodecLookupWithDescriptors, CodecTrait } from '@internal/framework-components/codec';
import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import { defineIndexTypes } from '@internal/sql-contract/index-types';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { testTypeLookups } from '../../../1-core/contract/test/test-type-lookups';
import { defineContract, field, model } from '../src/contract-builder';
import type { IndexConstraint, ScalarFieldBuilder } from '../src/contract-dsl';
import { columnDescriptor } from './helpers/column-descriptor';

const bareFamilyPack: FamilyPackRef<'sql'> = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
};

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
};

const searchIndexPack = {
  kind: 'extension',
  id: 'search-index-pack',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  indexTypes: defineIndexTypes().add('search', {
    options: type('object'),
    columnTraits: ['textual'],
  }),
} as const;

const traitsByCodecId: Record<string, readonly CodecTrait[]> = {
  'pg/text@1': ['equality', 'textual'],
  'pg/int4@1': ['equality', 'numeric'],
};

const codecLookup: CodecLookupWithDescriptors = {
  ...testTypeLookups.codecLookup,
  descriptorFor: (codecId) => {
    const traits = traitsByCodecId[codecId];
    const descriptor = testTypeLookups.codecLookup.descriptorFor(codecId);
    return traits === undefined || descriptor === undefined ? undefined : { ...descriptor, traits };
  },
};

const messageFields = {
  id: field.column(columnDescriptor('pg/int4@1')).id(),
  body: field.column(columnDescriptor('pg/text@1')),
  views: field.column(columnDescriptor('pg/int4@1')),
};

function buildWithSearchIndexOn(
  indexFields: readonly string[],
  fields: Record<string, ScalarFieldBuilder> = messageFields,
) {
  const index: IndexConstraint = {
    kind: 'index',
    fields: indexFields,
    type: 'search',
    options: {},
    name: 'message_search',
  };
  return defineContract({
    family: bareFamilyPack,
    target: postgresTargetPack,
    extensions: { searchIndexes: searchIndexPack },
    createNamespace: createTestSqlNamespace,
    codecLookup,
    dataTypeLookup: testTypeLookups.dataTypeLookup,
    models: {
      Message: model('Message', { fields }).sql({ table: 'message', indexes: [index] }),
    },
  });
}

describe('index type column traits', () => {
  it('accepts an index whose columns carry the traits its type requires', () => {
    expect(() => buildWithSearchIndexOn(['body'])).not.toThrow();
  });

  it('refuses an index over a column whose codec lacks a required trait', () => {
    expect(() => buildWithSearchIndexOn(['body', 'views'])).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.INDEX_INVALID',
        message: expect.stringMatching(/"views".*pg\/int4@1.*textual/),
        meta: expect.objectContaining({ indexType: 'search', column: 'views' }),
      }),
    );
  });

  it('refuses an index over a column whose codec the lookup does not know', () => {
    const tags = field.column(columnDescriptor('acme/tags@1'));
    expect(() => buildWithSearchIndexOn(['body', 'tags'], { ...messageFields, tags })).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.CODEC_DESCRIPTOR_MISSING',
        message: expect.stringMatching(/acme\/tags@1/),
      }),
    );
  });
});
