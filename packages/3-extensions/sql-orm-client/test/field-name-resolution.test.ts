import { describe, expect, it } from 'vitest';
import { Collection } from '../src/collection';
import { resolveIncludeRelation } from '../src/collection-contract';
import { compileSelect } from '../src/query-plan-select';
import type { CollectionState } from '../src/types';
import { createCollectionFor, createReturningCollectionFor } from './collection-fixtures';
import {
  buildMixedPolyContract,
  createMockRuntime,
  fieldUnknown,
  getTestContext,
  getTestContract,
  withPatchedDomainModels,
} from './helpers';

const notAField = fieldUnknown('User', 'invited_by_id');

async function settle(run: () => unknown): Promise<unknown> {
  return await run();
}

/** Every surface below names `invited_by_id`, the column behind field `invitedById`, which is not itself a field. */
describe('a name that is not a field of the model', () => {
  it('is refused by where shorthand', () => {
    const { collection } = createCollectionFor('User');
    expect(() => collection.where({ invited_by_id: 1 } as never)).toThrow(notAField);
  });

  it('is refused by the where callback accessor', () => {
    const { collection } = createCollectionFor('User');
    expect(() =>
      collection.where((user) =>
        (user as never as Record<string, { eq(v: number): never }>)['invited_by_id']!.eq(1),
      ),
    ).toThrow(notAField);
  });

  it('is refused by the orderBy callback accessor', () => {
    const { collection } = createCollectionFor('User');
    expect(() =>
      collection.orderBy((user) =>
        (user as never as Record<string, { asc(): never }>)['invited_by_id']!.asc(),
      ),
    ).toThrow(notAField);
  });

  it('is refused by select, distinct, distinctOn, groupBy and cursor', () => {
    const { collection } = createCollectionFor('User');
    const name = 'invited_by_id' as never;
    expect(() => collection.select(name)).toThrow(notAField);
    expect(() => collection.distinct(name)).toThrow(notAField);
    expect(() => collection.orderBy((u) => u.id.asc()).distinctOn(name)).toThrow(notAField);
    expect(() => collection.groupBy(name)).toThrow(notAField);
    expect(() =>
      collection.orderBy((u) => u.id.asc()).cursor({ invited_by_id: 1 } as never),
    ).toThrow(notAField);
  });

  it('is refused by aggregates and having', async () => {
    const { collection } = createCollectionFor('User');
    await expect(
      settle(() =>
        collection.aggregate((aggregate) => ({ total: aggregate.sum('invited_by_id' as never) })),
      ),
    ).rejects.toThrow(notAField);
    expect(() =>
      collection.groupBy('name').having((having) => having.sum('invited_by_id' as never).gt(1)),
    ).toThrow(notAField);
  });

  it('is refused by create, update and upsert data', async () => {
    const { collection } = createReturningCollectionFor('User');
    await expect(
      settle(() =>
        collection.create({ id: 1, name: 'A', email: 'a@b', invited_by_id: 2 } as never),
      ),
    ).rejects.toThrow(notAField);
    await expect(
      settle(() => collection.where({ id: 1 }).update({ invited_by_id: 2 } as never)),
    ).rejects.toThrow(notAField);
    await expect(
      settle(() =>
        collection.upsert({
          create: { id: 1, name: 'A', email: 'a@b' },
          update: { invited_by_id: 2 } as never,
        }),
      ),
    ).rejects.toThrow(notAField);
    await expect(
      settle(() =>
        collection.upsert({
          create: { id: 1, name: 'A', email: 'a@b' },
          update: { name: 'B' },
          conflictOn: { invited_by_id: 2 } as never,
        }),
      ),
    ).rejects.toThrow(notAField);
  });

  it('is refused by an include nested select and an include scalar reducer', () => {
    const { collection } = createCollectionFor('User');
    expect(() => collection.include('posts', (posts) => posts.select('user_id' as never))).toThrow(
      fieldUnknown('Post', 'user_id'),
    );
    expect(() => collection.include('posts', (posts) => posts.sum('user_id' as never))).toThrow(
      fieldUnknown('Post', 'user_id'),
    );
  });

  it('is refused by a relation filter', () => {
    const { collection } = createCollectionFor('User');
    expect(() => collection.where((user) => user.posts.some({ user_id: 1 } as never))).toThrow(
      fieldUnknown('Post', 'user_id'),
    );
  });

  it('is refused as a relation join field', () => {
    const contract = withPatchedDomainModels(getTestContract(), (models) => {
      const user = models['User'] as { relations: Record<string, { on: unknown }> };
      return {
        ...models,
        User: {
          ...user,
          relations: {
            ...user.relations,
            posts: {
              ...user.relations['posts'],
              on: { localFields: ['id'], targetFields: ['user_id'] },
            },
          },
        },
      };
    });
    expect(() => resolveIncludeRelation(contract, 'public', 'User', 'posts')).toThrow(
      fieldUnknown('Post', 'user_id'),
    );
  });
});

describe('a name that is not a field of the variant in scope', () => {
  function polyCollection() {
    const contract = buildMixedPolyContract();
    const runtime = createMockRuntime();
    const context = {
      ...getTestContext(),
      contract: {
        ...contract,
        capabilities: { ...contract.capabilities, returning: { enabled: true } },
      },
    };
    return new Collection({ runtime, context } as never, 'Task', { namespaceId: 'public' });
  }

  it('is refused by a single-table variant create', async () => {
    const bugs = polyCollection().variant('bug' as never) as unknown as {
      create(data: Record<string, unknown>): Promise<unknown>;
    };
    await expect(settle(() => bugs.create({ title: 'T', priority: 1 }))).rejects.toThrow(
      fieldUnknown('Bug', 'priority'),
    );
  });

  it('is refused by a multi-table variant create', async () => {
    const features = polyCollection().variant('feature' as never) as unknown as {
      create(data: Record<string, unknown>): Promise<unknown>;
    };
    await expect(settle(() => features.create({ title: 'T', severity: 'high' }))).rejects.toThrow(
      fieldUnknown('Feature', 'severity'),
    );
  });

  it('is refused by select on a narrowed collection', () => {
    const bugs = polyCollection().variant('bug' as never) as unknown as {
      select(...fields: string[]): unknown;
    };
    expect(() => bugs.select('priority')).toThrow(fieldUnknown('Task', 'priority'));
  });

  it('cannot reach the polymorphic projection as a column name', () => {
    const contract = buildMixedPolyContract();
    const state = { selectedFields: ['parent_id_extra'] } as unknown as CollectionState;
    expect(() =>
      compileSelect(contract, 'public', 'tasks', { ...emptyState(), ...state }, 'Task'),
    ).toThrow('Selected column "parent_id_extra" is mapped by no field of model "Task"');
  });
});

function emptyState(): CollectionState {
  const { collection } = createCollectionFor('User');
  return collection.state;
}
