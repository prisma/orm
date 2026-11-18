import type { Contract, NamespaceId, StorageHashBase } from '@internal/contract/types';
import type { ContractWithTypeMaps, TypeMaps } from '@internal/sql-contract/types';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { describe, expectTypeOf, test } from 'vitest';
import { Collection } from '../src/collection';
import { createMockRuntime } from './helpers';

type TaskCodecTypes = {
  'pg/int4@1': { output: number; input: number; traits: 'equality' | 'order' | 'numeric' };
  'pg/text@1': { output: string; input: string; traits: 'equality' | 'order' | 'textual' };
};

type IntColumn = {
  readonly many: false;
  dataType: 'pg/int4';
  codecId: 'pg/int4@1';
  nullable: false;
};

type TextColumn = {
  readonly many: false;
  dataType: 'pg/text';
  codecId: 'pg/text@1';
  nullable: false;
};

type TaskStorage = {
  storageHash: StorageHashBase<string>;
  namespaces: {
    public: {
      id: 'public';
      kind: 'schema';
      entries: {
        table: {
          tasks: {
            columns: { id: IntColumn; title: TextColumn; type: TextColumn };
            primaryKey: { columns: ['id'] };
            uniques: [];
            indexes: [];
            foreignKeys: [];
          };
          chores: {
            columns: { id: IntColumn };
            primaryKey: { columns: ['id'] };
            uniques: [];
            indexes: [];
            foreignKeys: [];
          };
        };
      };
    };
  };
};

type ScalarField<CodecId extends string> = {
  readonly nullable: false;
  readonly type: { readonly kind: 'scalar'; readonly codecId: CodecId };
};

type TaskContract = ContractWithTypeMaps<
  Omit<Contract<TaskStorage>, 'domain'> & {
    readonly domain: {
      readonly namespaces: {
        readonly public: {
          readonly models: {
            readonly Task: {
              readonly fields: {
                readonly id: ScalarField<'pg/int4@1'>;
                readonly title: ScalarField<'pg/text@1'>;
                readonly type: ScalarField<'pg/text@1'>;
              };
              readonly relations: Record<string, never>;
              readonly storage: {
                readonly table: 'tasks';
                readonly namespaceId: 'public';
                readonly fields: {
                  readonly id: { readonly column: 'id' };
                  readonly title: { readonly column: 'title' };
                  readonly type: { readonly column: 'type' };
                };
              };
              readonly discriminator: { readonly field: 'type' };
              readonly variants: {
                readonly chore: {
                  readonly namespace: 'public' & NamespaceId;
                  readonly model: 'Chore';
                };
              };
            };
            readonly Chore: {
              readonly fields: Record<never, never>;
              readonly relations: Record<string, never>;
              readonly storage: {
                readonly table: 'chores';
                readonly namespaceId: 'public';
                readonly fields: Record<never, never>;
              };
              readonly base: { readonly namespace: 'public' & NamespaceId; readonly model: 'Task' };
            };
          };
        };
      };
    };
  },
  TypeMaps<
    TaskCodecTypes,
    Record<string, never>,
    {
      readonly public: {
        readonly Chore: Record<never, never>;
        readonly Task: { readonly id: number; readonly title: string; readonly type: string };
      };
    },
    {
      readonly public: {
        readonly Chore: Record<string, never>;
        readonly Task: { readonly id: number; readonly title: string; readonly type: string };
      };
    }
  >
>;

const context = {} as unknown as ExecutionContext<TaskContract>;
const tasks = new Collection({ runtime: createMockRuntime(), context }, 'Task', {
  namespaceId: 'public',
});
const chores = tasks.variant('chore');

describe('a variant with no fields of its own', () => {
  test('its row has the fields it inherits', async () => {
    const [chore] = await chores.all().toArray();
    expectTypeOf<keyof NonNullable<typeof chore>>().toEqualTypeOf<'id' | 'title' | 'type'>();
  });

  test('its create takes the fields it inherits and rejects any other key', () => {
    chores.create({ id: 1, title: 'Sweep' });
    chores.createAll([{ id: 1, title: 'Sweep' }]);
    chores.createAndCount([{ id: 1, title: 'Sweep' }]);
    // @ts-expect-error the variant has no field `legacy_key`
    chores.create({ id: 1, title: 'Sweep', legacy_key: 'x' });
    // @ts-expect-error the variant has no field `legacy_key`
    chores.createAndCount([{ id: 1, title: 'Sweep', legacy_key: 'x' }]);
  });
});
