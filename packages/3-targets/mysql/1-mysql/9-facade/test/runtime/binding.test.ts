import { describe, expect, it } from 'vitest';
import { resolveMysqlBinding, validateMysqlUrl } from '../../src/runtime/binding';

const TARGET = { targetId: 'mysql', displayName: 'MySQL' } as const;
const URL_SCHEMES = ['mysql'] as const;

describe('validateMysqlUrl', () => {
  it('accepts a URL that leaves the host blank', () => {
    expect(validateMysqlUrl('mysql://user:password@/db', TARGET, URL_SCHEMES)).toBe(
      'mysql://user:password@/db',
    );
  });

  it('accepts a URL that leaves the user blank', () => {
    expect(validateMysqlUrl('mysql://:password@localhost/db', TARGET, URL_SCHEMES)).toBe(
      'mysql://:password@localhost/db',
    );
  });

  it('still refuses a URL whose host is malformed rather than blank', () => {
    expect(() => validateMysqlUrl('mysql://user:password@[db.example/db', TARGET, URL_SCHEMES)).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.BINDING_INVALID',
        message: 'MySQL URL must be a valid URL',
      }),
    );
  });
});

describe('resolveMysqlBinding', () => {
  it('resolves a URL that leaves the host blank', () => {
    expect(
      resolveMysqlBinding({ url: 'mysql://user:password@/db' }, TARGET, URL_SCHEMES),
    ).toEqual({
      kind: 'url',
      url: 'mysql://user:password@/db',
    });
  });
});
