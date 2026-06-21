import type { AnnotationValue, OperationKind } from '@internal/framework-components/runtime';
import { expectTypeOf, test } from 'vitest';
import { type CachePayload, cacheAnnotation } from '../src/cache-annotation';

test('cacheAnnotation call signature preserves the CachePayload type', () => {
  const applied = cacheAnnotation({ ttl: 60 });
  expectTypeOf(applied).toEqualTypeOf<AnnotationValue<CachePayload, 'read'>>();
});

test('cacheAnnotation call rejects non-CachePayload arguments', () => {
  // @ts-expect-error - unknown field on payload
  cacheAnnotation({ ttl: 60, nonsense: true });

  // @ts-expect-error - wrong field type
  cacheAnnotation({ ttl: '60' });

  // @ts-expect-error - wrong field type
  cacheAnnotation({ skip: 'yes' });
});

test('cacheAnnotation.read returns CachePayload | undefined', () => {
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
  expectTypeOf(result).toEqualTypeOf<CachePayload | undefined>();
});

test('cacheAnnotation declares applicableTo = "read" only', () => {
  // The handle's Kinds parameter is the literal type 'read', not the wider
  // OperationKind union. This is what gates write terminals from accepting
  // it via ValidAnnotations<'write', As>.
  expectTypeOf(cacheAnnotation.applicableTo).toEqualTypeOf<ReadonlySet<'read'>>();
});

test('CachePayload has optional enabled, ttl, skip, key, namespace, and dedupe', () => {
  const empty: CachePayload = {};
  void empty;

  const enabledOnly: CachePayload = { enabled: true };
  void enabledOnly;

  const ttlOnly: CachePayload = { ttl: 60 };
  void ttlOnly;

  const skipOnly: CachePayload = { skip: true };
  void skipOnly;

  const keyOnly: CachePayload = { key: 'k' };
  void keyOnly;

  const namespaceOnly: CachePayload = { namespace: 'tenant-a' };
  void namespaceOnly;

  const dedupeOnly: CachePayload = { dedupe: true };
  void dedupeOnly;

  const all: CachePayload = {
    enabled: true,
    ttl: 60,
    skip: false,
    key: 'k',
    namespace: 'tenant-a',
    dedupe: true,
  };
  void all;
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
  const applied = cacheAnnotation({ ttl: 60 });
  expectTypeOf(applied).toExtend<AnnotationValue<CachePayload, 'read'>>();
  // The applied value is NOT assignable to AnnotationValue<CachePayload, 'write'>.
  expectTypeOf(applied).not.toExtend<AnnotationValue<CachePayload, 'write'>>();
});

test('OperationKind import is not accidentally widened by cacheAnnotation', () => {
  // Sanity: the framework's OperationKind union is unchanged.
  expectTypeOf<OperationKind>().toEqualTypeOf<'read' | 'write'>();
});
