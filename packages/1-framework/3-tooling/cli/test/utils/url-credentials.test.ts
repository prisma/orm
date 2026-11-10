import { describe, expect, it } from 'vitest';
import { redactUrlCredentials } from '../../src/utils/url-credentials';

describe('redactUrlCredentials', () => {
  it('masks the userinfo of every URL in the text', () => {
    expect(
      redactUrlCredentials(
        'failed: postgres://alice:hunter2@localhost:5432 and mongodb://bob:pw@h1:1,h2:2/db',
      ),
    ).toBe('failed: postgres://****:****@localhost:5432 and mongodb://****:****@h1:1,h2:2/db');
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
