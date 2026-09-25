import { resolve } from 'node:path';
import type { MigrationEdge } from '@internal/migration-tools/graph';
import { describe, expect, it } from 'vitest';
import {
  maskConnectionUrl,
  resolveContractPath,
  resolveMigrationPaths,
  sanitizeErrorMessage,
  toStructuralEdge,
} from '../../src/utils/command-helpers';

describe('maskConnectionUrl', () => {
  it('masks username and password in standard PostgreSQL URL', () => {
    const url = 'postgresql://admin:secret@localhost:5432/mydb';
    const masked = maskConnectionUrl(url);

    expect(masked).toContain('****');
    expect(masked).not.toContain('admin');
    expect(masked).not.toContain('secret');
    expect(masked).toContain('localhost');
    expect(masked).toContain('mydb');
  });

  it('masks password in query parameters', () => {
    const url = 'postgresql://localhost:5432/mydb?password=secret';
    const masked = maskConnectionUrl(url);

    expect(masked).not.toContain('secret');
    expect(masked).toContain('password=****');
  });

  it('masks sslpassword query parameter', () => {
    const url = 'postgresql://localhost:5432/mydb?sslpassword=sslsecret';
    const masked = maskConnectionUrl(url);

    expect(masked).not.toContain('sslsecret');
  });

  it('preserves URL without credentials', () => {
    const url = 'postgresql://localhost:5432/mydb';
    const masked = maskConnectionUrl(url);

    expect(masked).toContain('localhost');
    expect(masked).toContain('mydb');
  });

  it('masks password and user in libpq-style connection string', () => {
    expect(maskConnectionUrl('host=localhost password=secret user=admin dbname=mydb')).toBe(
      'host=localhost password=**** user=**** dbname=mydb',
    );
  });

  it('masks the credentials of an SRV URL', () => {
    expect(
      maskConnectionUrl('mongodb+srv://admin:s3cret@cluster0.example.net/app?retryWrites=true'),
    ).toBe('mongodb+srv://****:****@cluster0.example.net/app?retryWrites=true');
  });

  describe('a URL that new URL rejects', () => {
    it('masks the credentials of a multi-host URL', () => {
      expect(maskConnectionUrl('mongodb://admin:s3cret@h1:27017,h2:27017/app?replicaSet=rs')).toBe(
        'mongodb://****:****@h1:27017,h2:27017/app?replicaSet=rs',
      );
    });

    it('masks a password with percent-encoded @, : and /', () => {
      expect(maskConnectionUrl('mongodb://admin:p%40ss%3Aw%2Frd@h1:27017,h2:27017/app')).toBe(
        'mongodb://****:****@h1:27017,h2:27017/app',
      );
    });

    it('masks everything up to the last @ of the authority', () => {
      expect(maskConnectionUrl('mongodb://admin:p@ss@h1:27017,h2:27017/app')).toBe(
        'mongodb://****:****@h1:27017,h2:27017/app',
      );
    });

    it('masks the credentials of a multi-host Postgres URL', () => {
      expect(
        maskConnectionUrl(
          'postgresql://admin:secret@h1:5432,h2:5432/mydb?target_session_attrs=read-write',
        ),
      ).toBe('postgresql://****:****@h1:5432,h2:5432/mydb?target_session_attrs=read-write');
    });

    it('masks a password query parameter', () => {
      expect(
        maskConnectionUrl(
          'postgresql://admin@h1:5432,h2:5432/mydb?password=secret&sslmode=require',
        ),
      ).toBe('postgresql://****@h1:5432,h2:5432/mydb?password=****&sslmode=require');
    });

    it('returns a URL without credentials unchanged', () => {
      const url = 'mongodb://h1:27017,h2:27017/app?replicaSet=rs';
      expect(maskConnectionUrl(url)).toBe(url);
    });
  });
});

describe('resolveContractPath', () => {
  it('uses config.contract.output when provided', () => {
    const result = resolveContractPath({ contract: { output: '/custom/path/contract.json' } });
    expect(result).toBe(resolve('/custom/path/contract.json'));
  });

  it('throws when no output is configured', () => {
    expect(() => resolveContractPath({})).toThrow(/contract\.output is required/);
  });

  it('throws when contract config exists but output is undefined', () => {
    expect(() => resolveContractPath({ contract: {} })).toThrow(/contract\.output is required/);
  });
});

describe('sanitizeErrorMessage', () => {
  it('returns message unchanged when no connection URL provided', () => {
    const message = 'Something failed';
    expect(sanitizeErrorMessage(message)).toBe(message);
    expect(sanitizeErrorMessage(message, undefined)).toBe(message);
  });

  it('strips raw connection URL from error message', () => {
    const url = 'postgresql://admin:secret@localhost:5432/mydb';
    const message = `Connection failed: ${url}`;
    const sanitized = sanitizeErrorMessage(message, url);

    expect(sanitized).not.toContain('secret');
    expect(sanitized).not.toContain('admin');
    expect(sanitized).toContain('Connection failed');
  });

  it('strips password that appears independently in the message', () => {
    const url = 'postgresql://admin:supersecret@localhost:5432/mydb';
    const message = 'password authentication failed for user "admin" with password supersecret';
    const sanitized = sanitizeErrorMessage(message, url);

    expect(sanitized).not.toContain('supersecret');
  });

  it('masks a password query parameter value where the message names it on its own', () => {
    const url = 'postgresql://admin:s3cret@localhost:5432/mydb?sslpassword=sslkey&sslmode=require';
    const message = 'could not decrypt SSL key with password=sslkey (sslmode=require)';

    expect(sanitizeErrorMessage(message, url)).toBe(
      'could not decrypt SSL key with password=**** (sslmode=require)',
    );
  });

  it('masks a secret whole when another secret is part of it', () => {
    const url = 'postgresql://admin:secret@localhost:5432/mydb?sslpassword=sslsecret';

    expect(sanitizeErrorMessage('bad SSL key sslsecret', url)).toBe('bad SSL key ****');
  });

  it('handles libpq-style connection strings in messages', () => {
    const url = 'host=localhost password=secret user=admin dbname=mydb';
    const message = 'Failed to connect: host=localhost password=secret user=admin';

    expect(sanitizeErrorMessage(message, url)).toBe(
      'Failed to connect: host=localhost password=**** user=****',
    );
  });

  describe('a connection URL that new URL rejects', () => {
    it('masks the URL where the message quotes it', () => {
      const url = 'mongodb://admin:s3cret@h1:27017,h2:27017/app?replicaSet=rs';

      expect(sanitizeErrorMessage(`connect failed: ${url}`, url)).toBe(
        'connect failed: mongodb://****:****@h1:27017,h2:27017/app?replicaSet=rs',
      );
    });

    it('masks a percent-encoded password where the message quotes the URL', () => {
      const url = 'mongodb://admin:p%40ss%3Aw%2Frd@h1:27017,h2:27017/app';

      expect(sanitizeErrorMessage(`bad auth for ${url}`, url)).toBe(
        'bad auth for mongodb://****:****@h1:27017,h2:27017/app',
      );
    });

    it('masks the user and password where the message names them on their own', () => {
      const url = 'postgresql://admin:secret@h1:5432,h2:5432/mydb';

      expect(sanitizeErrorMessage('auth failed for user "admin" with secret', url)).toBe(
        'auth failed for user "****" with ****',
      );
    });

    it('masks a password query parameter value where the message names it on its own', () => {
      const url = 'postgresql://admin@h1:5432,h2:5432/mydb?sslpassword=sslsecret&sslmode=require';

      expect(sanitizeErrorMessage(`bad SSL key sslsecret for ${url}`, url)).toBe(
        'bad SSL key **** for postgresql://****@h1:5432,h2:5432/mydb?sslpassword=****&sslmode=require',
      );
    });

    it('returns a message with a URL without credentials unchanged', () => {
      const url = 'mongodb://h1:27017,h2:27017/app';
      const message = `connect ECONNREFUSED ${url}`;

      expect(sanitizeErrorMessage(message, url)).toBe(message);
    });
  });
});

describe('resolveMigrationPaths', () => {
  describe('a validated config', () => {
    it('uses the absolute migrations dir the config carries, whatever cwd is', () => {
      const paths = resolveMigrationPaths(
        { baseDir: '/work/app', migrations: { dir: '/work/app/db' } },
        '/work/scratch',
      );

      expect(paths).toMatchObject({
        configPath: 'prisma.config.ts',
        migrationsDir: '/work/app/db',
        migrationsRelative: '../app/db',
      });
    });

    it('defaults the migrations dir under baseDir when the config names none', () => {
      expect(resolveMigrationPaths({ baseDir: '/work/app' }, '/tmp').migrationsDir).toBe(
        '/work/app/migrations',
      );
    });
  });

  describe('a raw config from a programmatic caller', () => {
    it('anchors a relative migrations dir on cwd when the config carries no baseDir', () => {
      expect(resolveMigrationPaths({ migrations: { dir: 'db' } }, '/work/app').migrationsDir).toBe(
        '/work/app/db',
      );
    });

    it('anchors the default on cwd', () => {
      expect(resolveMigrationPaths({}, '/work/app')).toMatchObject({
        migrationsDir: '/work/app/migrations',
        migrationsRelative: 'migrations',
      });
    });
  });
});

describe('toStructuralEdge', () => {
  function edge(overrides: Partial<MigrationEdge> = {}): MigrationEdge {
    return {
      from: 'from',
      to: 'to',
      migrationHash: 'mh:1',
      dirName: 'm1',
      createdAt: '2026-01-01T00:00:00.000Z',
      invariants: [],
      ...overrides,
    };
  }

  it('extracts the wire-shape fields and drops authoring metadata', () => {
    const result = toStructuralEdge(
      edge({
        createdAt: '2026-02-01T00:00:00.000Z',
        invariants: ['X', 'Y'],
      }),
    );
    expect(Object.keys(result).sort()).toEqual([
      'dirName',
      'from',
      'invariants',
      'migrationHash',
      'to',
    ]);
    expect(result.invariants).toEqual(['X', 'Y']);
  });
});
