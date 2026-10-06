import { describe, expectTypeOf, test } from 'vitest';
import { Collection } from '../src/collection';
import type { CollectionRowOf, CollectionTypeStateOf, Ordered } from '../src/collection-types';
import type { Contract as PolyContract } from './fixtures/polymorphism/generated/contract';

class TaskCollection extends Collection<PolyContract, 'Task'> {
  titled(title: string) {
    return this.where((task) => task.title.eq(title));
  }

  newestFirst() {
    return this.orderBy((task) => task.id.desc());
  }
}

declare const tasks: TaskCollection;
declare const flag: boolean;

describe('variant', () => {
  test('drops the class methods', () => {
    // @ts-expect-error titled is a TaskCollection method; variant returns the base Collection type
    tasks.variant('bug').titled('x');
  });

  test('keeps the established order', () => {
    const bugs = tasks.newestFirst().variant('bug');
    expectTypeOf<CollectionTypeStateOf<typeof bugs>['hasOrderBy']>().toEqualTypeOf<true>();
    expectTypeOf(bugs.cursor({ id: 1 })).toEqualTypeOf(bugs);
  });

  test('without an order, cursor stays refused', () => {
    // @ts-expect-error cursor needs an orderBy
    tasks.variant('bug').cursor({ id: 1 });
  });

  test('narrows the row to the variant', async () => {
    const bug = await tasks.variant('bug').first();
    expectTypeOf(bug).toEqualTypeOf<{
      id: number;
      title: string;
      projectId: number | null;
      reporterId: number | null;
      severity: string;
      assigneeId: number | null;
      type: 'bug';
    } | null>();
  });

  test('records its discriminator filter', () => {
    const bugs = tasks.variant('bug');
    expectTypeOf<CollectionTypeStateOf<typeof bugs>['hasWhere']>().toEqualTypeOf<true>();
  });

  test('on a union of differently ordered collections, the fallback overload drops the order', () => {
    const either = flag ? tasks.newestFirst() : tasks.titled('x');
    // @ts-expect-error the fallback overload returns the root state, which has no order
    either.variant('bug').cursor({ id: 1 });
  });

  test('the class survives cursor', () => {
    expectTypeOf(tasks.newestFirst().cursor({ id: 1 })).toEqualTypeOf<Ordered<TaskCollection>>();
  });
});

describe('a write on a polymorphic base', () => {
  test('returns the variant union, with what include added', async () => {
    type TaskRow = CollectionRowOf<TaskCollection>;
    expectTypeOf<Extract<TaskRow, { type: 'bug' }>['severity']>().toEqualTypeOf<string>();
    const titled = tasks.titled('x');
    expectTypeOf(await titled.update({ title: 'y' })).toEqualTypeOf<TaskRow | null>();
    expectTypeOf(await titled.deleteAll().toArray()).toEqualTypeOf<TaskRow[]>();
    expectTypeOf<Awaited<ReturnType<TaskCollection['update']>>>().toEqualTypeOf<TaskRow | null>();

    const withProject = titled.include('project');
    type TaskWithProjectRow = CollectionRowOf<typeof withProject>;
    expectTypeOf<Extract<TaskWithProjectRow, { type: 'bug' }>>().toHaveProperty('project');
    expectTypeOf<
      Extract<TaskWithProjectRow, { type: 'bug' }>['severity']
    >().toEqualTypeOf<string>();
    expectTypeOf(
      await withProject.update({ title: 'y' }),
    ).toEqualTypeOf<TaskWithProjectRow | null>();
    expectTypeOf(await withProject.deleteAll().toArray()).toEqualTypeOf<TaskWithProjectRow[]>();
  });
});
