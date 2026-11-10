import { crossRef } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { collectionRootModelsOf } from '../src/collection-root-models';

const stored = (collection: string) => ({ storage: { collection } });

describe('collectionRootModelsOf', () => {
  it('lists the root models of each collection by name, leaving out variants and embedded models', () => {
    expect(
      collectionRootModelsOf({
        User: stored('users'),
        Admin: stored('users'),
        Task: stored('tasks'),
        Bug: { ...stored('tasks'), base: crossRef('Task') },
        Address: { storage: {}, owner: 'User' },
        Note: { storage: {} },
      }),
    ).toEqual({ users: ['Admin', 'User'], tasks: ['Task'] });
  });

  it('does not depend on the order the models are listed in', () => {
    expect(collectionRootModelsOf({ User: stored('users'), Admin: stored('users') })).toEqual(
      collectionRootModelsOf({ Admin: stored('users'), User: stored('users') }),
    );
  });
});
