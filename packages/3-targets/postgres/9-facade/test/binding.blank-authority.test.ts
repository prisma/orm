import { describe, expect, it } from 'vitest';
import { validatePostgresUrl } from '../src/runtime/binding';

describe('validatePostgresUrl with an omitted authority', () => {
  it('accepts a socket-style URL and returns it unchanged', () => {
    expect(validatePostgresUrl('postgresql:///mydb')).toBe('postgresql:///mydb');
  });

  it('accepts a URL with a port but no host and returns it unchanged', () => {
    expect(validatePostgresUrl('postgresql://:5432/mydb')).toBe('postgresql://:5432/mydb');
  });

  it('accepts a URL with a user but no host and returns it unchanged', () => {
    expect(validatePostgresUrl('postgresql://app@/mydb')).toBe('postgresql://app@/mydb');
  });

  it('accepts a URL whose host is an encoded unix socket path', () => {
    expect(validatePostgresUrl('postgresql://%2Fvar%2Frun%2Fpostgresql/mydb')).toBe(
      'postgresql://%2Fvar%2Frun%2Fpostgresql/mydb',
    );
  });

  it('rejects a multi-host URL with a dedicated message', () => {
    expect(() => validatePostgresUrl('postgresql://host1,host2/mydb')).toThrow(/multi-host/i);
  });

  it('still rejects an empty URL', () => {
    expect(() => validatePostgresUrl('  ')).toThrow(/non-empty/);
  });

  it('still rejects a wrong scheme', () => {
    expect(() => validatePostgresUrl('mysql:///mydb')).toThrow(/postgres/i);
  });
});
