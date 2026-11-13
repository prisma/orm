import { Client, Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  isPgClient,
  isPgPool,
  resolveOptionalPostgresBinding,
  resolvePostgresBinding,
  validatePostgresUrl,
} from '../src/runtime/binding';

function duckPool() {
  return {
    connect() {},
    query() {},
    totalCount: 0,
    idleCount: 0,
    waitingCount: 0,
  };
}

function duckClient() {
  return {
    query() {},
    escapeIdentifier() {},
    escapeLiteral() {},
  };
}

describe('isPgPool', () => {
  it('is true for a real Pool instance', () => {
    expect(isPgPool(new Pool())).toBe(true);
  });

  it('is true for a duck-typed pool that is not a Pool instance', () => {
    const pool = duckPool();
    expect(pool instanceof Pool).toBe(false);
    expect(isPgPool(pool as unknown as Pool)).toBe(true);
  });

  it('is false for a real Client instance', () => {
    expect(isPgPool(new Client() as unknown as Pool)).toBe(false);
  });

  it('is false for a duck-typed client', () => {
    expect(isPgPool(duckClient() as unknown as Pool)).toBe(false);
  });
});

describe('isPgClient', () => {
  it('is true for a real Client instance', () => {
    expect(isPgClient(new Client())).toBe(true);
  });

  it('is true for a duck-typed client', () => {
    expect(isPgClient(duckClient() as unknown as Client)).toBe(true);
  });

  it('is false for a real Pool instance', () => {
    expect(isPgClient(new Pool() as unknown as Client)).toBe(false);
  });

  it('is false for a duck-typed pool', () => {
    expect(isPgClient(duckPool() as unknown as Client)).toBe(false);
  });
});

describe('resolvePostgresBinding', () => {
  it('resolves a real pg Pool to a pgPool binding', () => {
    const pool = new Pool();
    expect(resolvePostgresBinding({ pg: pool })).toEqual({ kind: 'pgPool', pool });
  });

  it('resolves a duck-typed pool to a pgPool binding', () => {
    const pool = duckPool();
    expect(resolvePostgresBinding({ pg: pool as unknown as Pool })).toEqual({
      kind: 'pgPool',
      pool,
    });
  });

  it('resolves a duck-typed client to a pgClient binding', () => {
    const client = duckClient();
    expect(resolvePostgresBinding({ pg: client as unknown as Client })).toEqual({
      kind: 'pgClient',
      client,
    });
  });

  it('throws when pg input is neither Pool nor Client', () => {
    expect(() => resolvePostgresBinding({ pg: { query: () => {} } as unknown as Client })).toThrow(
      'Unable to determine pg binding type from pg input',
    );
  });
});

describe('resolveOptionalPostgresBinding with a narrowed list of kinds', () => {
  const rules = { extension: 'test-client', kinds: { url: true, pgPool: true } } as const;

  it('refuses a binding of a Postgres kind outside the list, naming only the listed kinds', () => {
    const client = new Client();

    expect(() =>
      resolveOptionalPostgresBinding({ binding: { kind: 'pgClient', client } }, rules),
    ).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.BINDING_INVALID',
        message: "The binding option must have kind 'url' or 'pgPool'",
        fix: "Pass binding: { kind: 'url', url } or { kind: 'pgPool', pool }.",
        meta: {
          extension: 'test-client',
          reason: 'unknown binding kind',
          receivedKind: 'pgClient',
        },
      }),
    );
  });

  it('refuses a binding of a kind outside the list before checking its contents', () => {
    expect(() =>
      resolveOptionalPostgresBinding(
        { binding: { kind: 'pgClient', client: 'x' } } as unknown as Parameters<
          typeof resolveOptionalPostgresBinding
        >[0],
        rules,
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.BINDING_INVALID',
        message: "The binding option must have kind 'url' or 'pgPool'",
        meta: {
          extension: 'test-client',
          reason: 'unknown binding kind',
          receivedKind: 'pgClient',
        },
      }),
    );
  });

  it('refuses a pg.Client passed as pg, naming the pg option', () => {
    const client = new Client();

    expect(() => resolveOptionalPostgresBinding({ pg: client }, rules)).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.BINDING_INVALID',
        message: 'The pg option is a pg.Client, which this client does not take',
        fix: "Pass a pg.Pool as pg, or binding: { kind: 'url', url } or { kind: 'pgPool', pool }.",
        meta: { extension: 'test-client', reason: 'refused pg input', receivedKind: 'pgClient' },
      }),
    );
  });

  it('refuses a url when url is not listed, naming the url option', () => {
    expect(() =>
      resolveOptionalPostgresBinding(
        { url: 'postgres://localhost/db' },
        { extension: 'test-client', kinds: { pgPool: true } },
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.BINDING_INVALID',
        message: 'The url option is a connection string, which this client does not take',
        meta: { extension: 'test-client', reason: 'refused url input', receivedKind: 'url' },
      }),
    );
  });

  it('accepts a binding of a listed kind', () => {
    expect(
      resolveOptionalPostgresBinding(
        { binding: { kind: 'url', url: 'postgres://localhost/db' } },
        rules,
      ),
    ).toEqual({ kind: 'url', url: 'postgres://localhost/db' });
  });
});

describe('validatePostgresUrl', () => {
  it('accepts connection string with blank user and host', () => {
    expect(validatePostgresUrl('postgresql:///mydb')).toBe('postgresql:///mydb');
    expect(validatePostgresUrl('postgres:///mydb')).toBe('postgres:///mydb');
  });

  it('accepts connection string with blank user and explicit host', () => {
    expect(validatePostgresUrl('postgresql://localhost/mydb')).toBe('postgresql://localhost/mydb');
    expect(validatePostgresUrl('postgresql://@localhost/mydb')).toBe(
      'postgresql://@localhost/mydb',
    );
  });

  it('accepts connection string with blank host and explicit user', () => {
    expect(validatePostgresUrl('postgresql://user@/mydb')).toBe('postgresql://user@/mydb');
    expect(validatePostgresUrl('postgresql://user:pass@/mydb')).toBe(
      'postgresql://user:pass@/mydb',
    );
  });

  it('accepts connection string with blank user and host but explicit port', () => {
    expect(validatePostgresUrl('postgresql://:5432/mydb')).toBe('postgresql://:5432/mydb');
    expect(validatePostgresUrl('postgresql://user@:5432/mydb')).toBe(
      'postgresql://user@:5432/mydb',
    );
    expect(validatePostgresUrl('postgresql://:5432/mydb?host=/var/run/postgresql')).toBe(
      'postgresql://:5432/mydb?host=/var/run/postgresql',
    );
  });

  it('accepts connection string with percent-encoded Unix socket directory containing a comma', () => {
    expect(validatePostgresUrl('postgresql://%2Ftmp%2Fpostgres,socket/mydb')).toBe(
      'postgresql://%2Ftmp%2Fpostgres,socket/mydb',
    );
    expect(validatePostgresUrl('postgresql://user:pass@%2Fvar%2Frun%2Fpostgresql,local/mydb')).toBe(
      'postgresql://user:pass@%2Fvar%2Frun%2Fpostgresql,local/mydb',
    );
  });

  it('rejects multi-host connection string', () => {
    expect(() => validatePostgresUrl('postgresql://h1:5432,h2:5432/mydb')).toThrow(
      'Postgres URL must be a valid URL',
    );
    expect(() => validatePostgresUrl('postgresql://h1,h2/mydb')).toThrow(
      'Postgres URL must be a valid URL',
    );
    expect(() => validatePostgresUrl('postgresql://h1,h2:5432/mydb')).toThrow(
      'Postgres URL must be a valid URL',
    );
    expect(() => validatePostgresUrl('postgresql://user:pass@h1,h2/mydb')).toThrow(
      'Postgres URL must be a valid URL',
    );
  });

  it('rejects connection string without authority slashes', () => {
    expect(() => validatePostgresUrl('postgresql:mydb')).toThrow(
      'Postgres URL must be a valid URL',
    );
  });
});
