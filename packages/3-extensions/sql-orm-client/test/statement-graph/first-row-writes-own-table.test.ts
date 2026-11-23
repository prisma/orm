import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import {
  createCollectionFor,
  withoutCapabilityKeys,
  withReturningCapability,
} from '../collection-fixtures';
import { buildMixedPolyContract } from '../helpers';
import { sent } from './sent-statements';

const databases = [
  ['with RETURNING', withReturningCapability(buildMixedPolyContract())],
  ['without RETURNING', withoutCapabilityKeys(buildMixedPolyContract(), ['returning'])],
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

function tasks(contract: (typeof databases)[number][1]) {
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
  'delete() and update() whose filter reads the table they write (%s)',
  (_, contract) => {
    it('update() after a relation filter from the model to itself writes the row it found by key alone', async () => {
      const { tasks: rows, runtime } = tasks(contract);

      await rows.where((task) => task.subtasks.none()).update({ title: 'Leaf' });

      expect(sent(runtime)[1]).toMatch(/^update tasks where id = 2( returning .*)?$/);
    });

    it('delete() after a relation filter from the model to itself deletes the row it found by key alone', async () => {
      const { tasks: rows, runtime } = tasks(contract);

      await rows.where((task) => task.subtasks.none()).delete();

      expect(sent(runtime)[1]).toMatch(/^delete tasks where id = 2( returning .*)?$/);
    });

    it('update() of a variant stored in its own table writes the row it found by key alone', async () => {
      const { tasks: rows, runtime } = tasks(contract);

      await rows.variant('feature').where({ id: 2 }).update({ title: 'Second' });

      expect(sent(runtime)[1]).toMatch(/^update tasks where id = 2( returning .*)?$/);
    });

    it('update() whose filter does not read the table it writes still carries the filter', async () => {
      const { tasks: rows, runtime } = tasks(contract);

      await rows.where({ title: 'Crash' }).update({ title: 'Crash!' });

      expect(sent(runtime)[1]).toMatch(
        /^update tasks where \(title = 'Crash' and id = 2\)( returning .*)?$/,
      );
    });
  },
);
