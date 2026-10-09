import { describe, expect, it } from 'vitest';
import {
  mapCursorValuesToColumns,
  mapFieldsToColumns,
  mapSelectedFieldsToColumns,
} from '../src/collection-column-mapping';
import { resolveFieldToColumn } from '../src/collection-contract';
import { buildMixedPolyContract, fieldUnknown, getTestContract } from './helpers';

describe('collection-column-mapping', () => {
  const contract = getTestContract();

  it('resolveFieldToColumn() resolves fields and refuses a name that is not a field', () => {
    expect(resolveFieldToColumn(contract, 'public', 'Post', 'userId')).toBe('user_id');
    expect(() => resolveFieldToColumn(contract, 'public', 'Post', 'customField')).toThrow(
      fieldUnknown('Post', 'customField'),
    );
  });

  it('resolveFieldToColumn() refuses a column name that is not also a field name', () => {
    expect(() => resolveFieldToColumn(contract, 'public', 'Post', 'user_id')).toThrow(
      fieldUnknown('Post', 'user_id'),
    );
  });

  it('resolveFieldToColumn() resolves a field a variant inherits from its base', () => {
    const polyContract = buildMixedPolyContract();
    expect(resolveFieldToColumn(polyContract, 'public', 'Bug', 'title')).toBe('title');
  });

  it('mapFieldsToColumns() maps fields and refuses a name that is not a field', () => {
    expect(mapFieldsToColumns(contract, 'public', 'Post', ['id', 'userId', 'views'])).toEqual([
      'id',
      'user_id',
      'views',
    ]);
    expect(() => mapFieldsToColumns(contract, 'public', 'Post', ['id', 'user_id'])).toThrow(
      fieldUnknown('Post', 'user_id'),
    );
    expect(() => mapFieldsToColumns(contract, 'public', 'UnknownModel', ['id'])).toThrow(
      fieldUnknown('UnknownModel', 'id'),
    );
  });

  it('mapSelectedFieldsToColumns() accepts the fields of the variants in scope only', () => {
    const polyContract = buildMixedPolyContract();
    expect(
      mapSelectedFieldsToColumns(polyContract, 'public', 'Task', undefined, ['title', 'severity']),
    ).toEqual(['title', 'severity']);
    expect(() =>
      mapSelectedFieldsToColumns(polyContract, 'public', 'Task', 'Bug', ['priority']),
    ).toThrow(fieldUnknown('Task', 'priority'));
    expect(() =>
      mapSelectedFieldsToColumns(contract, 'public', 'Post', undefined, ['user_id']),
    ).toThrow(fieldUnknown('Post', 'user_id'));
  });

  it('mapCursorValuesToColumns() skips undefined values and maps field names to columns', () => {
    expect(
      mapCursorValuesToColumns(contract, 'public', 'Post', {
        id: 1,
        userId: 2,
        views: undefined,
      }),
    ).toEqual({
      id: 1,
      user_id: 2,
    });
  });

  it('mapCursorValuesToColumns() refuses a name that is not a field', () => {
    expect(() => mapCursorValuesToColumns(contract, 'public', 'Post', { user_id: 2 })).toThrow(
      fieldUnknown('Post', 'user_id'),
    );
  });
});
