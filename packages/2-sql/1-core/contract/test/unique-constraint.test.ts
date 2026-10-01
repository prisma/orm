import { describe, expect, it } from 'vitest';
import { UniqueConstraint } from '../src/ir/unique-constraint';

describe('UniqueConstraint', () => {
  it('constructs with columns and no name', () => {
    const uc = new UniqueConstraint({ columns: ['email'] });
    expect(uc.columns).toEqual(['email']);
    expect(uc.name).toBeUndefined();
  });

  it('constructs with columns and a name', () => {
    const uc = new UniqueConstraint({ columns: ['email'], name: 'users_email_key' });
    expect(uc.columns).toEqual(['email']);
    expect(uc.name).toBe('users_email_key');
  });

  it('is frozen', () => {
    const uc = new UniqueConstraint({ columns: ['email'] });
    expect(Object.isFrozen(uc)).toBe(true);
  });
});

describe('UniqueConstraint.from', () => {
  it('constructs a new instance from plain input', () => {
    const uc = UniqueConstraint.from({ columns: ['email'] });
    expect(uc).toBeInstanceOf(UniqueConstraint);
    expect(uc.columns).toEqual(['email']);
  });

  it('passes an existing instance through unchanged', () => {
    const original = new UniqueConstraint({ columns: ['email'], name: 'users_email_key' });
    const result = UniqueConstraint.from(original);
    expect(result).toBe(original);
  });
});
