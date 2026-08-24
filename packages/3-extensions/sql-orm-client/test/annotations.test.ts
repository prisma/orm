import {
  type AnnotationValue,
  defineAnnotation,
  type OperationKind,
} from '@internal/framework-components/runtime';
import {
  ColumnRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { describe, expect, it } from 'vitest';
import { mergeAnnotations } from '../src/query-plan-meta';
import {
  baseContract,
  createCollection,
  createCollectionFor,
  createReturningCollectionFor,
} from './collection-fixtures';

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
  it('writes the applied annotation under its namespace on the executed plan', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[]]);

    await collection.all((meta) => meta.annotate(cacheAnnotation({ ttl: 60 }))).toArray();

    expect(runtime.executions).toHaveLength(1);
    const stored = runtime.executions[0]!.plan.meta.annotations?.['cache'];
    expect(stored).toMatchObject({
      __annotation: true,
      namespace: 'cache',
      value: { ttl: 60 },
    });
  });

  it('round-trips through the typed handle.read accessor', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[]]);

    await collection.all((meta) => meta.annotate(cacheAnnotation({ ttl: 60 }))).toArray();

    const plan = runtime.executions[0]!.plan;
    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 60 });
  });

  it('returns undefined from handle.read on a plan that was never annotated', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[]]);

    await collection.all().toArray();

    const plan = runtime.executions[0]!.plan;
    expect(cacheAnnotation.read(plan)).toBeUndefined();
  });

  it('multiple annotations under different namespaces coexist', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[]]);

    await collection
      .all((meta) =>
        meta.annotate(cacheAnnotation({ ttl: 60 })).annotate(otelAnnotation({ traceId: 't-1' })),
      )
      .toArray();

    const plan = runtime.executions[0]!.plan;
    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 60 });
    expect(otelAnnotation.read(plan)).toEqual({ traceId: 't-1' });
  });

  it('omitting the configurator is a no-op for user annotations', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[]]);

    await collection.all().toArray();

    const plan = runtime.executions[0]!.plan;
    expect(cacheAnnotation.read(plan)).toBeUndefined();
    expect(otelAnnotation.read(plan)).toBeUndefined();
  });

  it('a configurator that records nothing is a no-op for user annotations', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[]]);

    await collection.all(() => {}).toArray();

    const plan = runtime.executions[0]!.plan;
    expect(cacheAnnotation.read(plan)).toBeUndefined();
    expect(otelAnnotation.read(plan)).toBeUndefined();
  });

  it('annotations survive across .where() and .limit() chaining', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[]]);

    await collection
      .where((user) => user.name.eq('Alice'))
      .limit(10)
      .all((meta) => meta.annotate(cacheAnnotation({ ttl: 60 })))
      .toArray();

    const plan = runtime.executions[0]!.plan;
    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 60 });
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
  it('writes the applied annotation under its namespace on the executed plan (no filter)', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[]]);

    await collection.first(undefined, (meta) => meta.annotate(cacheAnnotation({ ttl: 60 })));

    expect(runtime.executions).toHaveLength(1);
    const plan = runtime.executions[0]!.plan;
    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 60 });
  });

  it('writes the applied annotation when invoked with a function filter', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[]]);

    await collection.first(
      (user) => user.name.eq('Alice'),
      (meta) => meta.annotate(cacheAnnotation({ ttl: 60 })),
    );

    const plan = runtime.executions[0]!.plan;
    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 60 });
  });

  it('writes the applied annotation when invoked with a shorthand filter', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[]]);

    await collection.first({ name: 'Alice' }, (meta) =>
      meta.annotate(cacheAnnotation({ ttl: 60 })),
    );

    const plan = runtime.executions[0]!.plan;
    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 60 });
  });

  it('a single function arg is interpreted as a filter (not a configurator)', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[]]);

    // Passing a single function is treated as a filter callback, matching the
    // existing `first(filterFn)` semantics. To attach an annotation without a
    // filter, pass `undefined` explicitly as the first arg.
    await collection.first((user) => user.name.eq('Alice'));

    expect(runtime.executions).toHaveLength(1);
    const plan = runtime.executions[0]!.plan;
    expect(cacheAnnotation.read(plan)).toBeUndefined();
  });

  it('multiple annotations coexist under different namespaces', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[]]);

    await collection.first(
      (user) => user.name.eq('Alice'),
      (meta) =>
        meta.annotate(cacheAnnotation({ ttl: 60 })).annotate(otelAnnotation({ traceId: 't-1' })),
    );

    const plan = runtime.executions[0]!.plan;
    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 60 });
    expect(otelAnnotation.read(plan)).toEqual({ traceId: 't-1' });
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

describe('Collection annotations alongside framework-internal codecs metadata', () => {
  it('user annotations coexist with the framework-internal codecs map under its reserved namespace', async () => {
    const { collection, runtime } = createCollection();
    runtime.setNextResults([[]]);

    await collection.all((meta) => meta.annotate(cacheAnnotation({ ttl: 60 }))).toArray();

    const plan = runtime.executions[0]!.plan;
    // User annotation lives under its own namespace.
    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 60 });
    // Reserved framework namespace, when emitted, lives under 'codecs' and
    // is not a branded AnnotationValue (so handle.read with namespace
    // 'codecs' would return undefined; we check the raw shape here).
    if (plan.meta.annotations?.['codecs'] !== undefined) {
      expect(plan.meta.annotations['codecs']).toEqual(expect.any(Object));
    }
  });
});

describe('Collection.create annotations', () => {
  it('writes the applied write annotation under its namespace on the executed plan', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'a@b.com' }]]);

    await collection.create({ id: 1, name: 'Alice', email: 'a@b.com' }, (meta) =>
      meta.annotate(auditAnnotation({ actor: 'system' })),
    );

    expect(runtime.executions).toHaveLength(1);
    const plan = runtime.executions[0]!.plan;
    expect(auditAnnotation.read(plan)).toEqual({ actor: 'system' });
  });

  it('accepts a both-kind annotation', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'a@b.com' }]]);

    await collection.create({ id: 1, name: 'Alice', email: 'a@b.com' }, (meta) =>
      meta.annotate(otelAnnotation({ traceId: 't-1' })),
    );

    const plan = runtime.executions[0]!.plan;
    expect(otelAnnotation.read(plan)).toEqual({ traceId: 't-1' });
  });

  it('omitting the configurator leaves the plan without user annotations', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'a@b.com' }]]);

    await collection.create({ id: 1, name: 'Alice', email: 'a@b.com' });

    const plan = runtime.executions[0]!.plan;
    expect(auditAnnotation.read(plan)).toBeUndefined();
    expect(otelAnnotation.read(plan)).toBeUndefined();
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
  it('writes the applied annotation onto every plan emitted by the split path', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
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

    expect(runtime.executions.length).toBeGreaterThan(0);
    for (const execution of runtime.executions) {
      expect(auditAnnotation.read(execution.plan)).toEqual({ actor: 'system' });
    }
  });
});

describe('Collection.createAndCount annotations', () => {
  it('writes the applied annotation onto the executed plan', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([[]]);

    await collection.createAndCount([{ id: 1, name: 'A', email: 'a@b.com' }], (meta) =>
      meta.annotate(auditAnnotation({ actor: 'system' })),
    );

    expect(runtime.executions.length).toBeGreaterThan(0);
    for (const execution of runtime.executions) {
      expect(auditAnnotation.read(execution.plan)).toEqual({ actor: 'system' });
    }
  });
});

describe('Collection.upsert annotations', () => {
  it('writes the applied annotation under its namespace on the executed plan', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'a@b.com' }]]);

    await collection.upsert(
      {
        create: { id: 1, name: 'Alice', email: 'a@b.com' },
        update: { name: 'Alice' },
        conflictOn: { id: 1 },
      },
      (meta) => meta.annotate(auditAnnotation({ actor: 'system' })),
    );

    const plan = runtime.executions[0]!.plan;
    expect(auditAnnotation.read(plan)).toEqual({ actor: 'system' });
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
  it('writes the applied annotation onto the update statement (not the matching read)', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    // Two execute calls: matching select first, then the update.
    runtime.setNextResults([[{ id: 1 }], [{ id: 1, name: 'Alice', email: 'a@b.com' }]]);

    await collection
      .where({ id: 1 })
      .update({ name: 'Alice' }, (meta) => meta.annotate(auditAnnotation({ actor: 'system' })));

    expect(runtime.executions).toHaveLength(2);
    const matchingPlan = runtime.executions[0]!.plan;
    const updatePlan = runtime.executions[1]!.plan;
    // The matching read does NOT carry the write annotation.
    expect(auditAnnotation.read(matchingPlan)).toBeUndefined();
    // The update statement DOES.
    expect(auditAnnotation.read(updatePlan)).toEqual({ actor: 'system' });
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
  it('writes the applied annotation under its namespace on the executed plan', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'a@b.com' }]]);

    await collection
      .where({ id: 1 })
      .updateAll({ name: 'Alice' }, (meta) => meta.annotate(auditAnnotation({ actor: 'system' })))
      .toArray();

    const plan = runtime.executions[0]!.plan;
    expect(auditAnnotation.read(plan)).toEqual({ actor: 'system' });
  });
});

describe('Collection.updateAndCount annotations', () => {
  it('performs one annotated execute and no query', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
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
    const execution = runtime.executions[0]!;
    expect(execution.operation).toBe('execute');
    expect(auditAnnotation.read(execution.plan)).toEqual({ actor: 'system' });
  });
});

describe('Collection.delete annotations', () => {
  it('writes the applied annotation onto the delete statement (not the matching read)', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    // Two execute calls: matching select first, then the delete.
    runtime.setNextResults([[{ id: 1 }], [{ id: 1, name: 'Alice', email: 'a@b.com' }]]);

    await collection
      .where({ id: 1 })
      .delete((meta) => meta.annotate(auditAnnotation({ actor: 'system' })));

    expect(runtime.executions).toHaveLength(2);
    const matchingPlan = runtime.executions[0]!.plan;
    const deletePlan = runtime.executions[1]!.plan;
    // The matching read does NOT carry the write annotation.
    expect(auditAnnotation.read(matchingPlan)).toBeUndefined();
    // The delete statement DOES.
    expect(auditAnnotation.read(deletePlan)).toEqual({ actor: 'system' });
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
  it('writes the applied annotation under its namespace on the executed plan', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'a@b.com' }]]);

    await collection
      .where({ id: 1 })
      .deleteAll((meta) => meta.annotate(auditAnnotation({ actor: 'system' })))
      .toArray();

    const plan = runtime.executions[0]!.plan;
    expect(auditAnnotation.read(plan)).toEqual({ actor: 'system' });
  });
});

describe('Collection.deleteAndCount annotations', () => {
  it('performs one annotated execute and no query', async () => {
    const { collection, runtime } = createReturningCollectionFor('User');
    runtime.setNextStats([{ affectedRows: 2 }]);

    const count = await collection
      .where({ id: 1 })
      .deleteAndCount((meta) => meta.annotate(auditAnnotation({ actor: 'system' })));

    expect(count).toBe(2);
    expect(runtime.executions).toHaveLength(1);
    expect(runtime.executions.filter((execution) => execution.operation === 'query')).toHaveLength(
      0,
    );
    const execution = runtime.executions[0]!;
    expect(execution.operation).toBe('execute');
    expect(auditAnnotation.read(execution.plan)).toEqual({ actor: 'system' });
  });
});

describe('Collection.aggregate annotations', () => {
  it('writes the applied read annotation under its namespace on the executed plan', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([[{ count: '5' }]]);

    await collection.aggregate(
      (aggregate) => ({ count: aggregate.count() }),
      (meta) => meta.annotate(cacheAnnotation({ ttl: 60 })),
    );

    expect(runtime.executions).toHaveLength(1);
    const plan = runtime.executions[0]!.plan;
    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 60 });
  });

  it('accepts a both-kind annotation', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([[{ count: '5' }]]);

    await collection.aggregate(
      (aggregate) => ({ count: aggregate.count() }),
      (meta) => meta.annotate(otelAnnotation({ traceId: 't-1' })),
    );

    const plan = runtime.executions[0]!.plan;
    expect(otelAnnotation.read(plan)).toEqual({ traceId: 't-1' });
  });

  it('omitting the configurator leaves the plan without user annotations', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([[{ count: '5' }]]);

    await collection.aggregate((aggregate) => ({ count: aggregate.count() }));

    const plan = runtime.executions[0]!.plan;
    expect(cacheAnnotation.read(plan)).toBeUndefined();
    expect(otelAnnotation.read(plan)).toBeUndefined();
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
  it('writes the applied read annotation under its namespace on the executed plan', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([[{ user_id: 1, count: '2' }]]);

    await collection.groupBy('userId').aggregate(
      (aggregate) => ({ count: aggregate.count() }),
      (meta) => meta.annotate(cacheAnnotation({ ttl: 60 })),
    );

    expect(runtime.executions).toHaveLength(1);
    const plan = runtime.executions[0]!.plan;
    expect(cacheAnnotation.read(plan)).toEqual({ ttl: 60 });
  });

  it('accepts a both-kind annotation', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([[{ user_id: 1, count: '2' }]]);

    await collection.groupBy('userId').aggregate(
      (aggregate) => ({ count: aggregate.count() }),
      (meta) => meta.annotate(otelAnnotation({ traceId: 't-1' })),
    );

    const plan = runtime.executions[0]!.plan;
    expect(otelAnnotation.read(plan)).toEqual({ traceId: 't-1' });
  });

  it('omitting the configurator leaves the plan without user annotations', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([[{ user_id: 1, count: '2' }]]);

    await collection.groupBy('userId').aggregate((aggregate) => ({ count: aggregate.count() }));

    const plan = runtime.executions[0]!.plan;
    expect(cacheAnnotation.read(plan)).toBeUndefined();
    expect(otelAnnotation.read(plan)).toBeUndefined();
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

describe('mergeAnnotations precedence', () => {
  // Framework-reserved namespace keys (e.g. `codecs`) on the input plan
  // must win over user-supplied values under the same namespace. Pins
  // the spread order documented in `mergeAnnotations`: a future
  // accidental `Object.assign({}, plan.meta.annotations, userEntries)`
  // flip would inadvertently let users overwrite the codecs map.
  function makePlan(annotations: Record<string, unknown>): SqlQueryPlan<Record<string, unknown>> {
    return Object.freeze({
      ast: SelectAst.from(TableSource.named('users')).withProjection([
        ProjectionItem.of('id', ColumnRef.of('users', 'id'), { codecId: 'pg/int4@1' }),
      ]),
      params: [],
      meta: Object.freeze({
        target: baseContract.target,
        targetFamily: baseContract.targetFamily,
        storageHash: baseContract.storage.storageHash,
        lane: 'orm-client',
        annotations: Object.freeze({ ...annotations }),
      }),
    });
  }

  function entryMap(
    entries: Record<string, AnnotationValue<unknown, OperationKind>>,
  ): ReadonlyMap<string, AnnotationValue<unknown, OperationKind>> {
    return new Map(Object.entries(entries));
  }

  it('framework-reserved codecs map on the input plan wins over a caller-supplied codecs value under the same namespace', () => {
    const frameworkCodecs = { id: 'pg/int4@1', email: 'pg/text@1' };
    const plan = makePlan({ codecs: frameworkCodecs });

    // A caller defines their own `codecs` annotation (bypassing the
    // reserved-namespace warning) and supplies it through the meta
    // builder — mergeAnnotations should leave the framework value in
    // place.
    const callerCodecsAnnotation = defineAnnotation<{ ttl: number }>()({
      namespace: 'codecs',
      applicableTo: ['read'],
    });
    const callerValue = callerCodecsAnnotation({ ttl: 60 });
    const merged = mergeAnnotations(plan, entryMap({ codecs: callerValue }));

    expect(merged.meta.annotations?.['codecs']).toBe(frameworkCodecs);
    expect(merged.meta.annotations?.['codecs']).not.toBe(callerValue);
  });

  it('caller-supplied entries under non-colliding namespaces still land on the plan', () => {
    const plan = makePlan({ codecs: { id: 'pg/int4@1' } });
    const cacheAnnotation = defineAnnotation<{ ttl: number }>()({
      namespace: 'cache',
      applicableTo: ['read'],
    });
    const cacheValue = cacheAnnotation({ ttl: 60 });

    const merged = mergeAnnotations(plan, entryMap({ cache: cacheValue }));

    expect(merged.meta.annotations?.['cache']).toBe(cacheValue);
    expect(merged.meta.annotations?.['codecs']).toEqual({ id: 'pg/int4@1' });
  });

  it('returns the input plan unchanged when the caller map is empty', () => {
    const plan = makePlan({ codecs: { id: 'pg/int4@1' } });

    const merged = mergeAnnotations(plan, new Map());

    expect(merged).toBe(plan);
  });

  it('returns the input plan unchanged when the caller map is undefined', () => {
    const plan = makePlan({ codecs: { id: 'pg/int4@1' } });

    const merged = mergeAnnotations(plan, undefined);

    expect(merged).toBe(plan);
  });
});
