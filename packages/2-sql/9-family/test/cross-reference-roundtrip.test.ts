import {
  type Contract,
  CrossReferenceSchema,
  crossRef,
  domainModelsAtDefaultNamespace,
  UNBOUND_DOMAIN_NAMESPACE_ID,
} from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { createSqlContract } from '@repo/test-utils';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { TestSqlContractSerializer as SqlContractSerializer } from './test-sql-contract-serializer';

describe('cross-reference shape round-trip', () => {
  it('parses and round-trips through SQL family serializer hydration', () => {
    const rootsCrossRef = crossRef('User', UNBOUND_DOMAIN_NAMESPACE_ID);
    const relationCrossRef = crossRef('Post', UNBOUND_DOMAIN_NAMESPACE_ID);
    const baseCrossRef = crossRef('User', UNBOUND_DOMAIN_NAMESPACE_ID);
    expect(CrossReferenceSchema(rootsCrossRef) instanceof type.errors).toBe(false);

    const envelope = createSqlContract({
      roots: { users: rootsCrossRef },
      models: {
        User: {
          fields: {
            kind: { nullable: false, many: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
          },
          discriminator: { field: 'kind' },
          variants: { Post: { value: 'post' } },
          relations: {
            posts: {
              to: relationCrossRef,
              cardinality: '1:N',
              on: { localFields: ['id'], targetFields: ['authorId'] },
            },
          },
          storage: {
            namespaceId: '__unbound__',
            table: 'user',
            fields: { kind: { column: 'kind' } },
          },
        },
        Post: {
          fields: {},
          relations: {},
          storage: { namespaceId: '__unbound__', table: 'user', fields: {} },
          base: baseCrossRef,
        },
      },
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {
                user: {
                  columns: {
                    kind: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
                  },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
                post: {
                  columns: {},
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
            },
          },
        },
      },
    });

    const serializer = new SqlContractSerializer();
    const hydrated = serializer.deserializeContract(JSON.parse(JSON.stringify(envelope)));
    const serialized = JSON.parse(JSON.stringify(serializer.serializeContract(hydrated)));

    expect(serialized.roots.users).toEqual(rootsCrossRef);
    const serializedModels = domainModelsAtDefaultNamespace(
      (serializer.deserializeContract(serialized) as Contract).domain,
    );
    expect(serializedModels['User']?.relations?.['posts']?.to).toEqual(relationCrossRef);
    expect(serializedModels['Post']?.base).toEqual(baseCrossRef);
  });
});
