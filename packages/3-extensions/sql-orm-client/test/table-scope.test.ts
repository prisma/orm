import { ColumnRef, TableSource } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { createTableScope, type TableScope } from '../src/table-scope';
import { getTestContract } from './helpers';

const byteLength = (value: string) => new TextEncoder().encode(value).length;

describe('TableScope', () => {
  it('keeps the preferred alias on first use', () => {
    expect(createTableScope().alias('posts')).toBe('posts');
  });

  it('numbers later uses from 2', () => {
    const scope = createTableScope();

    expect([scope.alias('posts'), scope.alias('posts'), scope.alias('posts')]).toEqual([
      'posts',
      'posts_2',
      'posts_3',
    ]);
  });

  it('keeps aliases of different preferred aliases independent', () => {
    const scope = createTableScope();

    expect([scope.alias('posts'), scope.alias('users'), scope.alias('users')]).toEqual([
      'posts',
      'users',
      'users_2',
    ]);
  });

  it('takes the lowest number not already in the scope', () => {
    const scope = createTableScope();
    scope.alias('posts');
    scope.alias('posts_3');

    expect([scope.alias('posts'), scope.alias('posts')]).toEqual(['posts_2', 'posts_4']);
  });

  it('numbers a preferred alias that equals an earlier numbered alias', () => {
    const scope = createTableScope();
    scope.alias('posts');
    scope.alias('posts');

    expect(scope.alias('posts_2')).toBe('posts_2_2');
  });

  it('skips a number taken by a preferred alias', () => {
    const scope = createTableScope();
    scope.alias('posts_2');
    scope.alias('posts');

    expect(scope.alias('posts')).toBe('posts_3');
  });

  it('keeps a 63-byte alias as it is', () => {
    const preferred = 'a'.repeat(63);

    expect(createTableScope().alias(preferred)).toBe(preferred);
  });

  it('shortens a preferred alias longer than 63 bytes', () => {
    expect(createTableScope().alias('a'.repeat(80))).toBe('a'.repeat(63));
  });

  it('shortens the preferred part to fit the number', () => {
    const scope = createTableScope();
    const preferred = 'a'.repeat(63);
    scope.alias(preferred);

    expect(scope.alias(preferred)).toBe(`${'a'.repeat(61)}_2`);
  });

  it('keeps aliases unique after shortening', () => {
    const scope = createTableScope();
    const names = [
      scope.alias(`${'a'.repeat(70)}x`),
      scope.alias(`${'a'.repeat(70)}y`),
      scope.alias('a'.repeat(63)),
      scope.alias(`${'a'.repeat(61)}_2`),
    ];

    expect(new Set(names).size).toBe(names.length);
    expect(names.map(byteLength).every((length) => length <= 63)).toBe(true);
  });

  it('counts the limit in bytes and never splits a character', () => {
    const scope = createTableScope();
    const preferred = 'é'.repeat(40);

    expect(scope.alias(preferred)).toBe('é'.repeat(31));
    expect(scope.alias(preferred)).toBe(`${'é'.repeat(30)}_2`);
  });

  it('keeps separate scopes independent', () => {
    createTableScope().alias('posts');

    expect(createTableScope().alias('posts')).toBe('posts');
  });
});

describe('TableScope.copy', () => {
  it('carries the taken aliases and leaves the original untouched', () => {
    const scope = createTableScope();
    scope.alias('posts');
    const copy = scope.copy();

    expect(copy.alias('posts')).toBe('posts_2');
    expect(scope.alias('posts')).toBe('posts_2');
  });
});

describe('TableScope.merge', () => {
  it('holds every alias taken in the receiver or any of the others', () => {
    const first = createTableScope();
    first.alias('posts');
    const second = createTableScope();
    second.alias('posts');
    second.alias('posts');
    second.alias('users');

    const merged = first.merge([second]);

    expect([merged.alias('posts'), merged.alias('users'), merged.alias('tags')]).toEqual([
      'posts_3',
      'users_2',
      'tags',
    ]);
    expect(first.alias('users')).toBe('users');
    expect(second.alias('tags')).toBe('tags');
  });

  it('rejects a scope that was not made by createTableScope', () => {
    const foreign: TableScope = {
      alias: (preferred) => preferred,
      aliasTable: (storage) => createTableScope().aliasTable(storage),
      copy: () => foreign,
      merge: () => foreign,
    };

    expect(() => createTableScope().merge([foreign])).toThrow(
      'a table scope must be made by createTableScope()',
    );
  });
});

describe('TableScope.aliasTable', () => {
  const contract = getTestContract();
  const posts = { namespaceId: 'public', tableName: 'posts' };

  it('gives the first use of a table an alias equal to its name and writes no AS', () => {
    const table = createTableScope().aliasTable(posts);

    expect(table).toMatchObject({ alias: 'posts', storage: posts });
    expect(table.column('id')).toEqual(ColumnRef.of('posts', 'id'));
    expect(table.tableSource(contract)).toEqual(TableSource.named('posts', undefined, 'public'));
  });

  it('gives a second use of the same table its own alias and an aliased source', () => {
    const scope = createTableScope();
    scope.aliasTable(posts);
    const table = scope.aliasTable(posts);

    expect(table).toMatchObject({ alias: 'posts_2', storage: posts });
    expect(table.column('id')).toEqual(ColumnRef.of('posts_2', 'id'));
    expect(table.tableSource(contract)).toEqual(TableSource.named('posts', 'posts_2', 'public'));
  });

  it('aliases a table whose bare name another item in the scope already has', () => {
    const scope = createTableScope();
    scope.alias('posts');

    expect(scope.aliasTable(posts).tableSource(contract)).toEqual(
      TableSource.named('posts', 'posts_2', 'public'),
    );
  });

  it('throws for a table the contract does not have', () => {
    const table = createTableScope().aliasTable({ namespaceId: 'public', tableName: 'missing' });

    expect(() => table.tableSource(contract)).toThrow('Unknown table "missing"');
  });
});
