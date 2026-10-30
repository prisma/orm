import { describe, expectTypeOf, test } from 'vitest';
import { listsEveryOption, MONGO_INDEX_OPTION_KEYS } from '../src/index-lookup-key';
import type { MongoIndexInput } from '../src/ir/mongo-index';

type IndexOptionName = Exclude<keyof MongoIndexInput, 'keys'>;

describe('listsEveryOption', () => {
  test('accepts the list of every index option', () => {
    expectTypeOf(listsEveryOption<IndexOptionName>()(MONGO_INDEX_OPTION_KEYS)).toEqualTypeOf<
      typeof MONGO_INDEX_OPTION_KEYS
    >();
  });

  test('rejects a list missing an index option', () => {
    const withoutWeights = [
      'unique',
      'sparse',
      'expireAfterSeconds',
      'partialFilterExpression',
      'wildcardProjection',
      'collation',
      'default_language',
      'language_override',
    ] as const;
    // @ts-expect-error the list leaves out `weights`
    listsEveryOption<IndexOptionName>()(withoutWeights);
  });

  test('rejects the list when the index gains an option it does not name', () => {
    // @ts-expect-error `hidden` is not in the list
    listsEveryOption<IndexOptionName | 'hidden'>()(MONGO_INDEX_OPTION_KEYS);
  });
});
