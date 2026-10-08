import { dataType } from '@internal/framework-components/codec';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { findSqlDataTypeCollision, sqlDataType } from '../src/sql-data-type';
import { allTypes, enumType, int4, numeric } from './sql-data-type-fixtures';

const claiming = (id: string, text: string) =>
  sqlDataType(id, {
    params: type({ 'p?': 'number', 'precision?': 'number', 'length?': 'number' }),
    texts: [{ text }],
  });

describe('findSqlDataTypeCollision', () => {
  it('finds nothing among data types whose claiming texts are distinct', () => {
    expect(findSqlDataTypeCollision(allTypes)).toBeUndefined();
  });

  it.each([
    ['int4', 'int4'],
    ['numeric({precision})', 'numeric({p})'],
    ['numeric({precision})', 'numeric(1)'],
    ['numeric(1)', 'numeric({precision})'],
    ['vector({length})', 'vector({p})'],
  ])('finds the text %s colliding with %s', (a, b) => {
    const first = claiming('t/a', a);
    const second = claiming('t/b', b);
    expect(findSqlDataTypeCollision([first, second])).toEqual({
      first,
      second,
      claims: { by: 'text', first: a, second: b },
    });
  });

  it.each([
    ['int', 'int4'],
    ['character({length})', 'character varying({length})'],
    ['timestamp({precision}) with time zone', 'timestamp({precision}) without time zone'],
    ['bit', 'bit varying'],
  ])('finds no collision between the texts %s and %s', (a, b) => {
    expect(findSqlDataTypeCollision([claiming('t/a', a), claiming('t/b', b)])).toBeUndefined();
  });

  it('finds no collision between placeholder sets of different sizes', () => {
    const scaled = sqlDataType('t/scaled', {
      params: type({ 'precision?': 'number', 'scale?': 'number' }),
      texts: [{ text: 'numeric({precision},{scale})' }],
    });
    expect(findSqlDataTypeCollision([claiming('t/a', 'numeric({precision})'), scaled])).toBe(
      undefined,
    );
  });

  it('ignores texts that are only written', () => {
    const writtenOnly = sqlDataType('t/int4-written', { texts: [{ text: 'int4', written: true }] });
    expect(findSqlDataTypeCollision([int4, writtenOnly])).toBeUndefined();
  });

  it('finds a text marked both written and catalog', () => {
    const other = claiming('t/other', 'numeric');
    expect(findSqlDataTypeCollision([numeric, other])).toMatchObject({
      first: numeric,
      second: other,
      claims: { by: 'text', first: 'numeric', second: 'numeric' },
    });
  });

  it('finds two data types that claim one kind', () => {
    const other = sqlDataType('t/other-enum', {
      params: type({ typeName: 'string > 0' }),
      claimsKind: 'enum',
      render: ({ typeName }) => typeName,
    });
    expect(findSqlDataTypeCollision([enumType, other])).toEqual({
      first: enumType,
      second: other,
      claims: { by: 'kind', kind: 'enum' },
    });
  });

  it('ignores data types that are not SQL data types', () => {
    expect(findSqlDataTypeCollision([int4, dataType('t/int4-plain', {})])).toBeUndefined();
  });
});
