import type { AnnotationValue } from '@internal/framework-components/runtime';
import { expectTypeOf, test } from 'vitest';
import {
  type CacheMiddleware,
  type InvalidateAnnotationHandle,
  type InvalidationTarget,
  invalidateAnnotation,
} from '../src/exports/index';

interface TagMeta {
  tags: string[];
}

test('invalidateAnnotation produces a write-only annotation value', () => {
  const applied = invalidateAnnotation({ keys: ['user-1'] });

  expectTypeOf(applied).toEqualTypeOf<AnnotationValue<InvalidationTarget, 'write'>>();
  expectTypeOf(applied).not.toExtend<AnnotationValue<InvalidationTarget, 'read'>>();
  expectTypeOf(invalidateAnnotation.applicableTo).toEqualTypeOf<ReadonlySet<'write'>>();
  expectTypeOf(invalidateAnnotation).toEqualTypeOf<InvalidateAnnotationHandle>();
});

test('InvalidationTarget has the shape of invalidate’s argument', () => {
  expectTypeOf<InvalidationTarget<TagMeta>>().toEqualTypeOf<{
    readonly keys?: readonly string[];
    readonly meta?: TagMeta;
  }>();
});

test('invalidateAnnotation.read returns InvalidationTarget | undefined', () => {
  const plan = { meta: { annotations: {} as Record<string, unknown> } };

  expectTypeOf(invalidateAnnotation.read(plan)).toEqualTypeOf<InvalidationTarget | undefined>();
});

test('TMeta checks meta', () => {
  invalidateAnnotation<TagMeta>({ meta: { tags: ['users'] } });

  // @ts-expect-error - meta does not have the shape of TagMeta
  invalidateAnnotation<TagMeta>({ meta: { tag: 'users' } });
});

test('invalidateAnnotation rejects unknown and mistyped options', () => {
  // @ts-expect-error - key is the read annotation's option; a write names keys
  invalidateAnnotation({ key: 'user-1' });

  // @ts-expect-error - keys is a list of strings
  invalidateAnnotation({ keys: 'user-1' });
});

test('invalidate takes the same type as the annotation payload', () => {
  expectTypeOf<Parameters<CacheMiddleware<TagMeta>['invalidate']>[0]>().toEqualTypeOf<
    InvalidationTarget<TagMeta>
  >();
});
