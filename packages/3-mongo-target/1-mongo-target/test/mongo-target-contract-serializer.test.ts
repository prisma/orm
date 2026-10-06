import { effectiveControlPolicy, UNBOUND_DOMAIN_NAMESPACE_ID } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  MongoCollationOptions,
  MongoCollection,
  MongoCollectionOptions,
  MongoIndex,
  MongoStorage,
  MongoValidator,
  MongoValueSet,
} from '@internal/mongo-contract';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { MongoTargetContractSerializer } from '../src/core/mongo-target-contract-serializer';
import { MongoTargetUnboundDatabase } from '../src/core/mongo-target-database';

function makeSingletonUnboundContractJson() {
  return {
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
}

function makeValidContractJson() {
  return {
    targetFamily: 'mongo' as const,
    target: 'mongo',
    profileHash: 'test',
    roots: { items: { model: 'Item', namespace: UNBOUND_NAMESPACE_ID } },
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
            _id: {
              type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
              nullable: false,
              many: false,
            },
          },
          relations: {},
          storage: { collection: 'items' },
        },
      },
      namespaceId: UNBOUND_DOMAIN_NAMESPACE_ID,
    }),
  };
}

describe('MongoTargetContractSerializer', () => {
  it('deserializes a valid contract into the MongoTarget class hierarchy', () => {
    const serializer = new MongoTargetContractSerializer();
    const contract = serializer.deserializeContract(makeValidContractJson());

    expect(contract.targetFamily).toBe('mongo');
    expect(contract.storage).toBeInstanceOf(MongoStorage);
  });

  it('default storage carries the __unbound__ singleton namespace', () => {
    const serializer = new MongoTargetContractSerializer();
    const contract = serializer.deserializeContract(makeSingletonUnboundContractJson());

    expect(contract.storage.namespaces['__unbound__']).toBe(MongoTargetUnboundDatabase.instance);
  });

  it('hydrates collections into MongoCollection IR-class instances', () => {
    const serializer = new MongoTargetContractSerializer();
    const contract = serializer.deserializeContract(makeValidContractJson());

    const ns = contract.storage.namespaces[UNBOUND_NAMESPACE_ID];
    expect(ns).toBeDefined();
    const items = ns!.entries.collection?.['items'];
    expect(items).toBeInstanceOf(MongoCollection);
    expect(items?.kind).toBe('mongo-collection');
  });

  it('rejects an invalid contract (family-shared structural validation runs)', () => {
    const serializer = new MongoTargetContractSerializer();
    const bad = { ...makeValidContractJson(), targetFamily: 'sql' };
    expect(() => serializer.deserializeContract(bad)).toThrow();
  });

  it('fails closed at hydration: an unregistered entries kind throws naming the kind', () => {
    const serializer = new MongoTargetContractSerializer();
    const json = makeValidContractJson();
    const ns = json.storage.namespaces[UNBOUND_NAMESPACE_ID] as {
      entries: Record<string, unknown>;
    };
    ns.entries['bogus'] = { Foo: {} };
    expect(() => serializer.deserializeContract(json)).toThrow(/bogus/);
  });

  it('serializeContract emits canonical nested namespaces on disk', () => {
    const serializer = new MongoTargetContractSerializer();
    const contract = serializer.deserializeContract(makeValidContractJson());
    const json = serializer.serializeContract(contract) as {
      storage: Record<string, unknown>;
    };
    expect(json.storage).toHaveProperty('namespaces');
    expect(json.storage).not.toHaveProperty('collections');
    const namespaces = json.storage['namespaces'] as Record<
      string,
      { entries: { collection: Record<string, unknown> } }
    >;
    expect(namespaces[UNBOUND_NAMESPACE_ID]?.entries.collection['items']).toMatchObject({
      kind: 'mongo-collection',
    });
  });

  describe('JSON round-trip fidelity', () => {
    function makeFullyPopulatedJson() {
      return {
        targetFamily: 'mongo' as const,
        target: 'mongo',
        profileHash: 'test',
        roots: { items: { model: 'Item', namespace: UNBOUND_NAMESPACE_ID } },
        storage: {
          storageHash: 'test',
          namespaces: {
            [UNBOUND_NAMESPACE_ID]: {
              id: UNBOUND_NAMESPACE_ID,
              kind: 'mongo-database',
              entries: {
                collection: {
                  items: {
                    indexes: [
                      {
                        keys: [{ field: 'email', direction: 1 as const }],
                        unique: true,
                        collation: { locale: 'en', strength: 2 },
                      },
                    ],
                    validator: {
                      jsonSchema: { type: 'object' },
                      validationLevel: 'strict' as const,
                      validationAction: 'error' as const,
                    },
                    options: {
                      collation: { locale: 'en', strength: 2 },
                      changeStreamPreAndPostImages: { enabled: true },
                    },
                  },
                },
              },
            },
          },
        },
        domain: applicationDomainOf({
          models: {
            Item: {
              fields: {
                _id: {
                  type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
                  nullable: false,
                  many: false,
                },
              },
              relations: {},
              storage: { collection: 'items' },
            },
          },
          namespaceId: UNBOUND_DOMAIN_NAMESPACE_ID,
        }),
      };
    }

    it('deserialised collection carries instanceof for each IR class kind', () => {
      const serializer = new MongoTargetContractSerializer();
      const contract = serializer.deserializeContract(makeFullyPopulatedJson());

      const ns = contract.storage.namespaces[UNBOUND_NAMESPACE_ID];
      expect(ns).toBeDefined();
      const items = ns!.entries.collection?.['items'];
      expect(items).toBeInstanceOf(MongoCollection);
      expect(items?.indexes?.[0]).toBeInstanceOf(MongoIndex);
      expect(items?.validator).toBeInstanceOf(MongoValidator);
      expect(items?.options).toBeInstanceOf(MongoCollectionOptions);
      expect(items?.options?.collation).toBeInstanceOf(MongoCollationOptions);
    });

    function makeMixedControlJson() {
      return {
        targetFamily: 'mongo' as const,
        target: 'mongo',
        profileHash: 'test',
        defaultControlPolicy: 'tolerated' as const,
        roots: {
          items: { model: 'Item', namespace: UNBOUND_NAMESPACE_ID },
          events: { model: 'Event', namespace: UNBOUND_NAMESPACE_ID },
        },
        storage: {
          storageHash: 'test',
          namespaces: {
            [UNBOUND_NAMESPACE_ID]: {
              id: UNBOUND_NAMESPACE_ID,
              kind: 'mongo-database',
              entries: {
                collection: {
                  items: { control: 'external' as const },
                  events: {},
                },
              },
            },
          },
        },
        domain: applicationDomainOf({
          models: {
            Item: {
              fields: {
                _id: {
                  type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
                  nullable: false,
                  many: false,
                },
              },
              relations: {},
              storage: { collection: 'items' },
            },
            Event: {
              fields: {
                _id: {
                  type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
                  nullable: false,
                  many: false,
                },
              },
              relations: {},
              storage: { collection: 'events' },
            },
          },
          namespaceId: UNBOUND_DOMAIN_NAMESPACE_ID,
        }),
      };
    }

    it('preserves effective control per collection across serialize → deserialize', () => {
      const serializer = new MongoTargetContractSerializer();
      const contract = serializer.deserializeContract(makeMixedControlJson());
      const reparsed = JSON.parse(JSON.stringify(serializer.serializeContract(contract)));

      expect(reparsed.defaultControlPolicy).toBe('tolerated');

      const collections = reparsed.storage.namespaces[UNBOUND_NAMESPACE_ID].entries.collection;
      const def = reparsed.defaultControlPolicy;
      expect(effectiveControlPolicy(collections.items.control, def)).toBe('external');
      expect(effectiveControlPolicy(collections.events.control, def)).toBe('tolerated');
      expect(collections.events).not.toHaveProperty('control');
    });

    it('serialise(deserialise(json)) produces canonically equivalent JSON', () => {
      const json = makeFullyPopulatedJson();
      const serializer = new MongoTargetContractSerializer();
      const contract = serializer.deserializeContract(json);
      const out = serializer.serializeContract(contract);

      const reparsed = JSON.parse(JSON.stringify(out));
      const items = reparsed.storage.namespaces[UNBOUND_NAMESPACE_ID].entries.collection.items;
      expect(items.kind).toBe('mongo-collection');
      expect(items.indexes[0].kind).toBe('mongo-index');
      expect(items.validator.kind).toBe('mongo-validator');
      expect(items.options.kind).toBe('mongo-collection-options');
      expect(items.options.collation.kind).toBe('mongo-collation-options');

      const roundtripped = serializer.deserializeContract(reparsed);
      const roundtrippedNs = roundtripped.storage.namespaces[UNBOUND_NAMESPACE_ID];
      expect(roundtrippedNs).toBeDefined();
      expect(roundtrippedNs!.entries.collection?.['items']).toBeInstanceOf(MongoCollection);
    });
  });

  describe('entries.valueSet round-trip', () => {
    function makeValueSetContractJson() {
      const base = makeValidContractJson();
      const ns = base.storage.namespaces[UNBOUND_NAMESPACE_ID] as {
        entries: Record<string, unknown>;
      };
      ns.entries['valueSet'] = {
        Role: { kind: 'valueSet', values: ['admin', 'author', 'reader'] },
      };
      return base;
    }

    it('hydrates entries.valueSet into MongoValueSet IR instances (deserialize)', () => {
      const serializer = new MongoTargetContractSerializer();
      const contract = serializer.deserializeContract(makeValueSetContractJson());
      const ns = contract.storage.namespaces[UNBOUND_NAMESPACE_ID];
      const roleVs = ns!.entries.valueSet?.['Role'];
      expect(roleVs).toBeInstanceOf(MongoValueSet);
      expect(roleVs?.values).toEqual(['admin', 'author', 'reader']);
    });

    it('serializes entries.valueSet back to JSON with values intact (serialize)', () => {
      const serializer = new MongoTargetContractSerializer();
      const contract = serializer.deserializeContract(makeValueSetContractJson());
      const out = JSON.parse(JSON.stringify(serializer.serializeContract(contract)));
      const entries = out.storage.namespaces[UNBOUND_NAMESPACE_ID].entries;
      expect(entries.valueSet).toEqual({
        Role: { kind: 'valueSet', values: ['admin', 'author', 'reader'] },
      });
    });

    it('survives a full serialize → deserialize cycle with the value set intact (both directions)', () => {
      const serializer = new MongoTargetContractSerializer();
      const contract = serializer.deserializeContract(makeValueSetContractJson());
      const reparsed = JSON.parse(JSON.stringify(serializer.serializeContract(contract)));
      const roundtripped = serializer.deserializeContract(reparsed);
      const ns = roundtripped.storage.namespaces[UNBOUND_NAMESPACE_ID];
      const roleVs = ns!.entries.valueSet?.['Role'];
      expect(roleVs).toBeInstanceOf(MongoValueSet);
      expect(roleVs?.values).toEqual(['admin', 'author', 'reader']);
    });
  });
});
