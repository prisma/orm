import { describe, expect, it } from 'vitest';
import { redactDatabaseUrl } from '../src/redact-db-url';

describe('redactDatabaseUrl', () => {
  it('extracts host, port, database, and username', () => {
    const result = redactDatabaseUrl('postgresql://user:pass@db.internal:5432/app_db');

    expect(result).toMatchObject({
      host: 'db.internal',
      port: '5432',
      database: 'app_db',
      username: 'user',
    });
  });

  it('omits empty components', () => {
    const result = redactDatabaseUrl('postgresql://localhost/app_db');

    expect(result).toMatchObject({
      host: 'localhost',
      database: 'app_db',
    });
    expect(result.port).toBeUndefined();
    expect(result.username).toBeUndefined();
  });

  it('extracts database when user and host are omitted', () => {
    const result = redactDatabaseUrl('postgresql:///app_db');

    expect(result).toEqual({ database: 'app_db' });
  });

  it('extracts username and database when host is omitted', () => {
    const result = redactDatabaseUrl('postgresql://user@/app_db');

    expect(result).toEqual({ database: 'app_db', username: 'user' });
  });

  it('extracts port and database when user and host are omitted', () => {
    const result = redactDatabaseUrl('postgresql://:5432/app_db');

    expect(result).toEqual({ database: 'app_db', port: '5432' });
  });

  it('returns empty object when parsing fails', () => {
    const result = redactDatabaseUrl('not-a-valid-url');

    expect(result).toEqual({});
  });

  it('returns empty object for multi-host URLs', () => {
    expect(redactDatabaseUrl('postgresql://h1:5432,h2:5432/app_db')).toEqual({});
    expect(redactDatabaseUrl('postgresql://h1,h2/app_db')).toEqual({});
  });

  it('extracts metadata for MongoDB multi-host URLs', () => {
    expect(redactDatabaseUrl('mongodb://h1,h2/app_db')).toEqual({
      host: 'h1,h2',
      database: 'app_db',
    });
    expect(redactDatabaseUrl('mongodb://user:pass@h1,h2/app_db')).toEqual({
      host: 'h1,h2',
      database: 'app_db',
      username: 'user',
    });
  });
});
