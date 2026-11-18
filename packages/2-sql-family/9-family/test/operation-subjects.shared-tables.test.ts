import { describe, expect, it } from 'vitest';
import { subjectsOfCalls } from '../src/core/migrations/operation-subjects';
import { NO_RENAMED_ORIGINS } from '../src/core/migrations/statement-planning';
import {
  app,
  byHand,
  column,
  losing,
  renamesBetween,
  table,
  unchanged,
} from './operation-subjects-fixtures';
import { contractOf } from './statement-fixtures';

describe('subjectsOfCalls for models that share a table', () => {
  describe('a removed variant', () => {
    const tasks = contractOf({
      Task: { table: 'tasks', fields: { id: 'id', type: 'type' } },
      Bug: { table: 'tasks', fields: { severity: 'severity' }, base: 'Task' },
    });
    const bug = { namespaceId: app, model: 'Bug' };

    it('names the variant for its row deletion and its dropped columns', () => {
      expect(
        subjectsOfCalls(
          [
            {
              ...unchanged,
              label: 'Delete rows',
              dataLoss: [{ ...table('tasks'), model: bug, loss: 'drop' }],
            },
            losing(column('tasks', 'severity')),
          ],
          {
            fromContract: tasks,
            contract: tasks,
            renames: renamesBetween(tasks, tasks),
            byHand,
            removedVariants: [bug],
            origins: NO_RENAMED_ORIGINS,
          },
        ).dataLoss.map(({ subject }) => subject),
      ).toEqual([
        { kind: 'model', ...bug },
        { kind: 'model', ...bug },
      ]);
    });

    it('passes on the advice a target gives for a row deletion', () => {
      expect(
        subjectsOfCalls(
          [
            {
              ...unchanged,
              label: 'Delete rows',
              dataLoss: [
                {
                  ...table('tasks'),
                  model: bug,
                  loss: 'drop',
                  keepDataAdvice: 'Mind the references.',
                },
              ],
            },
          ],
          {
            fromContract: tasks,
            contract: tasks,
            renames: renamesBetween(tasks, tasks),
            byHand,
            removedVariants: [],
            origins: NO_RENAMED_ORIGINS,
          },
        ).dataLoss,
      ).toEqual([
        {
          operationIndex: 0,
          subject: { kind: 'model', ...bug },
          loss: 'drop',
          label: 'Delete rows',
          keepDataAdvice: 'Mind the references.',
        },
      ]);
    });

    it('names the field of a dropped column of a variant the destination keeps', () => {
      expect(
        subjectsOfCalls([losing(column('tasks', 'severity'))], {
          fromContract: tasks,
          contract: tasks,
          renames: renamesBetween(tasks, tasks),
          byHand,
          removedVariants: [],
          origins: NO_RENAMED_ORIGINS,
        }).dataLoss.map(({ subject }) => subject),
      ).toEqual([{ kind: 'field', ...bug, field: 'severity' }]);
    });
  });

  describe('models that share a table', () => {
    const sharing = contractOf({
      Admin: { table: 'users', base: 'User', fields: { id: 'id', level: 'level' } },
      Guest: { table: 'users', base: 'User', fields: { id: 'id' } },
      User: { table: 'users', fields: { id: 'id', email: 'email' } },
    });

    it('names the root model of a dropped table, and the model with a field for a dropped column', () => {
      expect(
        subjectsOfCalls([losing(table('users')), losing(column('users', 'email'))], {
          fromContract: sharing,
          contract: sharing,
          renames: renamesBetween(sharing, sharing),
          byHand,
          removedVariants: [],
          origins: NO_RENAMED_ORIGINS,
        }).dataLoss.map(({ subject }) => subject),
      ).toEqual([
        { kind: 'model', namespaceId: app, model: 'User' },
        { kind: 'field', namespaceId: app, model: 'User', field: 'email' },
      ]);
    });

    it('names a field only a variant has through the variant', () => {
      expect(
        subjectsOfCalls([losing(column('users', 'level'))], {
          fromContract: sharing,
          contract: sharing,
          renames: renamesBetween(sharing, sharing),
          byHand,
          removedVariants: [],
          origins: NO_RENAMED_ORIGINS,
        }).dataLoss.map(({ subject }) => subject),
      ).toEqual([{ kind: 'field', namespaceId: app, model: 'Admin', field: 'level' }]);
    });
  });
});
