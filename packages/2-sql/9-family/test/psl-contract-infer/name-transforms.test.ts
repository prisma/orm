import { describe, expect, it } from 'vitest';
import {
  deriveBackRelationFieldName,
  pluralize,
} from '../../src/core/psl-contract-infer/name-transforms';

describe('pluralize', () => {
  it('adds s for regular words', () => {
    expect(pluralize('post')).toBe('posts');
    expect(pluralize('user')).toBe('users');
  });

  it('handles words ending in y', () => {
    expect(pluralize('category')).toBe('categories');
    expect(pluralize('company')).toBe('companies');
  });

  it('handles words ending in s/x/z/ch/sh', () => {
    expect(pluralize('address')).toBe('addresses');
    expect(pluralize('box')).toBe('boxes');
    expect(pluralize('batch')).toBe('batches');
    expect(pluralize('flash')).toBe('flashes');
  });

  it('does not double-pluralize vowel+y', () => {
    expect(pluralize('day')).toBe('days');
    expect(pluralize('key')).toBe('keys');
  });

  it('leaves already-plural words unchanged', () => {
    expect(pluralize('sessions')).toBe('sessions');
    expect(pluralize('identities')).toBe('identities');
    expect(pluralize('mfaAmrClaims')).toBe('mfaAmrClaims');
  });

  it('pluralizes singular words that end in s', () => {
    expect(pluralize('status')).toBe('statuses');
    expect(pluralize('bus')).toBe('buses');
  });

  it('pluralizes class', () => {
    expect(pluralize('class')).toBe('classes');
  });
});

describe('deriveBackRelationFieldName', () => {
  it('pluralizes for 1:N', () => {
    expect(deriveBackRelationFieldName('Post', false)).toBe('posts');
  });

  it('singularizes for 1:1', () => {
    expect(deriveBackRelationFieldName('Profile', true)).toBe('profile');
  });

  it('does not double-pluralize an already-plural model name for 1:N', () => {
    expect(deriveBackRelationFieldName('Sessions', false)).toBe('sessions');
  });
});
