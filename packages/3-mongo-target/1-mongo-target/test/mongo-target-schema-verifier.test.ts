import { UNBOUND_DOMAIN_NAMESPACE_ID } from '@internal/contract/types';
import { issueOutcome } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { MongoSchemaIR } from '@internal/mongo-schema-ir';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { MongoTargetSchemaVerifier } from '../src/core/migrations/mongo-target-schema-verifier';
import { MongoTargetContractSerializer } from '../src/core/mongo-target-contract-serializer';

function deserializedContract() {
  const json = {
    targetFamily: 'mongo' as const,
    target: 'mongo',
    profileHash: 'test',
    roots: { items: { namespace: UNBOUND_NAMESPACE_ID, model: 'Item' } },
    storage: {
      storageHash: 'test',
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: {
          id: UNBOUND_NAMESPACE_ID,
          kind: 'mongo-database',
          entries: {
            collection: {
              items: {},
            },
          },
        },
      },
    },
    domain: applicationDomainOf({
      models: {
        Item: {
          fields: {
            _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false },
          },
          relations: {},
          storage: { collection: 'items' },
        },
      },
      namespaceId: UNBOUND_DOMAIN_NAMESPACE_ID,
    }),
  };
  return new MongoTargetContractSerializer().deserializeContract(json);
}

describe('MongoTargetSchemaVerifier', () => {
  it('returns ok=true with no issues for an empty contract against an empty schema', () => {
    const verifier = new MongoTargetSchemaVerifier();
    const json = {
      targetFamily: 'mongo' as const,
      target: 'mongo',
      profileHash: 'test',
      roots: {},
      storage: {
        storageHash: 'test',
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            kind: 'mongo-database',
            entries: { collection: {} },
          },
        },
      },
      domain: applicationDomainOf({ models: {}, namespaceId: UNBOUND_DOMAIN_NAMESPACE_ID }),
    };
    const contract = new MongoTargetContractSerializer().deserializeContract(json);
    const schema = new MongoSchemaIR([]);

    const result = verifier.verifySchema({ contract, schema });

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('flags a missing collection against a contract that declares one', () => {
    const verifier = new MongoTargetSchemaVerifier();
    const contract = deserializedContract();
    const schema = new MongoSchemaIR([]);

    const result = verifier.verifySchema({ contract, schema });

    expect(result.ok).toBe(false);
    expect(
      result.issues.some((i) => issueOutcome(i) === 'not-found' && i.path[0] === 'items'),
    ).toBe(true);
  });

  it('uses the family-shared scaffolding: walks each namespace and aggregates issues', () => {
    const verifier = new MongoTargetSchemaVerifier();
    const contract = deserializedContract();
    expect(Object.keys(contract.storage.namespaces)).toEqual(['__unbound__']);

    const result = verifier.verifySchema({ contract, schema: new MongoSchemaIR([]) });
    expect(result).toBeDefined();
    expect(Array.isArray(result.issues)).toBe(true);
  });
});
