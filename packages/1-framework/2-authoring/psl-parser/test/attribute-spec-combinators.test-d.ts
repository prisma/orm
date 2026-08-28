import { expectTypeOf, test } from 'vitest';
import type { ArgType, BlockInterpretCtx, OutOf } from '../src/exports';
import { identifier, list, num, oneOf, str } from '../src/exports';

test('identifier pins its name as the output literal type', () => {
  expectTypeOf(identifier('NoAction')).toEqualTypeOf<ArgType<'NoAction', BlockInterpretCtx>>();
});

test('oneOf infers the union of its alternatives output types', () => {
  expectTypeOf(oneOf(identifier('NoAction'), identifier('Cascade'))).toEqualTypeOf<
    ArgType<'NoAction' | 'Cascade', BlockInterpretCtx>
  >();
});

test('pinned str preserves its output literal type', () => {
  const pinned = str('hashed');

  expectTypeOf<OutOf<typeof pinned>>().toEqualTypeOf<'hashed'>();
});

test('pinned num preserves its output literal type', () => {
  const pinned = num(-1);

  expectTypeOf<OutOf<typeof pinned>>().toEqualTypeOf<-1>();
});

test('oneOf preserves pinned string and number literal alternatives', () => {
  const pinned = oneOf(str('hashed'), str('2dsphere'), num(-1));

  expectTypeOf<OutOf<typeof pinned>>().toEqualTypeOf<'hashed' | '2dsphere' | -1>();
});

test('oneOf with no alternatives is a compile error', () => {
  // @ts-expect-error oneOf requires at least one alternative
  oneOf();
});

test('list infers an array of its element type', () => {
  expectTypeOf(list(str())).toEqualTypeOf<ArgType<string[], BlockInterpretCtx>>();
});
