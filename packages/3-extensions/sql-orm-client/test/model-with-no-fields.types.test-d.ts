import type { Contract, StorageHashBase } from '@internal/contract/types';
import type { ContractWithTypeMaps, TypeMaps } from '@internal/sql-contract/types';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { describe, expectTypeOf, test } from 'vitest';
import { Collection } from '../src/collection';
import type {
  DefaultModelRow,
  MutationUpdateInput,
  ResolvedCreateInput,
  ScalarUpdateInput,
} from '../src/types';
import { defineContract, model } from './contract-builder';
import { createMockRuntime } from './helpers';

type LegacyCodecTypes = {
  'pg/text@1': { output: string; input: string; traits: 'equality' | 'order' | 'textual' };
};

type LegacyStorage = {
  storageHash: StorageHashBase<string>;
  namespaces: {
    __unbound__: {
      id: '__unbound__';
      kind: 'schema';
      entries: {
        table: {
          legacy_rows: {
            columns: {
              legacy_key: {
                readonly many: false;
                dataType: 'pg/text';
                codecId: 'pg/text@1';
                nullable: false;
              };
            };
            uniques: [];
            indexes: [];
            foreignKeys: [];
          };
        };
      };
    };
  };
};

type EmittedLegacyContract = ContractWithTypeMaps<
  Omit<Contract<LegacyStorage>, 'domain'> & {
    readonly domain: {
      readonly namespaces: {
        readonly __unbound__: {
          readonly models: {
            readonly Legacy: {
              readonly fields: Record<never, never>;
              readonly relations: Record<string, never>;
              readonly storage: {
                readonly table: 'legacy_rows';
                readonly fields: Record<never, never>;
              };
            };
          };
        };
      };
    };
  },
  TypeMaps<
    LegacyCodecTypes,
    Record<string, never>,
    { readonly __unbound__: { readonly Legacy: Record<never, never> } },
    { readonly __unbound__: { readonly Legacy: Record<string, never> } }
  >
>;

const emittedContext = {} as unknown as ExecutionContext<EmittedLegacyContract>;
const emittedLegacy = new Collection(
  { runtime: createMockRuntime(), context: emittedContext },
  'Legacy',
  {
    namespaceId: '__unbound__',
  },
);

const noEmitContract = defineContract({
  models: { Legacy: model('Legacy', { fields: {} }).sql({ table: 'legacy_rows' }) },
});
type NoEmitLegacyContract = typeof noEmitContract;
const noEmitContext = {} as unknown as ExecutionContext<NoEmitLegacyContract>;
const noEmitLegacy = new Collection(
  { runtime: createMockRuntime(), context: noEmitContext },
  'Legacy',
  {
    namespaceId: 'public',
  },
);

const unknownKey = { legacy_key: 'x' };

describe('a model with no fields, from an emitted contract', () => {
  test('its row has no keys', async () => {
    const [row] = await emittedLegacy.all().toArray();
    expectTypeOf<keyof NonNullable<typeof row>>().toEqualTypeOf<never>();
    expectTypeOf<keyof DefaultModelRow<EmittedLegacyContract, 'Legacy'>>().toEqualTypeOf<never>();
    // @ts-expect-error a model with no fields has no key to read
    row?.legacy_key;
  });

  test('every create rejects a key', () => {
    // @ts-expect-error a model with no fields has no key to write
    emittedLegacy.create(unknownKey);
    // @ts-expect-error a model with no fields has no key to write
    emittedLegacy.createAll([unknownKey]);
    // @ts-expect-error a model with no fields has no key to write
    emittedLegacy.createAndCount([unknownKey]);
    // @ts-expect-error a model with no fields has no key to write
    emittedLegacy.where({}).upsert({ create: unknownKey, update: {} });
    // @ts-expect-error a model with no fields has no key to write
    const create: ResolvedCreateInput<EmittedLegacyContract, 'Legacy', undefined> = unknownKey;
    expectTypeOf(create).not.toBeAny();
  });

  test('every update rejects a key', () => {
    const matching = emittedLegacy.where({});
    // @ts-expect-error a model with no fields has no key to write
    matching.update(unknownKey);
    // @ts-expect-error a model with no fields has no key to write
    matching.updateAll(unknownKey);
    // @ts-expect-error a model with no fields has no key to write
    matching.updateAndCount(unknownKey);
    // @ts-expect-error a model with no fields has no key to write
    matching.upsert({ create: {}, update: unknownKey });
    // @ts-expect-error a model with no fields has no key to write
    const update: MutationUpdateInput<EmittedLegacyContract, 'Legacy'> = unknownKey;
    expectTypeOf(update).not.toBeAny();
  });

  test('every create and update accepts an empty input', () => {
    emittedLegacy.create({});
    emittedLegacy.createAll([{}]);
    emittedLegacy.createAndCount([{}]);
    const matching = emittedLegacy.where({});
    matching.update({});
    matching.updateAll({});
    matching.updateAndCount({});
    matching.upsert({ create: {}, update: {} });
  });

  test('a helper generic over the model passes a ScalarUpdateInput to updateAll and updateAndCount', () => {
    function updateEvery<M extends 'Legacy'>(
      rows: Collection<EmittedLegacyContract, M>,
      data: ScalarUpdateInput<EmittedLegacyContract, M>,
    ) {
      const matching = rows.where({});
      matching.updateAll(data);
      return matching.updateAndCount(data);
    }
    expectTypeOf(updateEvery<'Legacy'>)
      .parameter(1)
      .toEqualTypeOf<Record<string, never>>();
  });
});

describe('a model with no fields, from a contract that is not emitted', () => {
  test('its row has no keys', async () => {
    const [row] = await noEmitLegacy.all().toArray();
    expectTypeOf<keyof NonNullable<typeof row>>().toEqualTypeOf<never>();
    // @ts-expect-error a model with no fields has no key to read
    row?.legacy_key;
  });

  test('every create rejects a key', () => {
    // @ts-expect-error a model with no fields has no key to write
    noEmitLegacy.create(unknownKey);
    // @ts-expect-error a model with no fields has no key to write
    noEmitLegacy.createAll([unknownKey]);
    // @ts-expect-error a model with no fields has no key to write
    noEmitLegacy.createAndCount([unknownKey]);
  });

  test('every update rejects a key', () => {
    const matching = noEmitLegacy.where({});
    // @ts-expect-error a model with no fields has no key to write
    matching.update(unknownKey);
    // @ts-expect-error a model with no fields has no key to write
    matching.updateAll(unknownKey);
    // @ts-expect-error a model with no fields has no key to write
    matching.updateAndCount(unknownKey);
    // @ts-expect-error a model with no fields has no key to write
    matching.upsert({ create: {}, update: unknownKey });
  });

  test('every create and update accepts an empty input', () => {
    noEmitLegacy.create({});
    noEmitLegacy.createAll([{}]);
    noEmitLegacy.createAndCount([{}]);
    const matching = noEmitLegacy.where({});
    matching.update({});
    matching.updateAll({});
    matching.updateAndCount({});
    matching.upsert({ create: {}, update: {} });
  });
});
