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
    const url = 'host=localhost password=secret user=admin dbname=mydb';
    const masked = maskConnectionUrl(url);

    expect(masked).not.toContain('secret');
    expect(masked).not.toContain('admin');
    expect(masked).toContain('password=****');
    expect(masked).toContain('user=****');
    expect(masked).toContain('host=localhost');
    expect(masked).toContain('dbname=mydb');
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

  it('handles libpq-style connection strings in messages', () => {
    const url = 'host=localhost password=secret user=admin dbname=mydb';
    const message = 'Failed to connect: host=localhost password=secret user=admin';
    const sanitized = sanitizeErrorMessage(message, url);

    expect(sanitized).not.toContain('password=secret');
    expect(sanitized).not.toContain('user=admin');
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
