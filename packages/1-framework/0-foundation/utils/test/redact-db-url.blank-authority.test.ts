import { describe, expect, it } from 'vitest';
import { redactDatabaseUrl } from '../src/redact-db-url';

describe('redactDatabaseUrl with an omitted authority', () => {
  it('omits host and username for a socket-style URL', () => {
    const result = redactDatabaseUrl('postgresql:///mydb');

    expect(result.database).toBe('mydb');
    expect(result.host).toBeUndefined();
    expect(result.username).toBeUndefined();
  });

  it('omits host but keeps the port when only the port is present', () => {
    const result = redactDatabaseUrl('postgresql://:5432/mydb');

    expect(result.database).toBe('mydb');
    expect(result.port).toBe('5432');
    expect(result.host).toBeUndefined();
  });

  it('keeps the username when only the username is present', () => {
    const result = redactDatabaseUrl('postgresql://app@/mydb');

    expect(result.username).toBe('app');
    expect(result.host).toBeUndefined();
  });

  it('keeps every component when the URL has a host', () => {
    const result = redactDatabaseUrl('postgresql://user@db.internal:5432/app');

    expect(result.host).toBe('db.internal');
    expect(result.username).toBe('user');
  });
});
