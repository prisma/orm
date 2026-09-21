import {
  type AnnotationValue,
  defineAnnotation,
  type MetaBuilder,
} from '@internal/framework-components/runtime';
import { describe, expectTypeOf, test } from 'vitest';
import type { Collection } from '../src/collection';
import type { GroupedCollection } from '../src/grouped-collection';
import type { TestContract } from './helpers';

/**
 * Type-level tests for the ORM `Collection` terminal annotations.
 *
 * Verifies:
 *  - Read terminals (`all`, `first`, `aggregate`) accept a configurator
 *    callback whose `meta.annotate(...)` admits read-applicable
 *    annotations and rejects write-only ones at the type level.
 *  - Write terminals (`create`, `createAll`, `createAndCount`, `upsert`,
 *    `update`, `updateAll`, `updateAndCount`, `delete`, `deleteAll`,
 *    `deleteAndCount`) accept a configurator whose `meta.annotate(...)`
 *    admits write-applicable annotations and rejects read-only ones.
 *  - The configurator does not widen the terminal's return type.
 *  - `first(filter, configure?)` overloads dispatch by argument shape;
 *    no runtime ambiguity (configurator-only without filter requires
 *    an explicit `undefined` first argument).
 */

declare const userCollection: Collection<TestContract, 'User'>;

const cacheAnnotation = defineAnnotation<{ ttl: number; skip?: boolean }>()({
  namespace: 'cache',
  applicableTo: ['read'],
});

const auditAnnotation = defineAnnotation<{ actor: string }>()({
  namespace: 'audit',
  applicableTo: ['write'],
});

const otelAnnotation = defineAnnotation<{ traceId: string }>()({
  namespace: 'otel',
  applicableTo: ['read', 'write'],
});

describe('Collection.all (read-typed)', () => {
  test('accepts a configurator that applies a read-only annotation', () => {
    userCollection.all((meta) => meta.annotate(cacheAnnotation({ ttl: 60 })));
  });

  test('accepts a configurator that applies a both-kind annotation', () => {
    userCollection.all((meta) => meta.annotate(otelAnnotation({ traceId: 't' })));
  });

  test('accepts a configurator that chains multiple compatible annotations', () => {
    userCollection.all((meta) =>
      meta.annotate(cacheAnnotation({ ttl: 60 })).annotate(otelAnnotation({ traceId: 't' })),
    );
  });

  test('accepts an omitted configurator', () => {
    userCollection.all();
  });

  test('rejects a configurator that applies a write-only annotation (negative)', () => {
    userCollection.all((meta) =>
      // @ts-expect-error - audit declares applicableTo: ['write'], not 'read'
      meta.annotate(auditAnnotation({ actor: 'system' })),
    );
  });

  test('rejects a configurator that mixes in a write-only annotation (negative)', () => {
    userCollection.all((meta) => {
      meta.annotate(cacheAnnotation({ ttl: 60 }));
      // @ts-expect-error - audit declares applicableTo: ['write'], not 'read'
      meta.annotate(auditAnnotation({ actor: 'system' }));
    });
  });

  test('the configurator does not widen the terminal return type', () => {
    const result = userCollection.all((meta) => meta.annotate(cacheAnnotation({ ttl: 60 })));
    expectTypeOf(result).toHaveProperty('toArray');
    expectTypeOf(result.toArray).returns.toMatchTypeOf<Promise<unknown[]>>();
  });

  test('configurator parameter is typed as MetaBuilder<"read">', () => {
    userCollection.all((meta) => {
      expectTypeOf(meta).toEqualTypeOf<MetaBuilder<'read'>>();
    });
  });
});

describe('Collection.first (read-typed)', () => {
  test('accepts a configurator after a function filter', () => {
    userCollection.first(
      (user) => user.name.eq('Alice'),
      (meta) => meta.annotate(cacheAnnotation({ ttl: 60 })),
    );
  });

  test('accepts a configurator after a shorthand filter', () => {
    userCollection.first({ name: 'Alice' }, (meta) => meta.annotate(cacheAnnotation({ ttl: 60 })));
  });

  test('accepts a configurator with explicit undefined filter', () => {
    userCollection.first(undefined, (meta) => meta.annotate(cacheAnnotation({ ttl: 60 })));
  });

  test('accepts a configurator that chains multiple compatible annotations after a filter', () => {
    userCollection.first(
      (user) => user.name.eq('Alice'),
      (meta) =>
        meta.annotate(cacheAnnotation({ ttl: 60 })).annotate(otelAnnotation({ traceId: 't' })),
    );
  });

  test('accepts no arguments at all', () => {
    userCollection.first();
  });

  test('accepts a function filter without a configurator', () => {
    userCollection.first((user) => user.name.eq('Alice'));
  });

  test('rejects a configurator that applies a write-only annotation (negative)', () => {
    userCollection.first({ name: 'Alice' }, (meta) =>
      // @ts-expect-error - audit declares applicableTo: ['write'], not 'read'
      meta.annotate(auditAnnotation({ actor: 'system' })),
    );
  });

  test('rejects a configurator with explicit undefined filter that applies a write-only annotation (negative)', () => {
    userCollection.first(undefined, (meta) =>
      // @ts-expect-error - audit declares applicableTo: ['write'], not 'read'
      meta.annotate(auditAnnotation({ actor: 'system' })),
    );
  });

  test('the return type is Promise<Row | null>', () => {
    const result = userCollection.first({ name: 'Alice' }, (meta) =>
      meta.annotate(cacheAnnotation({ ttl: 60 })),
    );
    expectTypeOf(result).resolves.toMatchTypeOf<Record<string, unknown> | null>();
  });
});

describe('Collection has no chainable .annotate (intentional scope cut)', () => {
  // Annotations attach via the configurator argument only — there is no
  // chainable `.annotate(...)` on Collection. The configurator lives on
  // `MetaBuilder<K>` constructed by the terminal; the kind is bound by
  // the terminal's operation kind, so a chainable form on Collection
  // would have fought the per-terminal kind binding.
  test('Collection does not expose an annotate method', () => {
    type Keys = keyof Collection<TestContract, 'User'>;
    type HasAnnotate = 'annotate' extends Keys ? true : false;
    expectTypeOf<HasAnnotate>().toEqualTypeOf<false>();
  });
});

describe('annotation handle types are preserved through the lane', () => {
  // The handle's payload type survives the gate — same property the
  // framework-components type-d tests verify, exercised here at the ORM
  // lane to ensure no widening through the configurator argument.
  test('cacheAnnotation construction is assignable through the configurator', () => {
    const value = cacheAnnotation({ ttl: 60 });
    expectTypeOf(value).toMatchTypeOf<AnnotationValue<{ ttl: number; skip?: boolean }, 'read'>>();
    userCollection.all((meta) => meta.annotate(value));
  });
});

// ---------------------------------------------------------------------------
// Write terminals
//
// Symmetrical contract: each write terminal accepts a configurator whose
// `meta.annotate(...)` admits write-only and both-kind annotations and
// rejects read-only ones at the type level. Return types are preserved.
// ---------------------------------------------------------------------------

declare const userCollectionWithWhere: Collection<
  TestContract,
  'User',
  Record<string, unknown>,
  {
    readonly hasOrderBy: false;
    readonly hasWhere: true;
    readonly hasUniqueFilter: true;
    readonly variantName: undefined;
    readonly nsId: never;
  }
>;

describe('Collection.create (write-typed)', () => {
  test('accepts a configurator that applies a write-only annotation', () => {
    userCollection.create({ id: 1, name: 'Alice', email: 'a@b.com' }, (meta) =>
      meta.annotate(auditAnnotation({ actor: 'system' })),
    );
  });

  test('accepts a configurator that applies a both-kind annotation', () => {
    userCollection.create({ id: 1, name: 'Alice', email: 'a@b.com' }, (meta) =>
      meta.annotate(otelAnnotation({ traceId: 't' })),
    );
  });

  test('accepts an omitted configurator', () => {
    userCollection.create({ id: 1, name: 'Alice', email: 'a@b.com' });
  });

  test('rejects a configurator that applies a read-only annotation (negative)', () => {
    userCollection.create({ id: 1, name: 'Alice', email: 'a@b.com' }, (meta) =>
      // @ts-expect-error - cache declares applicableTo: ['read'], not 'write'
      meta.annotate(cacheAnnotation({ ttl: 60 })),
    );
  });

  test('rejects a configurator that mixes in a read-only annotation (negative)', () => {
    userCollection.create({ id: 1, name: 'Alice', email: 'a@b.com' }, (meta) => {
      meta.annotate(auditAnnotation({ actor: 'system' }));
      // @ts-expect-error - cache declares applicableTo: ['read'], not 'write'
      meta.annotate(cacheAnnotation({ ttl: 60 }));
    });
  });

  test('the return type is Promise<Row>', () => {
    const result = userCollection.create({ id: 1, name: 'Alice', email: 'a@b.com' }, (meta) =>
      meta.annotate(auditAnnotation({ actor: 'system' })),
    );
    expectTypeOf(result).resolves.toMatchTypeOf<Record<string, unknown>>();
  });

  test('configurator parameter is typed as MetaBuilder<"write">', () => {
    userCollection.create({ id: 1, name: 'Alice', email: 'a@b.com' }, (meta) => {
      expectTypeOf(meta).toEqualTypeOf<MetaBuilder<'write'>>();
    });
  });
});

describe('Collection.createAll (write-typed)', () => {
  test('accepts a configurator that applies a write-only annotation', () => {
    userCollection.createAll([{ id: 1, name: 'Alice', email: 'a@b.com' }], (meta) =>
      meta.annotate(auditAnnotation({ actor: 'system' })),
    );
  });

  test('accepts an omitted configurator', () => {
    userCollection.createAll([{ id: 1, name: 'Alice', email: 'a@b.com' }]);
  });

  test('rejects a configurator that applies a read-only annotation (negative)', () => {
    userCollection.createAll([{ id: 1, name: 'Alice', email: 'a@b.com' }], (meta) =>
      // @ts-expect-error - cache declares applicableTo: ['read'], not 'write'
      meta.annotate(cacheAnnotation({ ttl: 60 })),
    );
  });
});

describe('Collection.createAndCount (write-typed)', () => {
  test('accepts a configurator that applies a write-only annotation', () => {
    userCollection.createAndCount([{ id: 1, name: 'Alice', email: 'a@b.com' }], (meta) =>
      meta.annotate(auditAnnotation({ actor: 'system' })),
    );
  });

  test('rejects a configurator that applies a read-only annotation (negative)', () => {
    userCollection.createAndCount([{ id: 1, name: 'Alice', email: 'a@b.com' }], (meta) =>
      // @ts-expect-error - cache declares applicableTo: ['read'], not 'write'
      meta.annotate(cacheAnnotation({ ttl: 60 })),
    );
  });

  test('the return type is Promise<number>', () => {
    const result = userCollection.createAndCount(
      [{ id: 1, name: 'Alice', email: 'a@b.com' }],
      (meta) => meta.annotate(auditAnnotation({ actor: 'system' })),
    );
    expectTypeOf(result).resolves.toBeNumber();
  });
});

describe('Collection.upsert (write-typed)', () => {
  test('accepts a configurator that applies a write-only annotation', () => {
    userCollection.upsert(
      {
        create: { id: 1, name: 'Alice', email: 'a@b.com' },
        update: { name: 'Alice' },
        conflictOn: { id: 1 },
      },
      (meta) => meta.annotate(auditAnnotation({ actor: 'system' })),
    );
  });

  test('rejects a configurator that applies a read-only annotation (negative)', () => {
    userCollection.upsert(
      {
        create: { id: 1, name: 'Alice', email: 'a@b.com' },
        update: { name: 'Alice' },
        conflictOn: { id: 1 },
      },
      // @ts-expect-error - cache declares applicableTo: ['read'], not 'write'
      (meta) => meta.annotate(cacheAnnotation({ ttl: 60 })),
    );
  });
});

describe('Collection.update / .updateAll / .updateAndCount (write-typed)', () => {
  // Update terminals require the receiver to satisfy the `hasWhere` /
  // `hasUniqueFilter` gates, so we use a separately-declared
  // `userCollectionWithWhere` whose State is post-unique-where.
  test('update accepts a configurator that applies a write-only annotation', () => {
    userCollectionWithWhere.update({ name: 'Alice' }, (meta) =>
      meta.annotate(auditAnnotation({ actor: 'system' })),
    );
  });

  test('update rejects a configurator that applies a read-only annotation (negative)', () => {
    userCollectionWithWhere.update({ name: 'Alice' }, (meta) =>
      // @ts-expect-error - cache declares applicableTo: ['read'], not 'write'
      meta.annotate(cacheAnnotation({ ttl: 60 })),
    );
  });

  test('updateAll accepts a configurator that applies a write-only annotation', () => {
    userCollectionWithWhere.updateAll({ name: 'Alice' }, (meta) =>
      meta.annotate(auditAnnotation({ actor: 'system' })),
    );
  });

  test('updateAll rejects a configurator that applies a read-only annotation (negative)', () => {
    userCollectionWithWhere.updateAll({ name: 'Alice' }, (meta) =>
      // @ts-expect-error - cache declares applicableTo: ['read'], not 'write'
      meta.annotate(cacheAnnotation({ ttl: 60 })),
    );
  });

  test('updateAndCount accepts a configurator that applies a write-only annotation', () => {
    userCollectionWithWhere.updateAndCount({ name: 'Alice' }, (meta) =>
      meta.annotate(auditAnnotation({ actor: 'system' })),
    );
  });

  test('updateAndCount rejects a configurator that applies a read-only annotation (negative)', () => {
    userCollectionWithWhere.updateAndCount({ name: 'Alice' }, (meta) =>
      // @ts-expect-error - cache declares applicableTo: ['read'], not 'write'
      meta.annotate(cacheAnnotation({ ttl: 60 })),
    );
  });

  test('updateAndCount returns Promise<number>', () => {
    const result = userCollectionWithWhere.updateAndCount({ name: 'Alice' }, (meta) =>
      meta.annotate(auditAnnotation({ actor: 'system' })),
    );
    expectTypeOf(result).resolves.toBeNumber();
  });
});

describe('Collection.delete / .deleteAll / .deleteAndCount (write-typed)', () => {
  test('delete accepts a configurator that applies a write-only annotation', () => {
    userCollectionWithWhere.delete((meta) => meta.annotate(auditAnnotation({ actor: 'system' })));
  });

  test('delete rejects a configurator that applies a read-only annotation (negative)', () => {
    userCollectionWithWhere.delete((meta) =>
      // @ts-expect-error - cache declares applicableTo: ['read'], not 'write'
      meta.annotate(cacheAnnotation({ ttl: 60 })),
    );
  });

  test('deleteAll accepts a configurator that applies a write-only annotation', () => {
    userCollectionWithWhere.deleteAll((meta) =>
      meta.annotate(auditAnnotation({ actor: 'system' })),
    );
  });

  test('deleteAll rejects a configurator that applies a read-only annotation (negative)', () => {
    userCollectionWithWhere.deleteAll((meta) =>
      // @ts-expect-error - cache declares applicableTo: ['read'], not 'write'
      meta.annotate(cacheAnnotation({ ttl: 60 })),
    );
  });

  test('deleteAndCount accepts a configurator that applies a write-only annotation', () => {
    userCollectionWithWhere.deleteAndCount((meta) =>
      meta.annotate(auditAnnotation({ actor: 'system' })),
    );
  });

  test('deleteAndCount rejects a configurator that applies a read-only annotation (negative)', () => {
    userCollectionWithWhere.deleteAndCount((meta) =>
      // @ts-expect-error - cache declares applicableTo: ['read'], not 'write'
      meta.annotate(cacheAnnotation({ ttl: 60 })),
    );
  });
});

// ---------------------------------------------------------------------------
// Aggregate terminals (read-typed)
//
// Both `Collection.aggregate(fn, configure?)` and
// `GroupedCollection.aggregate(fn, configure?)` are read terminals that run
// a single SQL aggregation query and accept a configurator after the
// builder callback.
// ---------------------------------------------------------------------------

describe('Collection.aggregate (read-typed)', () => {
  test('accepts a configurator that applies a read-only annotation', () => {
    userCollection.aggregate(
      (aggregate) => ({ count: aggregate.count() }),
      (meta) => meta.annotate(cacheAnnotation({ ttl: 60 })),
    );
  });

  test('accepts a configurator that applies a both-kind annotation', () => {
    userCollection.aggregate(
      (aggregate) => ({ count: aggregate.count() }),
      (meta) => meta.annotate(otelAnnotation({ traceId: 't' })),
    );
  });

  test('accepts an omitted configurator', () => {
    userCollection.aggregate((aggregate) => ({ count: aggregate.count() }));
  });

  test('rejects a configurator that applies a write-only annotation (negative)', () => {
    userCollection.aggregate(
      (aggregate) => ({ count: aggregate.count() }),
      (meta) =>
        // @ts-expect-error - audit declares applicableTo: ['write'], not 'read'
        meta.annotate(auditAnnotation({ actor: 'system' })),
    );
  });

  test('the aggregation spec type is preserved through the gate', () => {
    const result = userCollection.aggregate(
      (aggregate) => ({ count: aggregate.count() }),
      (meta) => meta.annotate(cacheAnnotation({ ttl: 60 })),
    );
    expectTypeOf(result).resolves.toMatchTypeOf<{ count: number }>();
  });
});

declare const userGroupedCollection: GroupedCollection<TestContract, 'Post', ['userId']>;

describe('GroupedCollection.aggregate (read-typed)', () => {
  test('accepts a configurator that applies a read-only annotation', () => {
    userGroupedCollection.aggregate(
      (aggregate) => ({ count: aggregate.count() }),
      (meta) => meta.annotate(cacheAnnotation({ ttl: 60 })),
    );
  });

  test('accepts a configurator that applies a both-kind annotation', () => {
    userGroupedCollection.aggregate(
      (aggregate) => ({ count: aggregate.count() }),
      (meta) => meta.annotate(otelAnnotation({ traceId: 't' })),
    );
  });

  test('accepts an omitted configurator', () => {
    userGroupedCollection.aggregate((aggregate) => ({ count: aggregate.count() }));
  });

  test('rejects a configurator that applies a write-only annotation (negative)', () => {
    userGroupedCollection.aggregate(
      (aggregate) => ({ count: aggregate.count() }),
      (meta) =>
        // @ts-expect-error - audit declares applicableTo: ['write'], not 'read'
        meta.annotate(auditAnnotation({ actor: 'system' })),
    );
  });
});
