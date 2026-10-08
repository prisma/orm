import type { MigrationPlanOperation } from '@internal/framework-components/control';
import { DropCollectionCommand } from '@internal/mongo-query-ast/control';
import { describe, expect, it } from 'vitest';
import { mongoStorageNameOf } from '../src/core/operation-storage-name';

function operation(execute: readonly unknown[]): MigrationPlanOperation {
  const op = { id: 'collection.events.drop', label: 'Drop collection events: all of it' };
  return { ...op, operationClass: 'destructive', execute } as MigrationPlanOperation;
}

describe('mongoStorageNameOf', () => {
  it('names the collection the command names, as the planner names a dropped collection', () => {
    expect([
      mongoStorageNameOf(
        operation([{ description: 'drop', command: new DropCollectionCommand('events') }]),
      ),
      mongoStorageNameOf(
        operation([
          { description: 'drop', command: { kind: 'dropCollection', collection: 'logs' } },
        ]),
      ),
    ]).toEqual(['events', 'logs']);
  });

  it('names an operation whose commands name no collection by its id, never its label', () => {
    expect(mongoStorageNameOf(operation([]))).toBe('collection.events.drop');
  });
});
