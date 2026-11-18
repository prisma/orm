import type { MongoContract } from '@internal/mongo-contract';
import type { JsonObject } from '@internal/utils/json';
import { isStructuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import { MongoContractSerializerBase } from '../src/core/ir/mongo-contract-serializer-base';
import { mongoContractJson } from './mongo-contract-json-fixture';

function makeValidContractJson() {
  return mongoContractJson({});
}

interface Wrapped {
  readonly contract: MongoContract;
}

class RecordingSerializer extends MongoContractSerializerBase<Wrapped> {
  readonly constructed: unknown[] = [];

  protected constructTargetContract(validated: unknown): Wrapped {
    this.constructed.push(validated);
    return { contract: validated as MongoContract };
  }
}

describe('MongoContractSerializerBase', () => {
  describe('parseMongoContractStructure (family-shared structural + domain validation)', () => {
    it('accepts a structurally-valid contract envelope', () => {
      const serializer = new RecordingSerializer();
      const json = makeValidContractJson();

      const result = serializer.deserializeContract(json);

      expect(result.contract.targetFamily).toBe('mongo');
      expect(result.contract.domain.namespaces['__unbound__']!.models['Item']).toBeDefined();
    });

    it('rejects non-Mongo targetFamily', () => {
      const serializer = new RecordingSerializer();
      const json = { ...makeValidContractJson(), targetFamily: 'sql' };

      expect(() => serializer.deserializeContract(json)).toThrow();
    });

    it('structural rejection raises CONTRACT.VALIDATION_FAILED', () => {
      const serializer = new RecordingSerializer();
      const json = { ...makeValidContractJson(), targetFamily: 'sql' };

      try {
        serializer.deserializeContract(json);
        expect.fail('expected throw');
      } catch (e) {
        expect(isStructuredError(e)).toBe(true);
        if (!isStructuredError(e)) return;
        expect(e.code).toBe('CONTRACT.VALIDATION_FAILED');
      }
    });

    it('rejects when a model references a collection that does not exist in storage', () => {
      const serializer = new RecordingSerializer();
      const json = mongoContractJson({
        models: {
          Item: {
            fields: {
              _id: {
                type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
                nullable: false,
                many: false,
              },
            },
            storage: { fields: { _id: { field: '_id' } }, collection: 'missing_collection' },
            relations: {},
          },
        },
      });

      expect(() => serializer.deserializeContract(json)).toThrow(/missing_collection/);
    });

    describe('given a model field that holds a value object', () => {
      function contractJsonWith(storageValueObjects: Record<string, unknown>) {
        return mongoContractJson({
          models: {
            Item: {
              fields: {
                _id: {
                  type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
                  nullable: false,
                  many: false,
                },
                data: {
                  type: {
                    kind: 'valueObject',
                    plane: 'storage',
                    namespaceId: '__unbound__',
                    entityKind: 'valueObject',
                    entityName: 'Address',
                  },
                  nullable: false,
                  many: false,
                },
              },
              storage: {
                fields: { _id: { field: '_id' }, data: { field: 'data' } },
                collection: 'items',
              },
              relations: {},
            },
          },
          storageValueObjects,
        });
      }

      const address = {
        fields: {
          city: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
        },
      };

      it('accepts it when storage has the value object', () => {
        const result = new RecordingSerializer().deserializeContract(
          contractJsonWith({ Address: address }),
        );
        expect(result.contract.storage.namespaces['__unbound__']?.entries['valueObject']).toEqual({
          Address: {
            fields: {
              city: {
                type: { kind: 'scalar', codecId: 'mongo/string@1' },
                nullable: false,
                many: false,
              },
            },
          },
        });
      });

      it('refuses it when storage does not have the value object, naming the field and the coordinate', () => {
        expect(() => new RecordingSerializer().deserializeContract(contractJsonWith({}))).toThrow(
          'Model "__unbound__:Item" field "data" refers to value object "Address" in storage namespace "__unbound__", which storage.namespaces.__unbound__.entries.valueObject does not have',
        );
      });

      it('refuses a contract that stores value objects in the domain plane, and says to re-emit', () => {
        const json = contractJsonWith({ Address: address });
        const old = {
          ...json,
          domain: {
            namespaces: {
              __unbound__: { ...json.domain.namespaces['__unbound__'], valueObjects: {} },
            },
          },
        };
        expect(() => new RecordingSerializer().deserializeContract(old)).toThrow(
          'Contract structural validation failed: domain.namespaces.__unbound__.valueObjects: contracts no longer store value objects in the domain plane; they are storage entities under storage.namespaces.<namespace>.entries.valueObject, so re-emit the contract from its source, or rewrite a stored contract such as a migration snapshot with value-objects-in-storage.ts, which ships in the value-objects-in-storage scripts of the Prisma 8 upgrade guide',
        );
      });
    });

    it('rejects an unknown entries kind at hydration naming the kind and the namespace id', () => {
      const serializer = new RecordingSerializer();
      const json = makeValidContractJson();
      const storage = json.storage as {
        namespaces: Record<string, { id: string; entries: Record<string, unknown> }>;
      };
      const unbound = Object.values(storage.namespaces)[0]!;
      unbound.entries['bogus'] = { item: {} };

      expect(() => serializer.deserializeContract(json)).toThrow(/bogus/);
      expect(() => serializer.deserializeContract(json)).toThrow(
        new RegExp(unbound.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      );
    });

    it('only invokes constructTargetContract after structural + domain validation passes', () => {
      const serializer = new RecordingSerializer();
      const json = { ...makeValidContractJson(), targetFamily: 'sql' };

      try {
        serializer.deserializeContract(json);
      } catch {
        // expected
      }

      expect(serializer.constructed).toHaveLength(0);
    });
  });

  describe('constructTargetContract hook', () => {
    it('receives the validated contract value', () => {
      const serializer = new RecordingSerializer();

      serializer.deserializeContract(makeValidContractJson());

      expect(serializer.constructed).toHaveLength(1);
      const validated = serializer.constructed[0] as MongoContract;
      expect(validated.targetFamily).toBe('mongo');
    });
  });

  describe('serializeContract (default identity)', () => {
    it('returns the contract value as a JsonObject without copying', () => {
      const serializer = new RecordingSerializer();
      const wrapped: Wrapped = { contract: makeValidContractJson() as unknown as MongoContract };

      const serialized: JsonObject = serializer.serializeContract(wrapped);

      expect(serialized).toBe(wrapped as unknown as JsonObject);
    });
  });
});
