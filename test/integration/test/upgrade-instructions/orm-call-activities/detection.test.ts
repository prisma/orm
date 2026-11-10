import { describe, expect, it } from 'vitest';
import { detectionPatterns } from '../guide-detections';

const GUIDE_PATHS = {
  app: 'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.18-to-8.0.0-rc.19/instructions.md',
  extension:
    'skills/prisma-8/upgrading/extension/upgrades/8.0.0-rc.18-to-8.0.0-rc.19/instructions.md',
} as const;

function detectionOf(audience: keyof typeof GUIDE_PATHS, id: string): readonly RegExp[] {
  return detectionPatterns(GUIDE_PATHS[audience], id);
}

function detects(audience: keyof typeof GUIDE_PATHS, id: string, content: string): boolean {
  return detectionOf(audience, id).some((pattern) => pattern.test(content));
}

describe.each(['app', 'extension'] as const)(
  '%s orm-annotations-on-the-call detection',
  (audience) => {
    it.each([
      [
        'handle.read(plan) in beforeEncode',
        'async beforeEncode(plan) {\n  const actor = auditAnnotation.read(plan);\n}',
      ],
      [
        'handle.read(exec) in onQuery',
        'intercept: { async onQuery(exec) { cacheAnnotation.read( exec ); } }',
      ],
      [
        'another parameter name',
        'async beforeEncode(statement, ctx) {\n  const actor = auditAnnotation.read(statement);\n}',
      ],
      [
        'plan.meta.annotations',
        "async onRow(row, plan) {\n  const stored = plan.meta.annotations?.['audit'];\n}",
      ],
    ])('finds %s', (_name, content) => {
      expect(detects(audience, 'orm-annotations-on-the-call', content)).toBe(true);
    });

    it.each([
      [
        'handle.read(activity)',
        'async activityStarted(activity) {\n  auditAnnotation.read(activity);\n}',
      ],
      ['meta.annotationsList', 'async beforeEncode(plan) { meta.annotationsList; }'],
      ['a read outside a middleware', 'const actor = auditAnnotation.read(plan);'],
      [
        'a Mongo middleware',
        "const m = { familyId: 'mongo', async beforeEncode(plan) { cacheAnnotation.read(plan); } };",
      ],
    ])('skips %s', (_name, content) => {
      expect(detects(audience, 'orm-annotations-on-the-call', content)).toBe(false);
    });
  },
);

describe.each(['app', 'extension'] as const)(
  '%s cache-store-holds-cached-values detection',
  (audience) => {
    it('finds CachedRows', () => {
      expect(
        detects(audience, 'cache-store-holds-cached-values', 'CacheStore<unknown, CachedRows>'),
      ).toBe(true);
    });

    it('finds a default store given a value type', () => {
      expect(
        detects(
          audience,
          'cache-store-holds-cached-values',
          'createInMemoryCacheStore<TagMeta, MyRows>({ maxEntries: 10 })',
        ),
      ).toBe(true);
    });

    it('skips a longer name', () => {
      expect(detects(audience, 'cache-store-holds-cached-values', 'MyCachedRowsStore')).toBe(false);
    });

    it.each([
      [
        'a store typed with only its meta type',
        "import type { CacheStore } from '@prisma/orm-extension-middleware-cache';\nconst store: CacheStore<TagMeta> = createRedisStore();",
      ],
      [
        'a store typed with its own rows type',
        "import type { CacheStore } from '@internal/middleware-cache';\nclass RedisStore implements CacheStore<unknown, MyRows> {}",
      ],
    ])('finds %s', (_name, content) => {
      expect(detects(audience, 'cache-store-holds-cached-values', content)).toBe(true);
    });

    it.each([
      [
        'a store typed with CachedValue',
        "import type { CachedValue, CacheStore } from '@prisma/orm-extension-middleware-cache';\nconst store: CacheStore<TagMeta, CachedValue> = createRedisStore();",
      ],
      ['a CacheEntry type of its own', "type CacheEntry = { readonly kind: 'pending' };"],
    ])('skips %s', (_name, content) => {
      expect(detects(audience, 'cache-store-holds-cached-values', content)).toBe(false);
    });

    it('skips a default store given only a meta type', () => {
      expect(
        detects(
          audience,
          'cache-store-holds-cached-values',
          'createInMemoryCacheStore<TagMeta>({ maxEntries: 10, ttlMs: 5_000 })',
        ),
      ).toBe(false);
    });
  },
);

describe('app cached-orm-reads-key-on-the-call detection', () => {
  it.each([
    ['deriveKey as a property', 'createCacheMiddleware({ deriveKey: async (exec) => exec.sql })'],
    ['deriveKey as a shorthand', 'createCacheMiddleware({ deriveKey })'],
  ])('finds %s', (_name, content) => {
    expect(detects('app', 'cached-orm-reads-key-on-the-call', content)).toBe(true);
  });

  it('skips deriveKeyFromContentHash', () => {
    expect(
      detects(
        'app',
        'cached-orm-reads-key-on-the-call',
        'const key = await deriveKeyFromContentHash(exec, ctx);',
      ),
    ).toBe(false);
  });
});

describe('app orm-needs-a-runtime-queryable detection', () => {
  it.each([
    [
      'methods that forward to a runtime',
      'const ormClient = orm({\n  context,\n  runtime: {\n    query(plan) {\n      return runtime.query(plan);\n    },',
    ],
    ['an execute property', 'orm({ context, runtime: { execute: (plan) => rt.execute(plan) } })'],
  ])('finds %s', (_name, content) => {
    expect(detects('app', 'orm-needs-a-runtime-queryable', content)).toBe(true);
  });

  it.each([
    ['the runtime itself', 'const ormClient = orm({ context, runtime });'],
    ['an option named like query', 'orm({ context, runtime: { queryTimeout: 1000 } })'],
  ])('skips %s', (_name, content) => {
    expect(detects('app', 'orm-needs-a-runtime-queryable', content)).toBe(false);
  });
});

describe('app close-lets-open-orm-calls-finish detection', () => {
  it.each([
    ['Runtime is closed', "expect(outcome).toMatchObject({ message: 'Runtime is closed' });"],
    ['Postgres client is closed', "rejects.toThrow('Postgres client is closed')"],
  ])('finds an expectation of %s', (_name, content) => {
    expect(detects('app', 'close-lets-open-orm-calls-finish', content)).toBe(true);
  });

  it('skips another closed message', () => {
    expect(
      detects('app', 'close-lets-open-orm-calls-finish', "'Postgres connection is closed'"),
    ).toBe(false);
  });
});

describe('extension queryable-carries-the-activity-source detection', () => {
  it.each([
    ['a spread then query on the next line', 'const recording = {\n  ...target,\n  query(plan) {'],
    ['another spread name', 'return { ...inner, query: record(inner) };'],
    ['execute before query', '{ ...conn, execute: async (plan) => conn.execute(plan) }'],
    ['a member spread', '{ ...this.runtime, query: wrap(this.runtime) }'],
    ['an async method', '{ ...runtime, async execute(plan) { return runtime.execute(plan); } }'],
    [
      'other members between the spread and query',
      '{\n  ...runtime,\n  connection: () => runtime.connection(),\n  query(plan) {',
    ],
  ])('finds %s', (_name, content) => {
    expect(detects('extension', 'queryable-carries-the-activity-source', content)).toBe(true);
  });

  it.each([
    ['a spread followed by another member', '{ ...runtime,\n  queryTimeout: 1000 }'],
    ['query in a nested object after the spread', '{ ...options, hooks: { query: log } }'],
    ['query in a later object', '{ ...options };\nconst other = { query: log };'],
  ])('skips %s', (_name, content) => {
    expect(detects('extension', 'queryable-carries-the-activity-source', content)).toBe(false);
  });
});

describe('extension activity detections', () => {
  it.each([
    [
      'activity-includes-client-activities',
      "if (result.kind === 'transaction') return;\nrecord(result.latencyMs);",
      "if (result.kind !== 'statement') return;\nrecord(result.latencyMs);",
    ],
    [
      'orm-runtime-objects-carry-an-activity-source',
      'const client = orm({\n  runtime: {\n    query: (plan) => getRuntime().query(plan),\n  },\n  context,\n});',
      'const client = orm({\n  runtime: {\n    query: (plan) => getRuntime().query(plan),\n    [activitySource]: delegatingActivitySource(() => getRuntime()),\n  },\n  context,\n});',
    ],
    [
      'runtime-connections-carry-an-activity-source',
      'const session = {\n  [transactionStart]: createTransactionStart(),\n  query,\n};',
      'const session = {\n  [transactionStart]: createTransactionStart(),\n  [activitySource]: self.connectionActivitySource(conn, () => session),\n};',
    ],
    [
      'transaction-activity-takes-a-parent',
      'await startTransactionActivity({ middleware, context, holdFinishedChildren });',
      'await startTransactionActivity({ middleware, context, parent: undefined, holdFinishedChildren });',
    ],
    [
      'transaction-activity-takes-a-parent',
      'class Parent implements ActivityParent {\n  adopt(child) {\n    return () => {};\n  }\n}',
      'class Parent implements ActivityParent {\n  adopt(child): ActivityChildSlot {\n    return slot;\n  }\n}',
    ],
  ])('%s finds the old form and skips the new one', (id, before, after) => {
    expect({
      before: detects('extension', id, before),
      after: detects('extension', id, after),
    }).toEqual({ before: true, after: false });
  });
});

describe('app orm-collection-member-using-reserved detection', () => {
  it.each([
    [
      'a method on the class header line',
      "class PostCollection extends Collection<Contract, 'Post'> { using(tag: string) { return this.where({ tag }); } }",
    ],
    [
      'a method on its own line',
      "class PostCollection extends Collection<Contract, 'Post'> {\n  using(tag: string) {\n    return this.where({ tag });\n  }\n}",
    ],
  ])('finds %s', (_name, content) => {
    expect(detects('app', 'orm-collection-member-using-reserved', content)).toBe(true);
  });

  it('skips a read of the using member', () => {
    expect(
      detects(
        'app',
        'orm-collection-member-using-reserved',
        "class PostCollection extends Collection<Contract, 'Post'> { search(q: string) { return this.using.post_search(q); } }",
      ),
    ).toBe(false);
  });
});
