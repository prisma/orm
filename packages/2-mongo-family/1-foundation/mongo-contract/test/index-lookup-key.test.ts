import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  indexLookupKey,
  MONGO_INDEX_OPTION_KEYS,
  type MongoIndexOptionKey,
} from '../src/index-lookup-key';
import { MongoIndex, type MongoIndexInput } from '../src/ir/mongo-index';

const keys = [{ field: 'email', direction: 1 as const }];

describe('MONGO_INDEX_OPTION_KEYS', () => {
  it('lists every index option', () => {
    expectTypeOf<MongoIndexOptionKey>().toEqualTypeOf<Exclude<keyof MongoIndexInput, 'keys'>>();
    expect(MONGO_INDEX_OPTION_KEYS).toHaveLength(9);
  });
});

describe('indexLookupKey', () => {
  const lookupKey = (options: Omit<MongoIndexInput, 'keys'>) =>
    indexLookupKey(new MongoIndex({ keys, ...options }));

  it('tells apart indexes that differ in any option, and ignores options set to false', () => {
    expect({
      plain: lookupKey({}),
      notSparse: lookupKey({ sparse: false }),
      reordered:
        lookupKey({ collation: { locale: 'en', strength: 2 } }) ===
        lookupKey({ collation: { strength: 2, locale: 'en' } }),
      distinct: new Set(
        [
          {},
          { unique: true },
          { sparse: true },
          { expireAfterSeconds: 0 },
          { partialFilterExpression: { a: 1 } },
          { wildcardProjection: { a: 1 as const } },
          { collation: { locale: 'en' } },
          { weights: { a: 2 } },
          { default_language: 'french' },
          { language_override: 'lang' },
        ].map(lookupKey),
      ).size,
    }).toEqual({ plain: lookupKey({}), notSparse: lookupKey({}), reordered: true, distinct: 10 });
  });

  it('gives unique set to false, sparse set to false and no options the same key, and a set option another', () => {
    const unset = lookupKey({});
    expect({
      notUnique: lookupKey({ unique: false }) === unset,
      notSparse: lookupKey({ sparse: false }) === unset,
      sparse: lookupKey({ sparse: true }) === unset,
      collation: lookupKey({ collation: { locale: 'fr' } }) === unset,
    }).toEqual({ notUnique: true, notSparse: true, sparse: false, collation: false });
  });

  it.each([
    ['a comma and a colon', [{ field: 'a:1,b', direction: 1 as const }]],
    ['a pipe', [{ field: 'a:1|expireAfterSeconds', direction: 1 as const }]],
    ['a semicolon', [{ field: 'a:1|sparse:true;expireAfterSeconds', direction: 1 as const }]],
  ])('tells apart a stored field name with %s from the indexes its text spells', (_, oddKeys) => {
    const a = [{ field: 'a', direction: 1 as const }];
    const spelled = [
      indexLookupKey(new MongoIndex({ keys: [...a, { field: 'b', direction: 1 }] })),
      indexLookupKey(new MongoIndex({ keys: a, expireAfterSeconds: 1 })),
      indexLookupKey(new MongoIndex({ keys: a, sparse: true, expireAfterSeconds: 1 })),
    ];
    expect(spelled).not.toContain(indexLookupKey(new MongoIndex({ keys: oddKeys })));
  });
});
