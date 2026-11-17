import { describe, expect, it } from 'vitest';
import { resolveMysqlBinding, validateMysqlUrl } from '../../src/runtime/binding';

describe('validateMysqlUrl', () => {
  it('accepts a URL that leaves the host blank', () => {
    expect(validateMysqlUrl('mysql://user:password@/db')).toBe('mysql://user:password@/db');
  });

  it('accepts a URL that leaves the user blank', () => {
    expect(validateMysqlUrl('mysql://:password@localhost/db')).toBe(
      'mysql://:password@localhost/db',
    );
  });

  it('still refuses a URL whose host is malformed rather than blank', () => {
    expect(() => validateMysqlUrl('mysql://user:password@[db.example/db')).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.BINDING_INVALID',
        message: 'MySQL URL must be a valid URL',
      }),
    );
  });
});

describe('resolveMysqlBinding', () => {
  it('resolves a URL that leaves the host blank', () => {
    expect(resolveMysqlBinding({ url: 'mysql://user:password@/db' })).toEqual({
      kind: 'url',
      url: 'mysql://user:password@/db',
    });
  });
});
