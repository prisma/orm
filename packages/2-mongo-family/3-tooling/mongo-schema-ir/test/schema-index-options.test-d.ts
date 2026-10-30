import type { MongoIndexOptionKey } from '@internal/mongo-contract';
import { describe, expectTypeOf, test } from 'vitest';
import type { MongoSchemaIndexOptions } from '../src/schema-index';

describe('MongoSchemaIndexOptions', () => {
  test('has every index option the contract identifies an index by', () => {
    expectTypeOf<
      Exclude<keyof MongoSchemaIndexOptions, 'keys'>
    >().toEqualTypeOf<MongoIndexOptionKey>();
  });
});
