import type { AnnotationValue } from '@prisma-next/framework-components/runtime';
import { expectTypeOf, test } from 'vitest';
import {
  type UncacheAction,
  type UncachePayload,
  uncacheAnnotation,
} from '../src/uncache-annotation';

test('uncacheAnnotation call signature preserves payload type', () => {
  const applied = uncacheAnnotation({ enabled: true });
  expectTypeOf(applied).toEqualTypeOf<AnnotationValue<UncachePayload, 'write'>>();
});

test('uncacheAnnotation exposes write applicability only', () => {
  expectTypeOf(uncacheAnnotation.applicableTo).toEqualTypeOf<ReadonlySet<'write'>>();
});

test('UncacheAction accepts namespace and keys', () => {
  expectTypeOf<UncacheAction>().toMatchTypeOf<{
    readonly namespace?: string;
    readonly keys?: readonly string[];
    readonly models?: readonly string[];
  }>();
});

test('UncachePayload accepts uncache field', () => {
  expectTypeOf<UncachePayload['uncache']>().toEqualTypeOf<readonly UncacheAction[] | undefined>();
});

test('uncacheAnnotation rejects invalid payload fields', () => {
  // @ts-expect-error invalid field
  uncacheAnnotation({ foo: true });

  // @ts-expect-error wrong type
  uncacheAnnotation({ enabled: 'yes' });
});
