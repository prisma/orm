import { test } from 'vitest';
import type { Db } from '../../src/exports/types';
import type { Contract } from '../fixtures/generated/contract';

declare const db: Db<Contract>;

test('a self-join names the outer table by the alias given with as()', () => {
  db.public.posts
    .as('p1')
    .innerJoin(db.public.posts.as('p2'), (f, fns) => fns.ne(f.p1.user_id, f.p2.user_id))
    .select((f) => ({ first: f.p1.id, second: f.p2.id }))
    .build();
});

test('a self-join whose outer table has no alias has no p1 in scope', () => {
  db.public.posts
    // @ts-expect-error the outer table keeps its own name, posts
    .innerJoin(db.public.posts.as('p2'), (f, fns) => fns.ne(f.p1.user_id, f.p2.user_id))
    .select((f) => ({ first: f.posts.id, second: f.p2.id }))
    .build();
});
