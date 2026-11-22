import { describe, expect, it } from 'vitest';
import { assertFieldName, assertModelName, isPslIdentifier } from '../../src/contract/identifiers';

describe('isPslIdentifier', () => {
  it.each(['user', 'User', 'two_factor', '_hidden', 'a1'])('accepts %s', (name) => {
    expect(isPslIdentifier(name)).toBe(true);
  });

  it.each(['', '1user', 'user-table', 'user table', 'ümlaut', 'a.b'])('refuses %j', (name) => {
    expect(isPslIdentifier(name)).toBe(false);
  });
});

describe('name assertions', () => {
  it('a model name that is not an identifier names the modelName option', () => {
    expect(() => assertModelName('user-table')).toThrow(
      expect.objectContaining({
        name: 'BetterAuthError',
        message: expect.stringContaining('"modelName"'),
      }),
    );
  });

  it('a field name that is not an identifier names the model and the fields option', () => {
    expect(() => assertFieldName('user', 'e-mail')).toThrow(
      expect.objectContaining({
        name: 'BetterAuthError',
        message: expect.stringMatching(/"e-mail".*"user".*"fields"/),
      }),
    );
  });

  it('valid names pass', () => {
    expect(() => assertModelName('user')).not.toThrow();
    expect(() => assertFieldName('user', 'email')).not.toThrow();
  });
});
