import { describe, expectTypeOf, test } from 'vitest';
import type {
  MutationCreateInput,
  MutationUpdateInput,
  RelationMutationCreate,
  VariantRelationMutator,
} from '../src/types';
import type { Contract } from './fixtures/polymorphism/generated/contract';

type ProjectCreate = MutationCreateInput<Contract, 'Project'>;
type ProjectUpdate = MutationUpdateInput<Contract, 'Project'>;
type CommentCreate = MutationCreateInput<Contract, 'TaskComment'>;
type CommentUpdate = MutationUpdateInput<Contract, 'TaskComment'>;
type LabelCreate = MutationCreateInput<Contract, 'Label'>;
type LabelUpdate = MutationUpdateInput<Contract, 'Label'>;
type TaskUpdate = MutationUpdateInput<Contract, 'Task'>;

describe('variant() on the mutator of a polymorphic target', () => {
  test('create takes the base and variant fields without the discriminator, one row or an array', () => {
    const create: ProjectCreate = {
      name: 'Launch',
      tasks: (tasks) => {
        expectTypeOf(
          tasks.variant('bug').create({ title: 'Crash', severity: 'high' }),
        ).toEqualTypeOf<RelationMutationCreate<Contract, 'Task'>>();
        return [
          tasks.variant('bug').create({ title: 'Crash', severity: 'high' }),
          tasks.variant('feature').create([{ title: 'Dark mode', priority: 1 }]),
        ];
      },
    };
    const update: ProjectUpdate = {
      tasks: (tasks) => tasks.variant('epic').create({ title: 'Q3', scope: 'all' }),
    };
    const toOne: CommentCreate = {
      body: 'Hi',
      task: (task) => task.variant('bug').create({ title: 'Crash', severity: 'low' }),
    };
    const toOneUpdate: CommentUpdate = {
      task: (task) => task.variant('feature').create({ title: 'Dark mode', priority: 1 }),
    };
    const junction: LabelCreate = {
      name: 'ui',
      tasks: (tasks) => tasks.variant('bug').create([{ title: 'Crash', severity: 'high' }]),
    };
    const junctionUpdate: LabelUpdate = {
      tasks: (tasks) => tasks.variant('feature').create({ title: 'Dark mode', priority: 2 }),
    };

    expectTypeOf([create, update, toOne, toOneUpdate, junction, junctionUpdate]).toExtend<
      readonly unknown[]
    >();
  });

  test('create rejects the discriminator, a field of another variant and a missing required field', () => {
    const update: ProjectUpdate = {
      tasks: (tasks) => [
        // @ts-expect-error
        tasks.variant('bug').create({ title: 'Crash', severity: 'high', type: 'bug' }),
        // @ts-expect-error
        tasks.variant('bug').create({ title: 'Crash', severity: 'high', priority: 1 }),
        // @ts-expect-error
        tasks.variant('feature').create([{ title: 'Dark mode' }]),
      ],
    };

    expectTypeOf(update).toExtend<ProjectUpdate>();
  });

  test('takes only the declared discriminator values', () => {
    const update: ProjectUpdate = {
      // @ts-expect-error
      tasks: (tasks) => tasks.variant('story').create({ title: 'Crash' }),
    };

    expectTypeOf(update).toExtend<ProjectUpdate>();
  });

  test('create without variant() takes no data', () => {
    const update: ProjectUpdate = {
      // @ts-expect-error
      tasks: (tasks) => tasks.create({ title: 'Crash', type: 'bug' }),
    };
    const toOne: CommentUpdate = {
      // @ts-expect-error
      task: (task) => task.create([{ title: 'Crash', type: 'bug' }]),
    };

    expectTypeOf([update, toOne]).toExtend<readonly unknown[]>();
  });

  test('the variant mutator has the operations of the base mutator except variant', () => {
    expectTypeOf<keyof VariantRelationMutator<Contract, 'Task', 'bug'>>().toEqualTypeOf<
      'create' | 'connect' | 'disconnect' | 'where' | 'updateAll' | 'deleteAll'
    >();

    const update: ProjectUpdate = {
      tasks: (tasks) => {
        const bugs = tasks.variant('bug');
        expectTypeOf(bugs).not.toHaveProperty('variant');
        return bugs.create({ title: 'Crash', severity: 'high' });
      },
    };

    expectTypeOf(update).toExtend<ProjectUpdate>();
  });

  test('where on the variant mutator filters by the fields of the variant, as a variant collection does', () => {
    const update: ProjectUpdate = {
      tasks: (tasks) => [
        tasks
          .variant('bug')
          .where((bug) => bug.severity.eq('high'))
          .updateAll({ title: 'Triaged' }),
        tasks
          .variant('feature')
          .where((feature) => feature.priority.gt(2))
          .where({ title: 'Dark mode' })
          .deleteAll(),
        tasks.variant('bug').updateAll({ title: 'Seen' }),
        tasks.variant('feature').deleteAll(),
      ],
    };
    const junction: LabelUpdate = {
      tasks: (tasks) =>
        tasks
          .variant('feature')
          .where((feature) => feature.priority.eq(1))
          .updateAll({ title: 'Top' }),
    };

    expectTypeOf([update, junction]).toExtend<readonly unknown[]>();
  });

  test('where and updateAll on the variant mutator reject what the variant collection rejects', () => {
    const update: ProjectUpdate = {
      tasks: (tasks) => [
        tasks
          .variant('bug')
          // @ts-expect-error
          .where((bug) => bug.priority.eq(1))
          .deleteAll(),
        // @ts-expect-error
        tasks.variant('bug').updateAll({ severity: 'low' }),
        // @ts-expect-error
        tasks.variant('bug').updateAll({ projectId: 2 }),
        // @ts-expect-error
        tasks.variant('bug').where({ title: 'Crash' }).connect({ id: 1 }),
      ],
    };

    expectTypeOf(update).toExtend<ProjectUpdate>();
  });

  test('where, updateAll and deleteAll on the variant mutator are refused in create() and on to-one relations', () => {
    const inCreate: ProjectCreate = {
      name: 'Launch',
      // @ts-expect-error
      tasks: (tasks) => tasks.variant('bug').deleteAll(),
    };
    const toOne: CommentUpdate = {
      // @ts-expect-error
      task: (task) => task.variant('bug').where({ title: 'Crash' }).updateAll({ title: 'Seen' }),
    };

    expectTypeOf([inCreate, toOne]).toExtend<readonly unknown[]>();
  });

  test('connect on the variant mutator takes the criteria of the base model on every layout', () => {
    const create: ProjectCreate = {
      name: 'Launch',
      tasks: (tasks) => tasks.variant('bug').connect([{ id: 1 }, { id: 2 }]),
    };
    const update: ProjectUpdate = {
      tasks: (tasks) => tasks.variant('feature').connect({ id: 1 }),
    };
    const toOne: CommentUpdate = {
      task: (task) => task.variant('bug').connect({ id: 1 }),
    };
    const toOneCreate: CommentCreate = {
      body: 'Hi',
      task: (task) => task.variant('bug').connect({ id: 1 }),
    };
    const junction: LabelUpdate = {
      tasks: (tasks) => tasks.variant('feature').connect([{ id: 1 }]),
    };

    expectTypeOf([create, update, toOne, toOneCreate, junction]).toExtend<readonly unknown[]>();
  });

  test('disconnect on the variant mutator follows the base mutator on 1:N and M:N', () => {
    const update: ProjectUpdate = {
      tasks: (tasks) => [
        tasks.variant('bug').disconnect(),
        tasks.variant('feature').disconnect([{ id: 2 }]),
      ],
    };
    const junction: LabelUpdate = {
      tasks: (tasks) => tasks.variant('bug').disconnect([{ id: 1 }]),
    };
    const bareJunction: LabelUpdate = {
      // @ts-expect-error
      tasks: (tasks) => tasks.variant('bug').disconnect(),
    };
    const inCreate: ProjectCreate = {
      name: 'Launch',
      // @ts-expect-error
      tasks: (tasks) => tasks.variant('bug').disconnect([{ id: 1 }]),
    };

    expectTypeOf([update, junction, bareJunction, inCreate]).toExtend<readonly unknown[]>();
  });

  test('disconnect on the variant mutator takes nothing on N:1', () => {
    const toOne: CommentUpdate = {
      // @ts-expect-error
      task: (task) => task.variant('bug').disconnect(),
    };
    const withCriteria: CommentUpdate = {
      // @ts-expect-error
      task: (task) => task.variant('bug').disconnect([{ id: 1 }]),
    };
    const base: CommentUpdate = {
      task: (task) => task.disconnect(),
    };

    expectTypeOf([toOne, withCriteria, base]).toExtend<readonly unknown[]>();
  });

  test('the mutator of a polymorphic target keeps connect and the filtered writes', () => {
    const update: ProjectUpdate = {
      tasks: (tasks) => [
        tasks.connect({ id: 1 }),
        tasks.disconnect([{ id: 2 }]),
        tasks.where({ title: 'Crash' }).updateAll({ title: 'Crash on login' }),
      ],
    };

    expectTypeOf(update).toExtend<ProjectUpdate>();
  });
});

describe('variant() on the mutator of a target that is not polymorphic', () => {
  test('is absent', () => {
    const update: TaskUpdate = {
      comments: (comments) => {
        expectTypeOf(comments).not.toHaveProperty('variant');
        return comments.create({ body: 'Hi' });
      },
    };

    expectTypeOf(update).toExtend<TaskUpdate>();
  });
});
