import { AsyncIterableResult, defineAnnotation } from '@internal/framework-components/runtime';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { createCollectionFor } from './collection-fixtures';

function source(rows: Record<string, unknown>[]) {
  return new AsyncIterableResult(
    (async function* () {
      yield* rows;
    })(),
  );
}

const annotation = defineAnnotation<{ label: string }>()({
  namespace: 'prepared-aggregate-test',
  applicableTo: ['read'],
});

describe('prepared aggregate', () => {
  it('captures selectors, configuration and empty metadata once without querying or decoding rows twice', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    const selector = vi.fn((agg: Parameters<Parameters<typeof collection.aggregate>[0]>[0]) => ({
      total: agg.countBigInt(),
      sum: agg.sumBigInt('views'),
    }));
    const configure = vi.fn(
      (meta: Parameters<NonNullable<Parameters<typeof collection.aggregate>[1]>>[0]) =>
        meta.annotate(annotation({ label: 'stats' })),
    );
    const description = collection.where({ userId: 2 }).prepared.aggregate(selector, configure);
    expectTypeOf(description.consume).returns.toEqualTypeOf<
      Promise<{ total: bigint; sum: bigint | null }>
    >();
    expect(runtime.executions).toEqual([]);
    expect(annotation.read(description.plan)).toEqual({ label: 'stats' });
    expect(
      await description.consume(
        source([
          { total: 4n, sum: 12n },
          { total: 9n, sum: 99n },
        ]),
      ),
    ).toEqual({ total: 4n, sum: 12n });
    const [a, b] = await Promise.all([
      description.consume(source([])),
      description.consume(source([{ total: null }])),
    ]);
    expect(a).toEqual({ total: 0n, sum: null });
    expect(b).toEqual(a);
    expect(a).not.toBe(b);
    expect(selector).toHaveBeenCalledOnce();
    expect(configure).toHaveBeenCalledOnce();
    runtime.setNextResults([[{ total: 4n, sum: 12n }]]);
    expect(await collection.where({ userId: 2 }).aggregate(selector, configure)).toEqual({
      total: 4n,
      sum: 12n,
    });
    expect(runtime.executions[0]?.plan).toEqual(description.plan);
  });

  it.each([
    {
      rows: [{ ['__proto__']: 4n, constructor: 5n }],
      expected: { ['__proto__']: 4n, constructor: 5n },
    },
    { rows: [], expected: { ['__proto__']: 0n, constructor: 0n } },
    { rows: [{}], expected: { ['__proto__']: 0n, constructor: 0n } },
    {
      rows: [{ ['__proto__']: null, constructor: undefined }],
      expected: { ['__proto__']: 0n, constructor: 0n },
    },
  ])('preserves own aggregate aliases for $rows', async ({ rows, expected }) => {
    const { collection, runtime } = createCollectionFor('Post');
    const selector = (agg: Parameters<Parameters<typeof collection.aggregate>[0]>[0]) => ({
      ['__proto__']: agg.countBigInt(),
      constructor: agg.countBigInt(),
    });
    const description = collection.prepared.aggregate(selector);
    const first = await description.consume(source(rows));
    const second = await description.consume(source(rows));
    runtime.setNextResults([rows]);
    const ordinary = await collection.aggregate(selector);
    for (const result of [first, second, ordinary]) {
      expect(result).toEqual(expected);
      expect(Object.keys(result)).toEqual(['__proto__', 'constructor']);
      expect(Object.hasOwn(result, '__proto__')).toBe(true);
      expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    }
    expect(first).not.toBe(second);
    expect(first).not.toBe(ordinary);
  });

  it('validates before calling the annotation callback', () => {
    const { collection, runtime } = createCollectionFor('Post');
    const configure = vi.fn();
    expect(() => collection.prepared.aggregate(() => ({}), configure)).toThrow(
      expect.objectContaining({ code: 'ORM.AGGREGATE_SELECTOR_MISSING' }),
    );
    expect(() =>
      collection.prepared.aggregate(() => ({ invalid: {} as never }), configure),
    ).toThrow(expect.objectContaining({ code: 'ORM.AGGREGATE_SELECTOR_INVALID' }));
    expect(configure).not.toHaveBeenCalled();
    expect(runtime.executions).toEqual([]);
  });
});
