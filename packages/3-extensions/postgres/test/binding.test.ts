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

describe('validatePostgresUrl', () => {
  it('defaults an empty host to localhost', () => {
    expect(validatePostgresUrl('postgresql:///mydb')).toBe('postgresql://localhost/mydb');
  });

  it('drops empty userinfo so driver defaults apply', () => {
    expect(validatePostgresUrl('postgresql://localhost/mydb')).toBe('postgresql://localhost/mydb');
    expect(validatePostgresUrl('postgresql://@localhost/mydb')).toBe('postgresql://localhost/mydb');
  });

  it('keeps provided credentials, host, and port', () => {
    expect(validatePostgresUrl('postgresql://u:p@db.example.com:5433/mydb')).toBe(
      'postgresql://u:p@db.example.com:5433/mydb',
    );
  });

  it('defaults only the missing host when credentials are present', () => {
    expect(validatePostgresUrl('postgresql://u:p@/mydb')).toBe('postgresql://u:p@localhost/mydb');
  });

  it('leaves a socket-dir host query parameter alone', () => {
    expect(validatePostgresUrl('postgresql:///mydb?host=/var/run/postgresql')).toBe(
      'postgresql:///mydb?host=/var/run/postgresql',
    );
  });

  it('preserves query params and schema', () => {
    expect(validatePostgresUrl('postgres://u@h/mydb?schema=app&sslmode=require')).toBe(
      'postgres://u@h/mydb?schema=app&sslmode=require',
    );
  });

  it('rejects a non-postgres scheme', () => {
    expect(() => validatePostgresUrl('mysql://h/db')).toThrow('postgres:// or postgresql://');
  });

  it('rejects an empty url', () => {
    expect(() => validatePostgresUrl('   ')).toThrow('non-empty string');
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
