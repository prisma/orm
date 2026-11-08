import { describe, expect, it } from 'vitest';
import { pgConnectionConfig } from '../src/session-settings';

describe('pgConnectionConfig with omitted user or host', () => {
  it('leaves host and user absent for a socket-style URL with an empty authority', () => {
    const config = pgConnectionConfig({ connectionString: 'postgresql:///mydb' }, {});

    expect('host' in config).toBe(false);
    expect('user' in config).toBe(false);
    expect(config.database).toBe('mydb');
  });

  it('keeps an explicit port while leaving the host absent', () => {
    const config = pgConnectionConfig({ connectionString: 'postgresql://:5432/mydb' }, {});

    expect(config.port).toBe('5432');
    expect('host' in config).toBe(false);
  });

  it('keeps an explicit user while leaving the host absent', () => {
    const config = pgConnectionConfig({ connectionString: 'postgresql://app@/mydb' }, {});

    expect(config.user).toBe('app');
    expect('host' in config).toBe(false);
  });

  it('keeps a socket path given as the host query parameter', () => {
    const config = pgConnectionConfig(
      { connectionString: 'postgresql://:5432/app?host=/var/run/postgresql' },
      {},
    );

    expect(config.host).toBe('/var/run/postgresql');
    expect(config.port).toBe('5432');
  });

  it('keeps an encoded socket path given as the host query parameter', () => {
    const config = pgConnectionConfig(
      { connectionString: 'postgresql://:5432/app?host=%2Fvar%2Frun%2Fpostgresql' },
      {},
    );

    expect(config.host).toBe('/var/run/postgresql');
  });

  it('keeps a host the URL provides', () => {
    const config = pgConnectionConfig(
      { connectionString: 'postgresql://db.internal:5432/app' },
      {},
    );

    expect(config.host).toBe('db.internal');
    expect(config.port).toBe('5432');
  });
});

describe('pgConnectionConfig with a query host and an omitted authority', () => {
  it('keeps the socket host from the query when the authority omits the host', () => {
    const config = pgConnectionConfig(
      { connectionString: 'postgresql://user@?host=/tmp' },
      {},
    );

    expect(config.host).toBe('/tmp');
    expect(config.user).toBe('user');
  });
});
