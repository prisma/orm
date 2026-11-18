import { defineAnnotation } from '@internal/framework-components/runtime';
import { afterEach, describe, expect, it } from 'vitest';
import type { TestModelName } from './collection-fixtures';
import type { MockRuntime } from './helpers';
import {
  createActivityCollectionFor,
  type RecordedCall,
  statementAnnotationNamespaces,
} from './orm-call-fixtures';

const runtimes: MockRuntime[] = [];

function track<T extends { runtime: MockRuntime }>(created: T): T {
  runtimes.push(created.runtime);
  return created;
}

const createCollectionFor = <ModelName extends TestModelName>(modelName: ModelName) =>
  track(createActivityCollectionFor(modelName));
const createCollection = () => createCollectionFor('User');
const createReturningCollectionFor = <ModelName extends TestModelName>(modelName: ModelName) =>
  track(createActivityCollectionFor(modelName, { returning: true }));

function onlyCall(calls: readonly RecordedCall[]) {
  expect(calls).toHaveLength(1);
  return calls[0]!.activity;
}

afterEach(() => {
  for (const runtime of runtimes.splice(0)) {
    expect(statementAnnotationNamespaces(runtime)).toEqual([]);
  }
});

const cacheAnnotation = defineAnnotation<{ ttl: number; skip?: boolean }>()({
  namespace: 'cache',
  applicableTo: ['read'],
});

const otelAnnotation = defineAnnotation<{ traceId: string }>()({
  namespace: 'otel',
  applicableTo: ['read', 'write'],
});

const auditAnnotation = defineAnnotation<{ actor: string }>()({
  namespace: 'audit',
  applicableTo: ['write'],
});

describe('Collection.all annotations', () => {
  it('writes the applied annotation on the call', async () => {
    const { collection, runtime, calls } = createCollection();
    runtime.setNextResults([[]]);

    await collection.all((meta) => meta.annotate(cacheAnnotation({ ttl: 60 }))).toArray();

    expect(runtime.executions).toHaveLength(1);
    const stored = onlyCall(calls).annotations.get('cache');
    expect(stored).toMatchObject({
      __annotation: true,
      namespace: 'cache',
      value: { ttl: 60 },
    });
  });

  it('round-trips through the typed handle.read accessor', async () => {
    const { collection, runtime, calls } = createCollection();
    runtime.setNextResults([[]]);

    await collection.all((meta) => meta.annotate(cacheAnnotation({ ttl: 60 }))).toArray();

    const call = onlyCall(calls);
    expect(cacheAnnotation.read(call)).toEqual({ ttl: 60 });
  });

  it('multiple annotations under different namespaces coexist', async () => {
    const { collection, runtime, calls } = createCollection();
    runtime.setNextResults([[]]);

    await collection
      .all((meta) =>
        meta.annotate(cacheAnnotation({ ttl: 60 })).annotate(otelAnnotation({ traceId: 't-1' })),
      )
      .toArray();

    const call = onlyCall(calls);
    expect(cacheAnnotation.read(call)).toEqual({ ttl: 60 });
    expect(otelAnnotation.read(call)).toEqual({ traceId: 't-1' });
  });

  it('omitting the configurator is a no-op for user annotations', async () => {
    const { collection, runtime, calls } = createCollection();
    runtime.setNextResults([[]]);

    await collection.all().toArray();

    const call = onlyCall(calls);
    expect(cacheAnnotation.read(call)).toBeUndefined();
    expect(otelAnnotation.read(call)).toBeUndefined();
  });

  it('a configurator that records nothing is a no-op for user annotations', async () => {
    const { collection, runtime, calls } = createCollection();
    runtime.setNextResults([[]]);

    await collection.all(() => {}).toArray();

    const call = onlyCall(calls);
    expect(cacheAnnotation.read(call)).toBeUndefined();
    expect(otelAnnotation.read(call)).toBeUndefined();
  });

  it('annotations survive across .where() and .limit() chaining', async () => {
    const { collection, runtime, calls } = createCollection();
    runtime.setNextResults([[]]);

    await collection
      .where((user) => user.name.eq('Alice'))
      .limit(10)
      .all((meta) => meta.annotate(cacheAnnotation({ ttl: 60 })))
      .toArray();

    const call = onlyCall(calls);
    expect(cacheAnnotation.read(call)).toEqual({ ttl: 60 });
  });

  it('runtime gate rejects a write-only annotation forced through a cast', () => {
    const { collection } = createCollection();
    expect(() =>
      collection
        .all((meta) => {
          // Cast bypasses the type-level applicability gate.
          const annotateAny = meta.annotate as (annotation: unknown) => unknown;
          annotateAny.call(meta, auditAnnotation({ actor: 'system' }));
        })
        .toArray(),
    ).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.ANNOTATION_INAPPLICABLE',
        category: 'RUNTIME',
      }),
    );
  });
});

describe('Collection.first annotations', () => {
  it('writes the applied annotation on the call (no filter)', async () => {
    const { collection, runtime, calls } = createCollection();
    runtime.setNextResults([[]]);

    await collection.first(undefined, (meta) => meta.annotate(cacheAnnotation({ ttl: 60 })));

    expect(runtime.executions).toHaveLength(1);
    const call = onlyCall(calls);
    expect(cacheAnnotation.read(call)).toEqual({ ttl: 60 });
  });

  it('writes the applied annotation when invoked with a function filter', async () => {
    const { collection, runtime, calls } = createCollection();
    runtime.setNextResults([[]]);

    await collection.first(
      (user) => user.name.eq('Alice'),
      (meta) => meta.annotate(cacheAnnotation({ ttl: 60 })),
    );

    const call = onlyCall(calls);
    expect(cacheAnnotation.read(call)).toEqual({ ttl: 60 });
  });

  it('writes the applied annotation when invoked with a shorthand filter', async () => {
    const { collection, runtime, calls } = createCollection();
    runtime.setNextResults([[]]);

    await collection.first({ name: 'Alice' }, (meta) =>
      meta.annotate(cacheAnnotation({ ttl: 60 })),
    );

    const call = onlyCall(calls);
    expect(cacheAnnotation.read(call)).toEqual({ ttl: 60 });
  });

  it('a single function arg is interpreted as a filter (not a configurator)', async () => {
    const { collection, runtime, calls } = createCollection();
    runtime.setNextResults([[]]);

    // Passing a single function is treated as a filter callback, matching the
    // existing `first(filterFn)` semantics. To attach an annotation without a
    // filter, pass `undefined` explicitly as the first arg.
    await collection.first((user) => user.name.eq('Alice'));

    expect(runtime.executions).toHaveLength(1);
    const call = onlyCall(calls);
    expect(cacheAnnotation.read(call)).toBeUndefined();
  });

  it('multiple annotations coexist under different namespaces', async () => {
    const { collection, runtime, calls } = createCollection();
    runtime.setNextResults([[]]);

    await collection.first(
      (user) => user.name.eq('Alice'),
      (meta) =>
        meta.annotate(cacheAnnotation({ ttl: 60 })).annotate(otelAnnotation({ traceId: 't-1' })),
    );

    const call = onlyCall(calls);
    expect(cacheAnnotation.read(call)).toEqual({ ttl: 60 });
    expect(otelAnnotation.read(call)).toEqual({ traceId: 't-1' });
  });

  it('runtime gate rejects a write-only annotation forced through a cast', async () => {
    const { collection } = createCollection();
    await expect(
      collection.first(undefined, (meta) => {
        const annotateAny = meta.annotate as (annotation: unknown) => unknown;
        annotateAny.call(meta, auditAnnotation({ actor: 'system' }));
      }),
    ).rejects.toMatchObject({
      code: 'RUNTIME.ANNOTATION_INAPPLICABLE',
      category: 'RUNTIME',
    });
  });
});

describe('Collection.firstOrThrow annotations', () => {
  it('writes the applied annotation on each call with and without a filter', async () => {
    const { collection, runtime, calls } = createCollection();
    runtime.setNextResults([[{ id: 1 }], [{ id: 1 }]]);

    await collection.firstOrThrow(undefined, (meta) => meta.annotate(cacheAnnotation({ ttl: 60 })));
    await collection.firstOrThrow({ name: 'Alice' }, (meta) =>
      meta.annotate(cacheAnnotation({ ttl: 30 })),
    );

    expect(calls.map(({ activity }) => cacheAnnotation.read(activity))).toEqual([
      { ttl: 60 },
      { ttl: 30 },
    ]);
  });

  it('runtime gate names firstOrThrow when rejecting a write-only annotation', async () => {
    const { collection } = createCollection();
    await expect(
      collection.firstOrThrow(undefined, (meta) => {
        const annotateAny = meta.annotate as (annotation: unknown) => unknown;
        annotateAny.call(meta, auditAnnotation({ actor: 'system' }));
      }),
    ).rejects.toMatchObject({
      code: 'RUNTIME.ANNOTATION_INAPPLICABLE',
      details: { terminalName: 'firstOrThrow', kind: 'read' },
    });
    expect(() =>
      collection.prepared.firstOrThrow(undefined, (meta) => {
        const annotateAny = meta.annotate as (annotation: unknown) => unknown;
        annotateAny.call(meta, auditAnnotation({ actor: 'system' }));
      }),
    ).toThrow(
      expect.objectContaining({
        details: expect.objectContaining({ terminalName: 'firstOrThrow' }),
      }),
    );
  });
});

describe('Collection annotations and the reserved statement metadata', () => {
  it('user annotations live on the call; the statement keeps only the reserved keys the ORM sets', async () => {
    const { collection, runtime, calls } = createCollection();
    runtime.setNextResults([[]]);

    await collection.all((meta) => meta.annotate(cacheAnnotation({ ttl: 60 }))).toArray();

    expect({
      call: cacheAnnotation.read(onlyCall(calls)),
      statementKeys: Object.keys(runtime.executions[0]!.plan.meta.annotations ?? {}),
    }).toEqual({ call: { ttl: 60 }, statementKeys: expect.not.arrayContaining(['cache']) });
  });
});

describe('Collection.create annotations', () => {
  it('writes the applied write annotation on the call', async () => {
    const { collection, runtime, calls } = createReturningCollectionFor('User');
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'a@b.com' }]]);

    await collection.create({ id: 1, name: 'Alice', email: 'a@b.com' }, (meta) =>
      meta.annotate(auditAnnotation({ actor: 'system' })),
    );

    expect(runtime.executions).toHaveLength(1);
    const call = onlyCall(calls);
    expect(auditAnnotation.read(call)).toEqual({ actor: 'system' });
  });

  it('accepts a both-kind annotation', async () => {
    const { collection, runtime, calls } = createReturningCollectionFor('User');
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'a@b.com' }]]);

    await collection.create({ id: 1, name: 'Alice', email: 'a@b.com' }, (meta) =>
      meta.annotate(otelAnnotation({ traceId: 't-1' })),
    );

    const call = onlyCall(calls);
    expect(otelAnnotation.read(call)).toEqual({ traceId: 't-1' });
  });

  it('omitting the configurator leaves the call without user annotations', async () => {
    const { collection, runtime, calls } = createReturningCollectionFor('User');
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'a@b.com' }]]);

    await collection.create({ id: 1, name: 'Alice', email: 'a@b.com' });

    const call = onlyCall(calls);
    expect(auditAnnotation.read(call)).toBeUndefined();
    expect(otelAnnotation.read(call)).toBeUndefined();
  });

  it('runtime gate rejects a read-only annotation forced through a cast', async () => {
    const { collection } = createReturningCollectionFor('User');
    await expect(
      collection.create({ id: 1, name: 'Alice', email: 'a@b.com' }, (meta) => {
        const annotateAny = meta.annotate as (annotation: unknown) => unknown;
        annotateAny.call(meta, cacheAnnotation({ ttl: 60 }));
      }),
    ).rejects.toMatchObject({
      code: 'RUNTIME.ANNOTATION_INAPPLICABLE',
      category: 'RUNTIME',
    });
  });
});

describe('Collection.createAll annotations', () => {
  it('writes the applied annotation on the call', async () => {
    const { collection, runtime, calls } = createReturningCollectionFor('User');
    runtime.setNextResults([
      [{ id: 1, name: 'A', email: 'a@b.com' }],
      [{ id: 2, name: 'B', email: 'b@b.com' }],
    ]);

    await collection
      .createAll(
        [
          { id: 1, name: 'A', email: 'a@b.com' },
          { id: 2, name: 'B', email: 'b@b.com' },
        ],
        (meta) => meta.annotate(auditAnnotation({ actor: 'system' })),
      )
      .toArray();

    expect(auditAnnotation.read(onlyCall(calls))).toEqual({ actor: 'system' });
  });
});

describe('Collection.createAndCount annotations', () => {
  it('writes the applied annotation on the call', async () => {
    const { collection, runtime, calls } = createReturningCollectionFor('User');
    runtime.setNextResults([[]]);

    await collection.createAndCount([{ id: 1, name: 'A', email: 'a@b.com' }], (meta) =>
      meta.annotate(auditAnnotation({ actor: 'system' })),
    );

    expect(auditAnnotation.read(onlyCall(calls))).toEqual({ actor: 'system' });
  });
});

describe('Collection.upsert annotations', () => {
  it('writes the applied annotation on the call', async () => {
    const { collection, runtime, calls } = createReturningCollectionFor('User');
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'a@b.com' }]]);

    await collection.upsert(
      {
        create: { id: 1, name: 'Alice', email: 'a@b.com' },
        update: { name: 'Alice' },
        conflictOn: { id: 1 },
      },
      (meta) => meta.annotate(auditAnnotation({ actor: 'system' })),
    );

    const call = onlyCall(calls);
    expect(auditAnnotation.read(call)).toEqual({ actor: 'system' });
  });

  it('runtime gate rejects a read-only annotation forced through a cast', async () => {
    const { collection } = createReturningCollectionFor('User');
    await expect(
      collection.upsert(
        {
          create: { id: 1, name: 'Alice', email: 'a@b.com' },
          update: { name: 'Alice' },
          conflictOn: { id: 1 },
        },
        (meta) => {
          const annotateAny = meta.annotate as (annotation: unknown) => unknown;
          annotateAny.call(meta, cacheAnnotation({ ttl: 60 }));
        },
      ),
    ).rejects.toMatchObject({
      code: 'RUNTIME.ANNOTATION_INAPPLICABLE',
    });
  });
});

describe('Collection.update annotations', () => {
  it('writes the applied annotation on the call, not on its read or update statement', async () => {
    const { collection, runtime, calls } = createReturningCollectionFor('User');
    runtime.setNextResults([[{ id: 1 }], [{ id: 1, name: 'Alice', email: 'a@b.com' }]]);

    await collection
      .where({ id: 1 })
      .update({ name: 'Alice' }, (meta) => meta.annotate(auditAnnotation({ actor: 'system' })));

    expect(auditAnnotation.read(onlyCall(calls))).toEqual({ actor: 'system' });
  });

  it('runtime gate rejects a read-only annotation forced through a cast', async () => {
    const { collection } = createReturningCollectionFor('User');
    const filtered = collection.where({ id: 1 });
    await expect(
      filtered.update({ name: 'Alice' }, (meta) => {
        const annotateAny = meta.annotate as (annotation: unknown) => unknown;
        annotateAny.call(meta, cacheAnnotation({ ttl: 60 }));
      }),
    ).rejects.toMatchObject({
      code: 'RUNTIME.ANNOTATION_INAPPLICABLE',
    });
  });
});

describe('Collection.updateAll annotations', () => {
  it('writes the applied annotation on the call', async () => {
    const { collection, runtime, calls } = createReturningCollectionFor('User');
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'a@b.com' }]]);

    await collection
      .where({ id: 1 })
      .updateAll({ name: 'Alice' }, (meta) => meta.annotate(auditAnnotation({ actor: 'system' })))
      .toArray();

    const call = onlyCall(calls);
    expect(auditAnnotation.read(call)).toEqual({ actor: 'system' });
  });
});

describe('Collection.updateAndCount annotations', () => {
  it('performs one execute and no query, under an annotated call', async () => {
    const { collection, runtime, calls } = createReturningCollectionFor('User');
    runtime.setNextStats([{ affectedRows: 3 }]);

    const count = await collection
      .where({ id: 1 })
      .updateAndCount({ name: 'Alice' }, (meta) =>
        meta.annotate(auditAnnotation({ actor: 'system' })),
      );

    expect(count).toBe(3);
    expect(runtime.executions).toHaveLength(1);
    expect(runtime.executions.filter((execution) => execution.operation === 'query')).toHaveLength(
      0,
    );
    expect(runtime.executions[0]!.operation).toBe('execute');
    expect(auditAnnotation.read(onlyCall(calls))).toEqual({ actor: 'system' });
  });
});

describe('Collection.delete annotations', () => {
  it('writes the applied annotation on the call, not on its read or delete statement', async () => {
    const { collection, runtime, calls } = createReturningCollectionFor('User');
    runtime.setNextResults([[{ id: 1 }], [{ id: 1, name: 'Alice', email: 'a@b.com' }]]);

    await collection
      .where({ id: 1 })
      .delete((meta) => meta.annotate(auditAnnotation({ actor: 'system' })));

    expect(auditAnnotation.read(onlyCall(calls))).toEqual({ actor: 'system' });
  });

  it('runtime gate rejects a read-only annotation forced through a cast', async () => {
    const { collection } = createReturningCollectionFor('User');
    const filtered = collection.where({ id: 1 });
    await expect(
      filtered.delete((meta) => {
        const annotateAny = meta.annotate as (annotation: unknown) => unknown;
        annotateAny.call(meta, cacheAnnotation({ ttl: 60 }));
      }),
    ).rejects.toMatchObject({
      code: 'RUNTIME.ANNOTATION_INAPPLICABLE',
    });
  });
});

describe('Collection.deleteAll annotations', () => {
  it('writes the applied annotation on the call', async () => {
    const { collection, runtime, calls } = createReturningCollectionFor('User');
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'a@b.com' }]]);

    await collection
      .where({ id: 1 })
      .deleteAll((meta) => meta.annotate(auditAnnotation({ actor: 'system' })))
      .toArray();

    const call = onlyCall(calls);
    expect(auditAnnotation.read(call)).toEqual({ actor: 'system' });
  });
});

describe('Collection.deleteAndCount annotations', () => {
  it('performs one execute and no query, under an annotated call', async () => {
    const { collection, runtime, calls } = createReturningCollectionFor('User');
    runtime.setNextStats([{ affectedRows: 2 }]);

    const count = await collection
      .where({ id: 1 })
      .deleteAndCount((meta) => meta.annotate(auditAnnotation({ actor: 'system' })));

    expect(count).toBe(2);
    expect(runtime.executions).toHaveLength(1);
    expect(runtime.executions.filter((execution) => execution.operation === 'query')).toHaveLength(
      0,
    );
    expect(runtime.executions[0]!.operation).toBe('execute');
    expect(auditAnnotation.read(onlyCall(calls))).toEqual({ actor: 'system' });
  });
});

describe('Collection.aggregate annotations', () => {
  it('writes the applied read annotation on the call', async () => {
    const { collection, runtime, calls } = createCollectionFor('Post');
    runtime.setNextResults([[{ count: '5' }]]);

    await collection.aggregate(
      (aggregate) => ({ count: aggregate.count() }),
      (meta) => meta.annotate(cacheAnnotation({ ttl: 60 })),
    );

    expect(runtime.executions).toHaveLength(1);
    const call = onlyCall(calls);
    expect(cacheAnnotation.read(call)).toEqual({ ttl: 60 });
  });

  it('accepts a both-kind annotation', async () => {
    const { collection, runtime, calls } = createCollectionFor('Post');
    runtime.setNextResults([[{ count: '5' }]]);

    await collection.aggregate(
      (aggregate) => ({ count: aggregate.count() }),
      (meta) => meta.annotate(otelAnnotation({ traceId: 't-1' })),
    );

    const call = onlyCall(calls);
    expect(otelAnnotation.read(call)).toEqual({ traceId: 't-1' });
  });

  it('omitting the configurator leaves the call without user annotations', async () => {
    const { collection, runtime, calls } = createCollectionFor('Post');
    runtime.setNextResults([[{ count: '5' }]]);

    await collection.aggregate((aggregate) => ({ count: aggregate.count() }));

    const call = onlyCall(calls);
    expect(cacheAnnotation.read(call)).toBeUndefined();
    expect(otelAnnotation.read(call)).toBeUndefined();
  });

  it('runtime gate rejects a write-only annotation forced through a cast', async () => {
    const { collection } = createCollectionFor('Post');
    await expect(
      collection.aggregate(
        (aggregate) => ({ count: aggregate.count() }),
        (meta) => {
          const annotateAny = meta.annotate as (annotation: unknown) => unknown;
          annotateAny.call(meta, auditAnnotation({ actor: 'system' }));
        },
      ),
    ).rejects.toMatchObject({
      code: 'RUNTIME.ANNOTATION_INAPPLICABLE',
      category: 'RUNTIME',
    });
  });
});

describe('GroupedCollection.aggregate annotations', () => {
  it('writes the applied read annotation on the call', async () => {
    const { collection, runtime, calls } = createCollectionFor('Post');
    runtime.setNextResults([[{ user_id: 1, count: '2' }]]);

    await collection.groupBy('userId').aggregate(
      (aggregate) => ({ count: aggregate.count() }),
      (meta) => meta.annotate(cacheAnnotation({ ttl: 60 })),
    );

    expect(runtime.executions).toHaveLength(1);
    const call = onlyCall(calls);
    expect(cacheAnnotation.read(call)).toEqual({ ttl: 60 });
  });

  it('accepts a both-kind annotation', async () => {
    const { collection, runtime, calls } = createCollectionFor('Post');
    runtime.setNextResults([[{ user_id: 1, count: '2' }]]);

    await collection.groupBy('userId').aggregate(
      (aggregate) => ({ count: aggregate.count() }),
      (meta) => meta.annotate(otelAnnotation({ traceId: 't-1' })),
    );

    const call = onlyCall(calls);
    expect(otelAnnotation.read(call)).toEqual({ traceId: 't-1' });
  });

  it('omitting the configurator leaves the call without user annotations', async () => {
    const { collection, runtime, calls } = createCollectionFor('Post');
    runtime.setNextResults([[{ user_id: 1, count: '2' }]]);

    await collection.groupBy('userId').aggregate((aggregate) => ({ count: aggregate.count() }));

    const call = onlyCall(calls);
    expect(cacheAnnotation.read(call)).toBeUndefined();
    expect(otelAnnotation.read(call)).toBeUndefined();
  });

  it('runtime gate rejects a write-only annotation forced through a cast', async () => {
    const { collection } = createCollectionFor('Post');
    await expect(
      collection.groupBy('userId').aggregate(
        (aggregate) => ({ count: aggregate.count() }),
        (meta) => {
          const annotateAny = meta.annotate as (annotation: unknown) => unknown;
          annotateAny.call(meta, auditAnnotation({ actor: 'system' }));
        },
      ),
    ).rejects.toMatchObject({
      code: 'RUNTIME.ANNOTATION_INAPPLICABLE',
    });
  });
});
