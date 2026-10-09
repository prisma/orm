import { describe, expect, it } from 'vitest';
import {
  mapCursorValuesToColumns,
  mapFieldsToColumns,
  mapSelectedFieldsToColumns,
} from '../src/collection-column-mapping';
import { columnOfCallerField, getModelFieldColumns } from '../src/collection-contract';
import {
  buildMixedPolyContract,
  columnPassedForField,
  fieldUnknown,
  getTestContract,
} from './helpers';

describe('collection-column-mapping', () => {
  const contract = getTestContract();

  const columnOfModelField = (c: typeof contract, ns: string, model: string, field: string) =>
    columnOfCallerField(c, ns, getModelFieldColumns(c, ns, model), model, field);

  it('columnOfCallerField() resolves fields and refuses a name that is not a field', () => {
    expect(columnOfModelField(contract, 'public', 'Post', 'userId')).toBe('user_id');
    expect(() => columnOfModelField(contract, 'public', 'Post', 'customField')).toThrow(
      fieldUnknown('Post', 'customField'),
    );
  });

  it('columnOfCallerField() refuses a column name that is not also a field name', () => {
    expect(() => columnOfModelField(contract, 'public', 'Post', 'user_id')).toThrow(
      columnPassedForField('Post', 'user_id', 'userId'),
    );
  });

  it('getModelFieldColumns() includes a field a variant inherits from its base', () => {
    const polyContract = buildMixedPolyContract();
    expect(columnOfModelField(polyContract, 'public', 'Bug', 'title')).toBe('title');
  });

  it('mapFieldsToColumns() maps fields and refuses a name that is not a field', () => {
    expect(mapFieldsToColumns(contract, 'public', 'Post', ['id', 'userId', 'views'])).toEqual([
      'id',
      'user_id',
      'views',
    ]);
    expect(() => mapFieldsToColumns(contract, 'public', 'Post', ['id', 'user_id'])).toThrow(
      columnPassedForField('Post', 'user_id', 'userId'),
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
    ).toThrow(fieldUnknown('Bug', 'priority'));
    expect(() =>
      mapSelectedFieldsToColumns(contract, 'public', 'Post', undefined, ['user_id']),
    ).toThrow(columnPassedForField('Post', 'user_id', 'userId'));
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
      columnPassedForField('Post', 'user_id', 'userId'),
    );
  });
});
