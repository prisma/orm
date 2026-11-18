import type { PlanMeta } from '@internal/contract/types';
import type { SqlExecutionPlan } from '@internal/sql-relational-core/plan';
import { describe, expect, it } from 'vitest';
import { computeSqlContentHash } from '../src/content-hash';
import { stubAst } from './utils';

function makeMeta(overrides?: Partial<PlanMeta>): PlanMeta {
  return {
    target: 'postgres',
    storageHash: 'test',
    lane: 'dsl',
    ...overrides,
  };
}

function makeExec(overrides?: {
  sql?: string;
  params?: readonly unknown[];
  meta?: Partial<PlanMeta>;
}): SqlExecutionPlan {
  return {
    sql: overrides?.sql ?? 'select 1',
    params: overrides?.params ?? [],
    ast: stubAst(),
    meta: makeMeta(overrides?.meta),
  };
}

describe('computeSqlContentHash', () => {
  describe('stability', () => {
    it('returns the same hash for identical plans', async () => {
      const a = makeExec({ sql: 'select * from users where id = $1', params: [42] });
      const b = makeExec({ sql: 'select * from users where id = $1', params: [42] });
      expect(await computeSqlContentHash(a)).toBe(await computeSqlContentHash(b));
    });

    it('is insensitive to object key insertion order in params', async () => {
      const a = makeExec({
        sql: 'insert into users (data) values ($1)',
        params: [{ name: 'Alice', age: 30 }],
      });
      const b = makeExec({
        sql: 'insert into users (data) values ($1)',
        params: [{ age: 30, name: 'Alice' }],
      });
      expect(await computeSqlContentHash(a)).toBe(await computeSqlContentHash(b));
    });

    it('is insensitive to nested object key order in params', async () => {
      const a = makeExec({
        sql: 'select * from users where filter = $1',
        params: [{ outer: { a: 1, b: 2 }, after: true }],
      });
      const b = makeExec({
        sql: 'select * from users where filter = $1',
        params: [{ after: true, outer: { b: 2, a: 1 } }],
      });
      expect(await computeSqlContentHash(a)).toBe(await computeSqlContentHash(b));
    });
  });

  describe('discrimination', () => {
    it('discriminates on differing storageHash with same SQL and params', async () => {
      const a = makeExec({ sql: 'select 1', params: [], meta: { storageHash: 'v1' } });
      const b = makeExec({ sql: 'select 1', params: [], meta: { storageHash: 'v2' } });
      expect(await computeSqlContentHash(a)).not.toBe(await computeSqlContentHash(b));
    });

    it('discriminates on differing SQL with same storageHash and params', async () => {
      const a = makeExec({ sql: 'select * from users', params: [] });
      const b = makeExec({ sql: 'select * from posts', params: [] });
      expect(await computeSqlContentHash(a)).not.toBe(await computeSqlContentHash(b));
    });

    it('discriminates on differing param values with same SQL and storageHash', async () => {
      const a = makeExec({ sql: 'select * from users where id = $1', params: [1] });
      const b = makeExec({ sql: 'select * from users where id = $1', params: [2] });
      expect(await computeSqlContentHash(a)).not.toBe(await computeSqlContentHash(b));
    });

    it('discriminates on differing param order (positional params are order-significant)', async () => {
      const a = makeExec({ sql: 'select * from t where a = $1 and b = $2', params: [1, 2] });
      const b = makeExec({ sql: 'select * from t where a = $1 and b = $2', params: [2, 1] });
      expect(await computeSqlContentHash(a)).not.toBe(await computeSqlContentHash(b));
    });

    it('discriminates BigInt params from same-valued numeric params', async () => {
      const a = makeExec({ sql: 'select * from t where id = $1', params: [1] });
      const b = makeExec({ sql: 'select * from t where id = $1', params: [1n] });
      expect(await computeSqlContentHash(a)).not.toBe(await computeSqlContentHash(b));
    });

    it('discriminates null param from undefined param', async () => {
      const a = makeExec({ sql: 'select * from t where x = $1', params: [null] });
      const b = makeExec({ sql: 'select * from t where x = $1', params: [undefined] });
      expect(await computeSqlContentHash(a)).not.toBe(await computeSqlContentHash(b));
    });

    it('discriminates Date params at differing instants', async () => {
      const a = makeExec({
        sql: 'select * from events where t = $1',
        params: [new Date('2026-01-01T00:00:00.000Z')],
      });
      const b = makeExec({
        sql: 'select * from events where t = $1',
        params: [new Date('2026-01-02T00:00:00.000Z')],
      });
      expect(await computeSqlContentHash(a)).not.toBe(await computeSqlContentHash(b));
    });

    it('discriminates Buffer params with differing bytes', async () => {
      const a = makeExec({
        sql: 'select * from blobs where data = $1',
        params: [new Uint8Array([0x01, 0x02])],
      });
      const b = makeExec({
        sql: 'select * from blobs where data = $1',
        params: [new Uint8Array([0x01, 0x03])],
      });
      expect(await computeSqlContentHash(a)).not.toBe(await computeSqlContentHash(b));
    });
  });

  describe('shape', () => {
    it('returns a fixed-size hashContent digest', async () => {
      const exec = makeExec({
        sql: 'select 1',
        params: [42],
        meta: { storageHash: 'abc' },
      });
      const hash = await computeSqlContentHash(exec);
      expect(hash).toMatch(/^sha512:[0-9a-f]{128}$/);
    });

    it('does not embed the raw SQL or params in its output (opacity)', async () => {
      const sensitiveSql = 'select * from users where token = $1';
      const sensitiveParam = 'super-secret-token-1234567890';
      const exec = makeExec({ sql: sensitiveSql, params: [sensitiveParam] });
      const hash = await computeSqlContentHash(exec);
      expect(hash).not.toContain(sensitiveSql);
      expect(hash).not.toContain(sensitiveParam);
    });

    it('returns the same hash for two identical empty-params plans', async () => {
      const a = makeExec({ sql: 'select 1', params: [] });
      const b = makeExec({ sql: 'select 1', params: [] });
      expect(await computeSqlContentHash(a)).toBe(await computeSqlContentHash(b));
    });
  });
});
