import { ColumnRef, TableSource } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { bindTable, copyTableScope, createTableScope, mergeTableScopes } from '../src/table-scope';
import { getTestContract } from './helpers';

const byteLength = (value: string) => new TextEncoder().encode(value).length;

describe('TableScope', () => {
  it('keeps the preferred name on first use', () => {
    expect(createTableScope().name('posts')).toBe('posts');
  });

  it('numbers later uses from 2', () => {
    const scope = createTableScope();

    expect([scope.name('posts'), scope.name('posts'), scope.name('posts')]).toEqual([
      'posts',
      'posts_2',
      'posts_3',
    ]);
  });

  it('keeps names of different preferred names independent', () => {
    const scope = createTableScope();

    expect([scope.name('posts'), scope.name('users'), scope.name('users')]).toEqual([
      'posts',
      'users',
      'users_2',
    ]);
  });

  it('takes the lowest number not already in the scope', () => {
    const scope = createTableScope();
    scope.name('posts');
    scope.name('posts_3');

    expect([scope.name('posts'), scope.name('posts')]).toEqual(['posts_2', 'posts_4']);
  });

  it('numbers a preferred name that equals an earlier numbered name', () => {
    const scope = createTableScope();
    scope.name('posts');
    scope.name('posts');

    expect(scope.name('posts_2')).toBe('posts_2_2');
  });

  it('skips a number taken by a preferred name', () => {
    const scope = createTableScope();
    scope.name('posts_2');
    scope.name('posts');

    expect(scope.name('posts')).toBe('posts_3');
  });

  it('keeps a 63-byte name as it is', () => {
    const preferred = 'a'.repeat(63);

    expect(createTableScope().name(preferred)).toBe(preferred);
  });

  it('shortens a preferred name longer than 63 bytes', () => {
    expect(createTableScope().name('a'.repeat(80))).toBe('a'.repeat(63));
  });

  it('shortens the preferred part to fit the number', () => {
    const scope = createTableScope();
    const preferred = 'a'.repeat(63);
    scope.name(preferred);

    expect(scope.name(preferred)).toBe(`${'a'.repeat(61)}_2`);
  });

  it('keeps names unique after shortening', () => {
    const scope = createTableScope();
    const names = [
      scope.name(`${'a'.repeat(70)}x`),
      scope.name(`${'a'.repeat(70)}y`),
      scope.name('a'.repeat(63)),
      scope.name(`${'a'.repeat(61)}_2`),
    ];

    expect(new Set(names).size).toBe(names.length);
    expect(names.map(byteLength).every((length) => length <= 63)).toBe(true);
  });

  it('counts the limit in bytes and never splits a character', () => {
    const scope = createTableScope();
    const preferred = 'é'.repeat(40);

    expect(scope.name(preferred)).toBe('é'.repeat(31));
    expect(scope.name(preferred)).toBe(`${'é'.repeat(30)}_2`);
  });

  it('keeps separate scopes independent', () => {
    createTableScope().name('posts');

    expect(createTableScope().name('posts')).toBe('posts');
  });
});

describe('copyTableScope', () => {
  it('carries the taken names and leaves the original untouched', () => {
    const scope = createTableScope();
    scope.name('posts');
    const copy = copyTableScope(scope);

    expect(copy.name('posts')).toBe('posts_2');
    expect(scope.name('posts')).toBe('posts_2');
  });
});

describe('mergeTableScopes', () => {
  it('holds every name taken in any of the scopes', () => {
    const first = createTableScope();
    first.name('posts');
    const second = createTableScope();
    second.name('posts');
    second.name('posts');
    second.name('users');

    const merged = mergeTableScopes([first, second]);

    expect([merged.name('posts'), merged.name('users'), merged.name('tags')]).toEqual([
      'posts_3',
      'users_2',
      'tags',
    ]);
    expect(first.name('users')).toBe('users');
  });
});

describe('bindTable', () => {
  const contract = getTestContract();
  const posts = { namespaceId: 'public', tableName: 'posts' };

  it('references the first binding of a table by its bare name', () => {
    const binding = bindTable(createTableScope(), posts);

    expect(binding).toMatchObject({ reference: 'posts', storage: posts });
    expect(binding.column('id')).toEqual(ColumnRef.of('posts', 'id'));
    expect(binding.tableSource(contract)).toEqual(TableSource.named('posts', undefined, 'public'));
  });

  it('gives a second binding of the same table its own reference and an aliased source', () => {
    const scope = createTableScope();
    bindTable(scope, posts);
    const binding = bindTable(scope, posts);

    expect(binding).toMatchObject({ reference: 'posts_2', storage: posts });
    expect(binding.column('id')).toEqual(ColumnRef.of('posts_2', 'id'));
    expect(binding.tableSource(contract)).toEqual(TableSource.named('posts', 'posts_2', 'public'));
  });

  it('aliases a table whose bare name another item in the scope already has', () => {
    const scope = createTableScope();
    scope.name('posts');

    expect(bindTable(scope, posts).tableSource(contract)).toEqual(
      TableSource.named('posts', 'posts_2', 'public'),
    );
  });

  it('throws for a table the contract does not have', () => {
    const binding = bindTable(createTableScope(), { namespaceId: 'public', tableName: 'missing' });

    expect(() => binding.tableSource(contract)).toThrow('Unknown table "missing"');
  });
});
