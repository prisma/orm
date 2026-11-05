import { MongoSchemaCollection, MongoSchemaIndex, MongoSchemaIR } from '@internal/mongo-schema-ir';
import { describe, expect, it } from 'vitest';
import { canonicalizeSchemasForVerification } from '../src/core/schema-verify/canonicalize-introspection';

const ab = [
  { field: 'a', direction: 1 as const },
  { field: 'b', direction: 1 as const },
];
const oddField = [{ field: 'a:1,b', direction: 1 as const }];

function users(indexes: MongoSchemaIndex[]): MongoSchemaIR {
  return new MongoSchemaIR([new MongoSchemaCollection({ name: 'users', indexes })]);
}

describe('verify pairs each live index with its contract index', () => {
  it('pairs an index on [a, b] with its own contract index, not one on a field stored as "a:1,b"', () => {
    const expected = users([
      new MongoSchemaIndex({ name: 'a:1,b_1', keys: oddField }),
      new MongoSchemaIndex({
        name: 'a_1_b_1',
        keys: ab,
        collation: { locale: 'en', strength: 2 },
      }),
    ]);
    const live = users([
      new MongoSchemaIndex({ name: 'a:1,b_1', keys: oddField }),
      new MongoSchemaIndex({
        name: 'a_1_b_1',
        keys: ab,
        collation: { locale: 'en', strength: 2, caseLevel: false, numericOrdering: false },
      }),
    ]);

    const canonical = canonicalizeSchemasForVerification(live, expected).live;

    expect(
      canonical.collection('users')?.indexes.map(({ keys, collation }) => ({ keys, collation })),
    ).toEqual([
      { keys: oddField, collation: undefined },
      { keys: ab, collation: { locale: 'en', strength: 2 } },
    ]);
  });

  it('pairs two live indexes on the same keys with the contract index of the same name', () => {
    const fr = { locale: 'fr', strength: 1 } as const;
    const en = { locale: 'en', strength: 2 } as const;
    const expected = users([
      new MongoSchemaIndex({ name: 'ab_fr', keys: ab, collation: fr }),
      new MongoSchemaIndex({ name: 'ab_en', keys: ab, collation: en }),
    ]);
    const live = users([
      new MongoSchemaIndex({ name: 'ab_en', keys: ab, collation: { ...en, caseLevel: false } }),
      new MongoSchemaIndex({ name: 'ab_fr', keys: ab, collation: { ...fr, caseLevel: false } }),
    ]);

    const canonical = canonicalizeSchemasForVerification(live, expected).live;

    expect(
      canonical.collection('users')?.indexes.map(({ name, collation }) => ({ name, collation })),
    ).toEqual([
      { name: 'ab_en', collation: en },
      { name: 'ab_fr', collation: fr },
    ]);
  });
});
