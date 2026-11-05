import { Client, Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  isPgClient,
  isPgPool,
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
