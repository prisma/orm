/**
 * An index type whose access method is not its own name is converted into an index of that access
 * method by the target. Only the target provides the conversion, so the contract build refuses
 * such a type from an extension pack.
 */
import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import { defineIndexTypes } from '@internal/sql-contract/index-types';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { testTypeLookups } from '../../../1-core/contract/test/test-type-lookups';
import { defineContract, field, model } from '../src/contract-builder';
import type { IndexConstraint } from '../src/contract-dsl';
import { columnDescriptor } from './helpers/column-descriptor';
import { unboundTables } from './unbound-tables';

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

const convertedSearch = defineIndexTypes().add('search', {
  options: type('object'),
  accessMethod: 'gin',
});

const searchIndex: IndexConstraint = {
  kind: 'index',
  fields: ['title'],
  type: 'search',
  options: {},
  name: 'message_search',
};

const messageModel = model('Message', {
  fields: {
    id: field.column(columnDescriptor('pg/int4@1')).id(),
    title: field.column(columnDescriptor('pg/text@1')),
  },
}).sql(() => ({ table: 'message', indexes: [searchIndex] }));

describe('an index type whose access method is not its own name', () => {
  it('is refused from an extension pack', () => {
    expect(() =>
      defineContract({
        ...testTypeLookups,
        family: bareFamilyPack,
        target: postgresTargetPack,
        extensions: {
          search: {
            kind: 'extension',
            id: 'search-index-pack',
            familyId: 'sql',
            targetId: 'postgres',
            version: '0.0.1',
            indexTypes: convertedSearch,
          },
        },
        createNamespace: createTestSqlNamespace,
        models: { Message: messageModel },
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
        meta: { indexType: 'search', accessMethod: 'gin', packId: 'search-index-pack' },
      }),
    );
  });

  it('is accepted from the target', () => {
    const contract = defineContract({
      ...testTypeLookups,
      family: bareFamilyPack,
      target: { ...postgresTargetPack, indexTypes: convertedSearch },
      createNamespace: createTestSqlNamespace,
      models: { Message: messageModel },
    });

    expect(unboundTables(contract.storage)['message']!.indexes[0]).toMatchObject({
      columns: ['title'],
      type: 'search',
    });
  });
});
