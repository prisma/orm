import { describe, expect, it } from 'vitest';
import {
  createUniqueFieldName,
  deriveRelationFieldName,
  junctionRelationFieldNames,
  resolveUniqueRelationFieldName,
  toEnumMemberName,
  toEnumName,
  toFieldName,
  toModelName,
} from '../src/psl-names';

describe('toModelName', () => {
  it('converts snake_case to PascalCase', () => {
    expect(toModelName('user_profile')).toEqual({ name: 'UserProfile', map: 'user_profile' });
  });

  it('capitalizes lowercase single word', () => {
    expect(toModelName('user')).toEqual({ name: 'User', map: 'user' });
  });

  it('preserves PascalCase', () => {
    expect(toModelName('UserProfile')).toEqual({ name: 'UserProfile' });
  });

  it('escapes PSL reserved words', () => {
    expect(toModelName('model')).toEqual({ name: '_Model', map: 'model' });
    expect(toModelName('type')).toEqual({ name: '_Type', map: 'type' });
    expect(toModelName('enum')).toEqual({ name: '_Enum', map: 'enum' });
  });

  it('escapes digit-prefixed names', () => {
    expect(toModelName('3d_model')).toEqual({ name: '_3dModel', map: '3d_model' });
  });

  it('no map when name is already PascalCase', () => {
    expect(toModelName('User')).toEqual({ name: 'User' });
  });

  it('sanitizes punctuated identifiers', () => {
    expect(toModelName('user.profile')).toEqual({ name: 'UserProfile', map: 'user.profile' });
    expect(toModelName('foo$bar')).toEqual({ name: 'FooBar', map: 'foo$bar' });
  });

  it('synthesizes a deterministic identifier when no ASCII identifier characters remain', () => {
    expect(toModelName('$$$')).toMatchObject({
      name: expect.stringMatching(/^X[0-9a-f]+$/),
      map: '$$$',
    });
    expect(toModelName('東京')).toEqual(toModelName('東京'));
  });
});

describe('toFieldName', () => {
  it('converts snake_case to camelCase', () => {
    expect(toFieldName('user_id')).toEqual({ name: 'userId', map: 'user_id' });
  });

  it('preserves camelCase without map', () => {
    expect(toFieldName('userId')).toEqual({ name: 'userId' });
  });

  it('no map when already correct', () => {
    expect(toFieldName('id')).toEqual({ name: 'id' });
    expect(toFieldName('email')).toEqual({ name: 'email' });
  });

  it('escapes reserved words', () => {
    expect(toFieldName('model')).toEqual({ name: '_model', map: 'model' });
  });

  it('escapes digit-prefixed', () => {
    expect(toFieldName('2fa_code')).toEqual({ name: '_2faCode', map: '2fa_code' });
  });

  it('lowercases first char of PascalCase column name', () => {
    expect(toFieldName('Name')).toEqual({ name: 'name', map: 'Name' });
  });

  it('keeps separator-only names stable', () => {
    expect(toFieldName('___')).toEqual({ name: '___' });
  });

  it('sanitizes punctuated identifiers', () => {
    expect(toFieldName('user.profile')).toEqual({ name: 'userProfile', map: 'user.profile' });
    expect(toFieldName('foo$bar')).toEqual({ name: 'fooBar', map: 'foo$bar' });
  });

  it('synthesizes a deterministic identifier when no ASCII identifier characters remain', () => {
    expect(toFieldName('$$$')).toMatchObject({
      name: expect.stringMatching(/^x[0-9a-f]+$/),
      map: '$$$',
    });
    expect(toFieldName('東京')).toEqual(toFieldName('東京'));
  });
});

describe('toEnumName', () => {
  it('converts snake_case to PascalCase', () => {
    expect(toEnumName('user_role')).toEqual({ name: 'UserRole', map: 'user_role' });
  });

  it('no map when already PascalCase', () => {
    expect(toEnumName('Role')).toEqual({ name: 'Role' });
  });

  it('escapes reserved enum names', () => {
    expect(toEnumName('enum')).toEqual({ name: '_Enum', map: 'enum' });
  });

  it('sanitizes punctuated identifiers', () => {
    expect(toEnumName('user.role')).toEqual({ name: 'UserRole', map: 'user.role' });
  });

  it('synthesizes a deterministic identifier when no ASCII identifier characters remain', () => {
    expect(toEnumName('$$$')).toMatchObject({
      name: expect.stringMatching(/^X[0-9a-f]+$/),
      map: '$$$',
    });
  });
});

describe('deriveRelationFieldName', () => {
  it('strips _id suffix for single column FK', () => {
    expect(deriveRelationFieldName(['user_id'], 'user')).toBe('user');
  });

  it('strips Id suffix for single column FK', () => {
    expect(deriveRelationFieldName(['authorId'], 'user')).toBe('author');
  });

  it('handles compound suffix stripping', () => {
    expect(deriveRelationFieldName(['parent_category_id'], 'category')).toBe('parentCategory');
  });

  it('escapes digit-prefixed inferred relation names', () => {
    expect(deriveRelationFieldName(['2fa_id'], 'account')).toBe('_2fa');
  });

  it('uses referenced table name for composite FKs', () => {
    expect(deriveRelationFieldName(['cat_id', 'prod_id'], 'product')).toBe('product');
  });

  it('falls back to table name when no suffix to strip', () => {
    expect(deriveRelationFieldName(['author'], 'user')).toBe('user');
  });
});

describe('toEnumMemberName', () => {
  it('keeps a valid identifier value verbatim, preserving case', () => {
    expect(toEnumMemberName('aal1')).toBe('aal1');
    expect(toEnumMemberName('DRAFT')).toBe('DRAFT');
    expect(toEnumMemberName('camelCase')).toBe('camelCase');
  });

  it('camelCases values with separators', () => {
    expect(toEnumMemberName('high-priority')).toBe('highPriority');
    expect(toEnumMemberName('in review')).toBe('inReview');
  });

  it('escapes digit-prefixed values', () => {
    expect(toEnumMemberName('2nd')).toBe('_2nd');
  });

  it('escapes PSL reserved words', () => {
    expect(toEnumMemberName('enum')).toBe('_enum');
    expect(toEnumMemberName('model')).toBe('_model');
  });

  it('synthesizes a deterministic identifier when no ASCII identifier characters remain', () => {
    expect(toEnumMemberName('$$$')).toMatch(/^x[0-9a-f]+$/);
    expect(toEnumMemberName('東京')).toBe(toEnumMemberName('東京'));
  });
});

describe('createUniqueFieldName', () => {
  it('appends the first free number from 2 to a taken name', () => {
    expect(createUniqueFieldName('post', new Set())).toBe('post');
    expect(createUniqueFieldName('post', new Set(['post', 'post2']))).toBe('post3');
  });
});

describe('resolveUniqueRelationFieldName', () => {
  it('appends the referenced model name, then a number, to a taken name', () => {
    expect(resolveUniqueRelationFieldName('user', new Set(['user']), 'User')).toBe('userUser');
    expect(resolveUniqueRelationFieldName('user', new Set(['user', 'userUser']), 'User')).toBe(
      'user2',
    );
  });
});

describe('junctionRelationFieldNames', () => {
  it('names each foreign key after the table it references', () => {
    expect(junctionRelationFieldNames('blog_posts', 'Tag')).toEqual(['blogPosts', 'tag']);
  });

  it('gives a self relation the referenced model name on the second name', () => {
    expect(junctionRelationFieldNames('User', 'User')).toEqual(['user', 'userUser']);
  });

  it('moves a name off the fields columns A and B print as', () => {
    expect(junctionRelationFieldNames('A', 'B')).toEqual(['a2', 'b2']);
    expect(junctionRelationFieldNames('A', 'A')).toEqual(['a2', 'aA']);
  });
});
