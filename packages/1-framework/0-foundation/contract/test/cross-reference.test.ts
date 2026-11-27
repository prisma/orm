import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { CrossReferenceSchema, crossRef } from '../src/cross-reference';

describe('crossRef', () => {
  it('defaults the namespace to __unbound__ when omitted', () => {
    expect(crossRef('User')).toStrictEqual({ namespace: '__unbound__', model: 'User' });
  });

  it('uses the provided namespace when supplied', () => {
    expect(crossRef('User', 'auth')).toStrictEqual({ namespace: 'auth', model: 'User' });
  });

  it('carries the contract space when supplied', () => {
    expect(crossRef('User', 'auth', 'identity')).toEqual({
      namespace: 'auth',
      model: 'User',
      space: 'identity',
    });
  });

  it('names the contract space when one is given, and omits the key otherwise', () => {
    expect(crossRef('User', 'auth', 'billing')).toEqual({
      namespace: 'auth',
      model: 'User',
      space: 'billing',
    });
    expect(crossRef('User', 'auth')).not.toHaveProperty('space');
  });
});

describe('CrossReferenceSchema', () => {
  it('accepts a well-formed cross reference', () => {
    const out = CrossReferenceSchema({ namespace: 'auth', model: 'User' });
    expect(out).toEqual({ namespace: 'auth', model: 'User' });
  });

  it('rejects unknown keys', () => {
    expect(CrossReferenceSchema({ namespace: 'auth', model: 'User', extra: 1 })).toBeInstanceOf(
      type.errors,
    );
  });

  it('rejects a missing model', () => {
    expect(CrossReferenceSchema({ namespace: 'auth' })).toBeInstanceOf(type.errors);
  });

  it('rejects a non-string namespace', () => {
    expect(CrossReferenceSchema({ namespace: 1, model: 'User' })).toBeInstanceOf(type.errors);
  });
});
