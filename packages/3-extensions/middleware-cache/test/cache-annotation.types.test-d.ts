import type { AnnotationValue, OperationKind } from '@internal/framework-components/runtime';
import { expectTypeOf, test } from 'vitest';
import { type CacheAnnotationOptions, cacheAnnotation } from '../src/cache-annotation';

test('cacheAnnotation call signature preserves the CacheAnnotationOptions type', () => {
  const applied = cacheAnnotation({ key: 'user-1' });
  expectTypeOf(applied).toEqualTypeOf<AnnotationValue<CacheAnnotationOptions, 'read'>>();
});

test('cacheAnnotation call rejects non-CacheAnnotationOptions arguments', () => {
  // @ts-expect-error - unknown field on the options
  cacheAnnotation({ key: 'k', nonsense: true });

  // @ts-expect-error - wrong field type
  cacheAnnotation({ key: 1 });

  // @ts-expect-error - wrong field type
  cacheAnnotation({ bypass: 'yes' });

  // @ts-expect-error - ttl was removed; lifetime is the store's policy
  cacheAnnotation({ ttl: 60 });

  // @ts-expect-error - skip was renamed to bypass
  cacheAnnotation({ skip: true });
});

test('cacheAnnotation.read returns CacheAnnotationOptions | undefined', () => {
  const plan = {
    meta: {
      target: 'postgres',
      targetFamily: 'sql' as const,
      storageHash: 'test',
      lane: 'orm',
      paramDescriptors: [],
      annotations: {} as Record<string, unknown>,
    },
  };
  const result = cacheAnnotation.read(plan);
  expectTypeOf(result).toEqualTypeOf<CacheAnnotationOptions | undefined>();
});

test('cacheAnnotation declares applicableTo = "read" only', () => {
  // The handle's Kinds parameter is the literal type 'read', not the wider
  // OperationKind union. This is what gates write terminals from accepting
  // it via ValidAnnotations<'write', As>.
  expectTypeOf(cacheAnnotation.applicableTo).toEqualTypeOf<ReadonlySet<'read'>>();
});

test('CacheAnnotationOptions has optional key, meta and bypass', () => {
  expectTypeOf<CacheAnnotationOptions>().toEqualTypeOf<{
    readonly key?: string;
    readonly meta?: unknown;
    readonly bypass?: boolean;
  }>();
});

test('cacheAnnotation is not applicable to write operations at the type level', () => {
  // The handle's literal Kinds = 'read'. The applicableTo set type is
  // `ReadonlySet<'read'>`, not `ReadonlySet<OperationKind>` — so a
  // consumer asking whether 'write' is in the kind set sees `false`.
  type Kinds = typeof cacheAnnotation extends {
    readonly applicableTo: ReadonlySet<infer K>;
  }
    ? K
    : never;
  type WriteApplies = 'write' extends Kinds ? true : false;
  expectTypeOf<WriteApplies>().toEqualTypeOf<false>();

  // And the AnnotationValue produced by calling the handle carries 'read'
  // specifically, so ValidAnnotations<'write', [typeof applied]> resolves to [never].
  const applied = cacheAnnotation({ key: 'user-1' });
  expectTypeOf(applied).toExtend<AnnotationValue<CacheAnnotationOptions, 'read'>>();
  // The applied value is NOT assignable to AnnotationValue<CacheAnnotationOptions, 'write'>.
  expectTypeOf(applied).not.toExtend<AnnotationValue<CacheAnnotationOptions, 'write'>>();
});

test('OperationKind import is not accidentally widened by cacheAnnotation', () => {
  // Sanity: the framework's OperationKind union is unchanged.
  expectTypeOf<OperationKind>().toEqualTypeOf<'read' | 'write'>();
});
