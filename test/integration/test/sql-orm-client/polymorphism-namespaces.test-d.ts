import type { orm } from '@internal/sql-orm-client';
import { expectTypeOf, test } from 'vitest';
import type { Contract } from './fixtures/polymorphism-namespaces/generated/contract';

declare const db: ReturnType<typeof orm<Contract>>;
const tasks = db.a.Task;

test('same-named variants in two namespaces have their own row types', () => {
  expectTypeOf(tasks.variant('b-epic').all()).resolves.items.toEqualTypeOf<{
    id: number;
    title: string;
    projectId: number | null;
    type: 'b-epic';
    size: number;
  }>();
  expectTypeOf(tasks.variant('c-epic').all()).resolves.items.toEqualTypeOf<{
    id: number;
    title: string;
    projectId: number | null;
    type: 'c-epic';
    size: string;
  }>();
});

test('same-named variants in two namespaces have their own create inputs', () => {
  tasks.variant('b-epic').create({ id: 1, title: 'Roadmap', size: 8 });
  tasks.variant('c-epic').create({ id: 1, title: 'Vision', size: 'large' });
  // @ts-expect-error b.Epic.size is a number
  tasks.variant('b-epic').create({ id: 1, title: 'Roadmap', size: 'large' });
  // @ts-expect-error c.Epic.size is a string
  tasks.variant('c-epic').create({ id: 1, title: 'Vision', size: 8 });
});

test('a variant in another namespace exposes its fields and relations', () => {
  const chores = tasks.variant('chore');
  expectTypeOf(chores.where((task) => task.effort.gt(1))).not.toBeNever();
  expectTypeOf(chores.where((task) => task.owner.some())).not.toBeNever();
  expectTypeOf(chores.include('owner').all()).resolves.items.toEqualTypeOf<{
    id: number;
    title: string;
    projectId: number | null;
    type: 'chore';
    effort: number;
    ownerId: number | null;
    owner: { id: number; name: string } | null;
  }>();
});

test('variant() takes only the values the base in its own namespace declares', () => {
  expectTypeOf(db.b.Doc.variant('memo').all()).resolves.items.toEqualTypeOf<{
    id: number;
    kind: 'memo';
    body: string;
  }>();
  // @ts-expect-error 'note' is declared by c.Doc
  db.b.Doc.variant('note');
  // @ts-expect-error 'memo' is declared by b.Doc
  db.c.Doc.variant('memo');
});
