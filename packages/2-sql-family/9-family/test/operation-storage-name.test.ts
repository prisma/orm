import type { MigrationPlanOperation } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { storageNameOfOperation } from '../src/core/migrations/operation-storage-name';

function operation(details: Record<string, string> | undefined): MigrationPlanOperation {
  const op = { id: 'drop.thing', label: 'Drop a thing: carefully', operationClass: 'destructive' };
  return {
    ...op,
    ...(details === undefined ? {} : { target: { id: 'postgres', details } }),
  } as MigrationPlanOperation;
}

describe('storageNameOfOperation', () => {
  it('names a column through its table and schema, and anything else through its schema', () => {
    expect([
      storageNameOfOperation(
        operation({ schema: 'public', objectType: 'column', name: 'nickname', table: 'User' }),
      ),
      storageNameOfOperation(operation({ schema: 'public', objectType: 'table', name: 'Legacy' })),
      storageNameOfOperation(operation({ schema: 'public', objectType: 'type', name: 'mood' })),
      storageNameOfOperation(
        operation({ schema: UNBOUND_NAMESPACE_ID, objectType: 'table', name: 'Legacy' }),
      ),
      storageNameOfOperation(operation({ objectType: 'column', name: 'nickname', table: 'User' })),
    ]).toEqual(['public.User.nickname', 'public.Legacy', 'public.mood', 'Legacy', 'User.nickname']);
  });

  it('names an operation without target details by its id, never its label', () => {
    expect(storageNameOfOperation(operation(undefined))).toBe('drop.thing');
  });
});
