import { defineAnnotation, type MetaBuilder } from '@internal/framework-components/runtime';
import { describe, expect, it } from 'vitest';
import type { MockRuntime } from './helpers';
import {
  createActivityCollectionFor,
  fakePlanHash,
  ormCallHash,
  type RecordedCall,
  statementAnnotationNamespaces,
} from './orm-call-fixtures';

const cache = defineAnnotation<{ ttl: number }>()({ namespace: 'cache', applicableTo: ['read'] });
const audit = defineAnnotation<{ actor: string }>()({
  namespace: 'audit',
  applicableTo: ['write'],
});
const cached = (meta: MetaBuilder<'read'>) => meta.annotate(cache({ ttl: 60 }));
const audited = (meta: MetaBuilder<'write'>) => meta.annotate(audit({ actor: 'system' }));
const userIdentity = { namespace: 'public', model: 'User' };

const alice = { id: 1, name: 'Alice', email: 'a@b.com' };
const aliceRow = { id: 1, name: 'Alice', email: 'a@b.com', invited_by_id: null, address: null };
const aliceModel = { id: 1, name: 'Alice', email: 'a@b.com', invitedById: null, address: null };

interface Recorded {
  readonly calls: readonly RecordedCall[];
  readonly outside: readonly unknown[];
  readonly runtime: MockRuntime;
}

/** One summary per call, and whether every statement went through a call and carried none of its annotations. */
function summary({ calls, outside, runtime }: Recorded) {
  return {
    calls: calls.map(({ activity, statements, transactions, ended }) => ({
      kind: activity.kind,
      annotations: [...activity.annotations.keys()],
      statements: statements.length,
      transactions,
      ended,
    })),
    outside: outside.length,
    statementAnnotations: statementAnnotationNamespaces(runtime),
  };
}

function oneCall(
  annotations: string[],
  statements: number,
  ended: unknown,
  transactions: string[] = [],
) {
  return {
    calls: [{ kind: 'orm-call', annotations, statements, transactions, ended }],
    outside: 0,
    statementAnnotations: [],
  };
}

describe('read terminals run as one orm-call', () => {
  it('all() hashes its plan, sends it through the call and ends with the rows', async () => {
    const recorded = createActivityCollectionFor('User');
    recorded.runtime.setNextResults([[aliceRow]]);

    const rows = await recorded.collection.all(cached);

    expect(rows).toEqual([aliceModel]);
    expect(summary(recorded)).toEqual(
      oneCall(['cache'], 1, { outcome: 'succeeded', result: [aliceModel] }),
    );
    const contentHash = await recorded.calls[0]!.activity.contentHash();
    expect({
      hashed: recorded.hashed[0] === recorded.calls[0]!.statements[0],
      contentHash,
    }).toEqual({ hashed: true, contentHash: await ormCallHash('all', fakePlanHash) });
  });

  it('a read that no middleware asks for its content hash never hashes its plan', async () => {
    const recorded = createActivityCollectionFor('User');
    recorded.runtime.setNextResults([[aliceRow], [aliceRow]]);

    await recorded.collection.all(cached);
    await recorded.collection.first({ id: 1 });

    expect({ calls: recorded.calls.length, hashed: recorded.hashed }).toEqual({
      calls: 2,
      hashed: [],
    });
  });

  it('all() with includes hashes and sends the include query', async () => {
    const recorded = createActivityCollectionFor('User');
    recorded.runtime.setNextResults([[{ ...aliceRow, posts: [] }]]);

    await recorded.collection.include('posts').all(cached);
    await recorded.calls[0]!.activity.contentHash();

    expect(summary(recorded)).toEqual(
      oneCall(['cache'], 1, { outcome: 'succeeded', result: [{ ...aliceModel, posts: [] }] }),
    );
    expect(recorded.hashed[0]).toBe(recorded.calls[0]!.statements[0]);
  });

  it('first() ends with the row, or with null when nothing matches', async () => {
    const recorded = createActivityCollectionFor('User');
    recorded.runtime.setNextResults([[aliceRow], []]);

    const found = await recorded.collection.first({ id: 1 }, cached);
    const missing = await recorded.collection.first({ id: 2 }, cached);

    expect({ found, missing }).toEqual({ found: aliceModel, missing: null });
    expect(recorded.calls.map(({ ended }) => ended)).toEqual([
      { outcome: 'succeeded', result: aliceModel },
      { outcome: 'succeeded', result: null },
    ]);
    expect(await recorded.calls[0]!.activity.contentHash()).toBe(
      await ormCallHash('first', fakePlanHash),
    );
  });

  it('firstOrThrow() ends failed when nothing matches', async () => {
    const recorded = createActivityCollectionFor('User');
    recorded.runtime.setNextResults([[]]);

    await expect(recorded.collection.firstOrThrow({ id: 2 }, cached)).rejects.toMatchObject({
      code: 'RUNTIME.NO_ROWS',
    });
    expect(summary(recorded)).toEqual(oneCall(['cache'], 1, { outcome: 'failed' }));
  });

  it('aggregate() ends with the aggregate object', async () => {
    const recorded = createActivityCollectionFor('Post');
    recorded.runtime.setNextResults([[{ count: 2 }]]);

    const result = await recorded.collection.aggregate((agg) => ({ count: agg.count() }), cached);

    expect(summary(recorded)).toEqual(oneCall(['cache'], 1, { outcome: 'succeeded', result }));
    expect(await recorded.calls[0]!.activity.contentHash()).toBe(
      await ormCallHash('aggregate', fakePlanHash),
    );
  });

  it('groupBy().aggregate() ends with the grouped rows', async () => {
    const recorded = createActivityCollectionFor('Post');
    recorded.runtime.setNextResults([[{ user_id: 1, count: 2 }]]);

    const result = await recorded.collection
      .groupBy('userId')
      .aggregate((agg) => ({ count: agg.count() }), cached);

    expect(summary(recorded)).toEqual(oneCall(['cache'], 1, { outcome: 'succeeded', result }));
    expect(await recorded.calls[0]!.activity.contentHash()).toBe(
      await ormCallHash('groupBy.aggregate', fakePlanHash),
    );
  });

  it('a call intercepted by middleware returns its result and sends no statement', async () => {
    const recorded = createActivityCollectionFor('User', {
      intercept: () => ({ result: aliceModel }),
    });

    const user = await recorded.collection.first({ id: 1 }, cached);

    expect({ user, summary: summary(recorded) }).toEqual({
      user: aliceModel,
      summary: oneCall(['cache'], 0, { outcome: 'succeeded' }),
    });
  });
});

describe('write terminals run as one orm-call', () => {
  it('create() ends with the created row, hashed by its model', async () => {
    const recorded = createActivityCollectionFor('User', { returning: true });
    recorded.runtime.setNextResults([[aliceRow]]);

    const created = await recorded.collection.create(alice, audited);

    expect(summary(recorded)).toEqual(
      oneCall(['audit'], 1, { outcome: 'succeeded', result: created }),
    );
    expect(await recorded.calls[0]!.activity.contentHash()).toBe(
      await ormCallHash('create', userIdentity),
    );
  });

  it('create() with a relation callback runs its statements and its read-back in a transaction of the call', async () => {
    const recorded = createActivityCollectionFor('User', { returning: true });
    recorded.runtime.setNextResults([
      [aliceRow],
      [{ id: 10, title: 'Post', user_id: 1, views: 1 }],
      [aliceRow],
    ]);

    const created = await recorded.collection.create(
      {
        ...alice,
        posts: (posts: { create: (rows: readonly Record<string, unknown>[]) => unknown }) =>
          posts.create([{ id: 10, title: 'Post', views: 1 }]),
      } as never,
      audited,
    );

    expect(summary(recorded)).toEqual(
      oneCall(['audit'], 3, { outcome: 'succeeded', result: created }, ['committed']),
    );
  });

  it('a write inside a transaction runs on the call without a transaction of its own', async () => {
    const recorded = createActivityCollectionFor('User', {
      returning: true,
      insideTransaction: true,
    });
    recorded.runtime.setNextResults([[{ id: 1 }], [aliceRow]]);

    const updated = await recorded.collection.where({ id: 1 }).update({ name: 'Alice' }, audited);

    expect(summary(recorded)).toEqual(
      oneCall(['audit'], 2, { outcome: 'succeeded', result: updated }),
    );
  });

  it('update() with several statements runs them in a transaction of the call', async () => {
    const recorded = createActivityCollectionFor('User', { returning: true });
    recorded.runtime.setNextResults([[{ id: 1 }], [aliceRow]]);

    const updated = await recorded.collection.where({ id: 1 }).update({ name: 'Alice' }, audited);

    expect(summary(recorded)).toEqual(
      oneCall(['audit'], 2, { outcome: 'succeeded', result: updated }, ['committed']),
    );
  });

  it('createAll(), updateAll() and deleteAll() end with the rows', async () => {
    const recorded = createActivityCollectionFor('User', { returning: true });
    recorded.runtime.setNextResults([[aliceRow], [aliceRow], [aliceRow]]);

    await recorded.collection.createAll([alice], audited);
    await recorded.collection.where({ id: 1 }).updateAll({ name: 'Alice' }, audited);
    await recorded.collection.where({ id: 1 }).deleteAll(audited);

    expect(recorded.calls.map(({ ended }) => ended)).toEqual([
      { outcome: 'succeeded', result: [aliceModel] },
      { outcome: 'succeeded', result: [aliceModel] },
      { outcome: 'succeeded', result: [aliceModel] },
    ]);
    expect(await Promise.all(recorded.calls.map(({ activity }) => activity.contentHash()))).toEqual(
      [
        await ormCallHash('createAll', userIdentity),
        await ormCallHash('updateAll', userIdentity),
        await ormCallHash('deleteAll', userIdentity),
      ],
    );
  });

  it('createAndCount(), updateAndCount() and deleteAndCount() end with the count', async () => {
    const recorded = createActivityCollectionFor('User', { returning: true });
    recorded.runtime.setNextStats([{ affectedRows: 1 }, { affectedRows: 2 }, { affectedRows: 3 }]);

    const counts = [
      await recorded.collection.createAndCount([alice], audited),
      await recorded.collection.where({ id: 1 }).updateAndCount({ name: 'Alice' }, audited),
      await recorded.collection.where({ id: 1 }).deleteAndCount(audited),
    ];

    expect({ counts, ended: recorded.calls.map(({ ended }) => ended) }).toEqual({
      counts: [1, 2, 3],
      ended: [
        { outcome: 'succeeded', result: 1 },
        { outcome: 'succeeded', result: 2 },
        { outcome: 'succeeded', result: 3 },
      ],
    });
    expect(summary(recorded).outside).toBe(0);
  });

  it('createAndCount() of no rows is a call that sends no statement', async () => {
    const recorded = createActivityCollectionFor('User', { returning: true });

    expect(await recorded.collection.createAndCount([], audited)).toBe(0);
    expect(summary(recorded)).toEqual(oneCall(['audit'], 0, { outcome: 'succeeded', result: 0 }));
  });

  it('upsert() and delete() end with the row', async () => {
    const recorded = createActivityCollectionFor('User', { returning: true });
    recorded.runtime.setNextResults([[aliceRow], [{ id: 1 }], [aliceRow]]);

    await recorded.collection.upsert(
      { create: alice, update: { name: 'Alice' }, conflictOn: { id: 1 } },
      audited,
    );
    await recorded.collection.where({ id: 1 }).delete(audited);

    expect(recorded.calls.map(({ ended }) => ended)).toEqual([
      { outcome: 'succeeded', result: aliceModel },
      { outcome: 'succeeded', result: aliceModel },
    ]);
    expect(summary(recorded).statementAnnotations).toEqual([]);
  });
});
