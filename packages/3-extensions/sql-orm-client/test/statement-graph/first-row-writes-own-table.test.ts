import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import {
  createCollectionFor,
  withoutCapabilityKeys,
  withReturningCapability,
} from '../collection-fixtures';
import { buildMixedPolyContract } from '../helpers';
import { sent } from './sent-statements';

const noSubtasks = 'not exists (select parent_id from tasks tasks_2 where parent_id = tasks.id)';
const allTaskColumns = 'id, title, type, severity, project_id, parent_id, assignee_id';

const databases = [
  {
    name: 'with RETURNING',
    contract: withReturningCapability(buildMixedPolyContract()),
    returning: (columns: string) => ` returning ${columns}`,
  },
  {
    name: 'without RETURNING',
    contract: withoutCapabilityKeys(buildMixedPolyContract(), ['returning']),
    returning: (_columns: string) => '',
  },
] as const;

interface TaskRows {
  where(filter: ((task: TaskFields) => unknown) | Readonly<Record<string, unknown>>): TaskRows;
  variant(value: 'feature'): TaskRows;
  update(data: Readonly<Record<string, unknown>>): Promise<unknown>;
  delete(): Promise<unknown>;
}

interface TaskFields {
  readonly subtasks: { none(): unknown };
}

function tasks(contract: (typeof databases)[number]['contract']) {
  const { collection, runtime } = createCollectionFor('Task' as never, contract);
  runtime.setNextResults([[{ id: 2 }], [{ id: 2 }], [{ id: 2 }]]);
  runtime.setNextStats([{ affectedRows: 1 }]);
  return {
    tasks: blindCast<
      TaskRows,
      'the mixed polymorphic test contract adds Task outside the static fixture type'
    >(collection),
    runtime,
  };
}

describe.each(databases)(
  'delete() and update() whose filter reads the table they write ($name)',
  ({ contract, returning }) => {
    it('update() after a relation filter from the model to itself writes the row it found by key alone', async () => {
      const { tasks: rows, runtime } = tasks(contract);

      await rows.where((task) => task.subtasks.none()).update({ title: 'Leaf' });

      expect(sent(runtime)).toEqual([
        `select tasks left join features where ${noSubtasks} limit 1`,
        `update tasks where id = 2${returning('id')}`,
        'select tasks left join features where id = 2',
      ]);
    });

    it('delete() after a relation filter from the model to itself deletes the row it found by key alone', async () => {
      const { tasks: rows, runtime } = tasks(contract);

      await rows.where((task) => task.subtasks.none()).delete();

      expect(sent(runtime)).toEqual([
        `select tasks left join features where ${noSubtasks} limit 1`,
        `delete tasks where id = 2${returning(allTaskColumns)}`,
      ]);
    });

    it('update() of a variant stored in its own table writes the row it found by key alone', async () => {
      const { tasks: rows, runtime } = tasks(contract);

      await rows.variant('feature').where({ id: 2 }).update({ title: 'Second' });

      expect(sent(runtime)).toEqual([
        "select tasks inner join features where (type = 'feature' and id = 2) limit 1",
        `update tasks where id = 2${returning('id')}`,
        'select tasks inner join features where id = 2',
      ]);
    });

    it('update() and delete() whose filter names a unique key keep the whole filter in the write', async () => {
      const { tasks: rows, runtime } = tasks(contract);
      const pinned = rows.where((task) => task.subtasks.none()).where({ id: 2 });

      await pinned.update({ title: 'Pinned' });
      runtime.setNextResults([[{ id: 2 }], [{ id: 2 }]]);
      await pinned.delete();

      const condition = `(${noSubtasks} and id = 2)`;
      expect(sent(runtime)).toEqual([
        `select tasks left join features where ${condition}`,
        `update tasks where (${condition} and id = 2)${returning('id')}`,
        'select tasks left join features where id = 2',
        `select tasks left join features where ${condition}`,
        `delete tasks where (${condition} and id = 2)${returning(allTaskColumns)}`,
      ]);
    });

    it('update() whose filter does not read the table it writes still carries the filter', async () => {
      const { tasks: rows, runtime } = tasks(contract);

      await rows.where({ title: 'Crash' }).update({ title: 'Crash!' });

      expect(sent(runtime)).toEqual([
        "select tasks left join features where title = 'Crash' limit 1",
        `update tasks where (title = 'Crash' and id = 2)${returning('id')}`,
        'select tasks left join features where id = 2',
      ]);
    });
  },
);
