import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';

const GUIDE_PATHS = {
  app: 'upgrade-instructions/pending/orm-call-activities/app/instructions.md',
  extension: 'upgrade-instructions/pending/orm-call-activities/extension/instructions.md',
} as const;

const here = dirname(fileURLToPath(import.meta.url));

function detectionOf(audience: keyof typeof GUIDE_PATHS, id: string): readonly RegExp[] {
  const guide = readFileSync(join(here, '../../../../..', GUIDE_PATHS[audience]), 'utf-8');
  const entry = guide.split(/\n {2}- id: /).find((block) => block.startsWith(`${id}\n`));
  if (entry === undefined) throw new Error(`The ${audience} guide has no change ${id}`);
  return [...entry.matchAll(/^ {8}- '(.*)'$/gm)].map(
    ([, pattern]) => new RegExp((pattern ?? '').replaceAll("''", "'")),
  );
}

function detects(audience: keyof typeof GUIDE_PATHS, id: string, content: string): boolean {
  return detectionOf(audience, id).some((pattern) => pattern.test(content));
}

describe.each(['app', 'extension'] as const)(
  '%s orm-annotations-on-the-call detection',
  (audience) => {
    it.each([
      ['handle.read(plan)', 'const actor = auditAnnotation.read(plan);'],
      ['handle.read(exec)', 'cacheAnnotation.read( exec )'],
      ['plan.meta.annotations', "const stored = plan.meta.annotations?.['audit'];"],
    ])('finds %s', (_name, content) => {
      expect(detects(audience, 'orm-annotations-on-the-call', content)).toBe(true);
    });

    it.each([
      ['handle.read(planner)', 'auditAnnotation.read(planner)'],
      ['handle.read(activity)', 'auditAnnotation.read(activity)'],
      ['meta.annotationsList', 'meta.annotationsList'],
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
  ])('finds %s', (_name, content) => {
    expect(detects('extension', 'queryable-carries-the-activity-source', content)).toBe(true);
  });

  it('skips a spread followed by another member', () => {
    expect(
      detects(
        'extension',
        'queryable-carries-the-activity-source',
        '{ ...runtime,\n  queryTimeout: 1000 }',
      ),
    ).toBe(false);
  });
});
