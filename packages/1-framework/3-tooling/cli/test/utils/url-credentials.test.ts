import { describe, expect, it } from 'vitest';
import { redactUrlCredentials, urlUserinfo } from '../../src/utils/url-credentials';

describe('redactUrlCredentials', () => {
  it('masks the userinfo of every URL in the text', () => {
    expect(
      redactUrlCredentials(
        'failed: postgres://alice:hunter2@localhost:5432 and mongodb://bob:pw@h1:1,h2:2/db',
      ),
    ).toBe('failed: postgres://****:****@localhost:5432 and mongodb://****:****@h1:1,h2:2/db');
  });

  it('masks userinfo when host or user is left blank', () => {
    expect(
      redactUrlCredentials(
        'failed: postgres://alice:hunter2@/mydb and postgres://:hunter2@localhost/mydb and postgres://@/mydb',
      ),
    ).toBe('failed: postgres://****:****@/mydb and postgres://:****@localhost/mydb and postgres://@/mydb');
  });

  it('extracts userinfo when host or user is blank', () => {
    expect(urlUserinfo('postgres://alice:hunter2@/mydb')).toEqual({
      username: 'alice',
      password: 'hunter2',
    });
    expect(urlUserinfo('postgres://:hunter2@/mydb')).toEqual({
      username: '',
      password: 'hunter2',
    });
    expect(urlUserinfo('postgres:///mydb')).toEqual({
      username: '',
      password: '',
    });
  });

  it('masks a password query parameter', () => {
    expect(redactUrlCredentials('failed: postgres://h1:1,h2:2/db?sslpassword=pw&x=1')).toBe(
      'failed: postgres://h1:1,h2:2/db?sslpassword=****&x=1',
    );
  });

  it('passes empty input through untouched', () => {
    expect(redactUrlCredentials('')).toBe('');
  });
});
