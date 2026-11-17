import { describe, expect, it } from 'vitest';
import { Collection } from '../src/collection';
import { checkCollectionClasses } from '../src/exports/index';
import type { TestContract } from './helpers';
import { getTestContext } from './helpers';

class PostCollection extends Collection<TestContract, 'Post'> {}

const { contract } = getTestContext();

describe('checkCollectionClasses', () => {
  it('returns the classes by model name', () => {
    expect([
      ...checkCollectionClasses(contract, { Post: PostCollection, User: undefined }),
    ]).toEqual([['Post', PostCollection]]);
  });

  it('returns no classes when none are given', () => {
    expect(checkCollectionClasses(contract, undefined).size).toBe(0);
  });

  it('rejects a class for a model the contract does not have', () => {
    expect(() => checkCollectionClasses(contract, { NotAModel: PostCollection })).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message: expect.stringContaining("No model found for custom collection 'NotAModel'"),
      }),
    );
  });

  it('rejects a value that is not a Collection class', () => {
    class NotACollection {}
    expect(() =>
      checkCollectionClasses(contract, {
        Post: NotACollection as unknown as typeof PostCollection,
      }),
    ).toThrow(/must be a Collection class/);
  });
});
