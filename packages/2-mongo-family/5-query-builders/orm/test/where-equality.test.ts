import type { ContractField } from '@internal/contract/types';
import { MongoFieldFilter } from '@internal/mongo-query-ast/execution';
import { MongoParamRef } from '@internal/mongo-value';
import { describe, expect, it } from 'vitest';
import { whereEquality } from '../src/where-equality';

const stringType = { kind: 'scalar', codecId: 'mongo/string@1' } as const;

const entryList: ContractField = {
  nullable: true,
  type: {
    kind: 'valueObject',
    plane: 'storage',
    namespaceId: '__unbound__',
    entityKind: 'valueObject',
    entityName: 'Entry',
  },
  many: { elementNullable: true },
};

const nullableListOfNullableItems: ContractField = {
  nullable: true,
  type: stringType,
  many: { elementNullable: true },
};

describe('whereEquality', () => {
  it('compiles null on a scalar list to a match on any value that is not an array', () => {
    expect(whereEquality('tags', nullableListOfNullableItems, null)).toEqual(
      MongoFieldFilter.of('tags', '$not', { $type: 'array' }),
    );
  });

  it('compiles null on a scalar field that is not a list to an equality with null', () => {
    expect(whereEquality('nickname', { nullable: true, type: stringType }, null)).toEqual(
      MongoFieldFilter.eq('nickname', null),
    );
  });

  it('compiles null on a value-object list to a match on any value that is not an array', () => {
    expect(whereEquality('entries', entryList, null)).toEqual(
      MongoFieldFilter.of('entries', '$not', { $type: 'array' }),
    );
  });

  it('compiles a whole list on a scalar list to an equality with that list', () => {
    const value = [new MongoParamRef('a')];
    expect(whereEquality('tags', nullableListOfNullableItems, value)).toEqual(
      MongoFieldFilter.eq('tags', value),
    );
  });

  it('compiles one element on a scalar list to a match on a list item equal to it', () => {
    const value = new MongoParamRef('a');
    expect(whereEquality('tags', nullableListOfNullableItems, value)).toEqual(
      MongoFieldFilter.of('tags', '$elemMatch', { $eq: value }),
    );
  });

  it('compiles one element on a value-object list to a match on a list item equal to it', () => {
    const value = { value: new MongoParamRef('c') };
    expect(whereEquality('entries', entryList, value)).toEqual(
      MongoFieldFilter.of('entries', '$elemMatch', { $eq: value }),
    );
  });

  it('compiles a value on a field that is not a list to an equality with that value', () => {
    const value = new MongoParamRef('a');
    expect(whereEquality('nickname', { nullable: true, type: stringType }, value)).toEqual(
      MongoFieldFilter.eq('nickname', value),
    );
  });
});
