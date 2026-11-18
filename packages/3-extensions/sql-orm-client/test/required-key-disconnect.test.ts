import { describe, expect, it } from 'vitest';
import { orm } from '../src/orm';
import { createMockRuntime, getTestContext } from './helpers';

type Disconnectable = { disconnect(): unknown };

describe('disconnect on a relation whose foreign key is required', () => {
  it.each([
    ['Post', 'author'],
    ['User', 'posts'],
    ['User', 'profile'],
  ] as const)('is refused on %s.%s before any statement runs', async (modelName, relation) => {
    const runtime = createMockRuntime();
    const db = orm({ runtime, context: getTestContext() });
    const data = { [relation]: (mutator: Disconnectable) => mutator.disconnect() } as never;
    const update =
      modelName === 'Post'
        ? db.public.Post.where({ id: 1 }).update(data)
        : db.public.User.where({ id: 1 }).update(data);

    await expect(update).rejects.toThrow(
      expect.objectContaining({
        code: 'ORM.OPERATION_UNSUPPORTED',
        meta: expect.objectContaining({ relation, reason: 'required-foreign-key' }),
      }),
    );
    expect(runtime.executions).toEqual([]);
  });
});
