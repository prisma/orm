import type { CrossReference, ProfileHashBase, StorageHashBase } from '@internal/contract/types';
import type {
  MongoContractWithTypeMaps,
  MongoCollection as MongoStorageCollection,
  MongoTypeMaps,
} from '@internal/mongo-contract';
import { expectTypeOf, test } from 'vitest';
import type { MongoCollection } from '../src/collection';
import type { DefaultModelRow } from '../src/types';

type LegacyTypeMaps = MongoTypeMaps<
  { readonly 'mongo/string@1': { readonly input: string; readonly output: string } },
  { readonly __unbound__: { readonly Legacy: Record<never, never> } },
  { readonly __unbound__: { readonly Legacy: Record<string, never> } }
>;

type LegacyContract = MongoContractWithTypeMaps<
  {
    readonly target: 'mongo';
    readonly targetFamily: 'mongo';
    readonly profileHash: ProfileHashBase<'test'>;
    readonly capabilities: Record<string, never>;
    readonly extensions: Record<string, never>;
    readonly meta: Record<string, never>;
    readonly roots: { readonly legacy: CrossReference & { readonly model: 'Legacy' } };
    readonly domain: {
      readonly namespaces: {
        readonly __unbound__: {
          readonly models: {
            readonly Legacy: {
              readonly fields: Record<never, never>;
              readonly relations: Record<string, never>;
              readonly storage: {
                readonly collection: 'legacy';
                readonly fields: Record<string, never>;
              };
            };
          };
        };
      };
    };
    readonly storage: {
      readonly storageHash: StorageHashBase<'test-storage'>;
      readonly namespaces: {
        readonly __unbound__: {
          readonly id: '__unbound__';
          readonly kind: 'mongo-namespace';
          readonly entries: { readonly collection: { readonly legacy: MongoStorageCollection } };
        };
      };
    };
  },
  LegacyTypeMaps
>;

declare const legacy: MongoCollection<LegacyContract, 'Legacy'>;
const unknownKey = { legacy_key: 'x' };

test('a row of a model with no fields has no keys', () => {
  expectTypeOf<keyof DefaultModelRow<LegacyContract, 'Legacy'>>().toEqualTypeOf<never>();
});

test('every update of a model with no fields rejects a key', () => {
  // @ts-expect-error a model with no fields has no key to write
  legacy.update(unknownKey);
  // @ts-expect-error a model with no fields has no key to write
  legacy.updateAll(unknownKey);
  // @ts-expect-error a model with no fields has no key to write
  legacy.updateAndCount(unknownKey);
  // @ts-expect-error a model with no fields has no key to write
  legacy.upsert({ create: {}, update: unknownKey });
});

test('every update of a model with no fields accepts an empty input', () => {
  legacy.update({});
  legacy.updateAll({});
  legacy.updateAndCount({});
  legacy.upsert({ create: {}, update: {} });
});
