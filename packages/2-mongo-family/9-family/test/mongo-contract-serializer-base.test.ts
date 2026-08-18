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
            storage: { collection: 'missing_collection' },
            relations: {},
          },
        },
      });

      expect(() => serializer.deserializeContract(json)).toThrow(/missing_collection/);
    });

    it('rejects when a field references a value object that does not exist', () => {
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
              data: {
                type: { kind: 'valueObject', name: 'Missing' },
                nullable: false,
                many: false,
              },
            },
            storage: { collection: 'items' },
            relations: {},
          },
        },
      });

      expect(() => serializer.deserializeContract(json)).toThrow();
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
