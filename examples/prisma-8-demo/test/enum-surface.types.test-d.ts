import type { ResultType } from '@prisma/orm-postgres/components/runtime';
import type { Char } from '@prisma/orm-postgres/target/codec-types';
import { expectTypeOf, test } from 'vitest';
import { type enums, sql } from '../src/prisma-no-emit/context';

type Priority = 0 | 1 | 2;

test('reading Post.priority yields the value union, not number', () => {
  const plan = sql.post.select('id', 'priority').build();
  type Row = ResultType<typeof plan>;
  // The non-enum id keeps its preset's output type, Char<36>, unaffected by narrowing.
  expectTypeOf<Row['id']>().toEqualTypeOf<Char<36>>();
  // The non-null enum column narrows to its value union — no spurious `| null`.
  expectTypeOf<Row['priority']>().toEqualTypeOf<Priority>();
});

test('writing Post.priority only accepts the value union', () => {
  sql.post.insert([{ id: 'a', title: 'ok', userId: 'u', priority: 1 }]).build();

  sql.post.insert([
    // @ts-expect-error 3 is not a Priority member value.
    { id: 'b', title: 'bad', userId: 'u', priority: 3 },
  ]);
});

test('db.enums value tuple keeps its literal declaration order', () => {
  type Values = (typeof enums)['public']['Priority']['values'];
  expectTypeOf<Values>().toEqualTypeOf<readonly [0, 1, 2]>();
});
