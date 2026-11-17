import { asNamespaceId } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import {
  convertedColumnMeta,
  convertedColumnOf,
  unconvertedFieldOf,
} from '../src/core/migrations/unconverted-field';
import { contractOf } from './statement-fixtures';

const contract = contractOf({
  User: { table: 'user', fields: { id: 'id', age: 'age_years' } },
  Post: { table: 'post', fields: { id: 'id' } },
});

const step = (meta?: Record<string, unknown>) => ({
  description: 'alter type of "age_years"',
  sql: 'ALTER TABLE …',
  ...(meta === undefined ? {} : { meta }),
});

describe('unconvertedFieldOf', () => {
  it('names the field that stores the column a cast step converts', () => {
    expect(
      unconvertedFieldOf(step(convertedColumnMeta('user', 'age_years', 'cast')), contract),
    ).toEqual({
      kind: 'field',
      namespaceId: asNamespaceId('app'),
      model: 'User',
      field: 'age',
    });
  });

  it('names nothing for a step that casts no column, or a column no field stores', () => {
    expect([
      unconvertedFieldOf(step(), contract),
      unconvertedFieldOf(step({ warning: 'TABLE_REWRITE' }), contract),
      unconvertedFieldOf(step(convertedColumnMeta('user', 'gone', 'cast')), contract),
      unconvertedFieldOf(step(convertedColumnMeta('other', 'id', 'cast')), contract),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('names nothing when tables of two namespaces share the name', () => {
    const twoNamespaces = contractOf({
      User: { table: 'user', fields: { age: 'age' } },
      Member: { table: 'user', namespace: 'auth', fields: { age: 'age' } },
    });
    expect(
      unconvertedFieldOf(step(convertedColumnMeta('user', 'age', 'cast')), twoNamespaces),
    ).toBeUndefined();
  });
});

describe('convertedColumnOf', () => {
  it('reads the column a step converts and who converts it, and nothing from other meta', () => {
    expect([
      convertedColumnOf(step(convertedColumnMeta('user', 'age', 'cast'))),
      convertedColumnOf(step(convertedColumnMeta('user', 'age', 'conversion'))),
      convertedColumnOf(step({ convertedColumn: { table: 'user', column: 'age' } })),
      convertedColumnOf(step({ warning: 'TABLE_REWRITE' })),
      convertedColumnOf(step()),
    ]).toEqual([
      { table: 'user', column: 'age', by: 'cast' },
      { table: 'user', column: 'age', by: 'conversion' },
      undefined,
      undefined,
      undefined,
    ]);
  });
});
