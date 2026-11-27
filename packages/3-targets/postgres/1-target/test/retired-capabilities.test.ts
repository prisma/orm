import { describe, expect, it } from 'vitest';
import { postgresRetiredCapabilities } from '../src/core/retired-capabilities';
import { postgresDatabaseCapabilities } from '../src/core/server-version';
import postgresRuntimeTarget from '../src/exports/runtime';

describe('the retired capabilities', () => {
  it('are the flags the release candidates wrote into every PostgreSQL contract and that nothing reads any more', () => {
    expect(postgresRetiredCapabilities).toEqual({
      postgres: {
        jsonAgg: true,
        lateral: true,
        limit: true,
        orderBy: true,
        returning: true,
        'paradedb/bm25': true,
        'pgvector.cosine': true,
        'postgis.geometry': true,
      },
      sql: { enums: true },
    });
  });

  it('are none of the database’s capabilities, which signing checks', () => {
    const databaseKeys = Object.entries(postgresDatabaseCapabilities).flatMap(([ns, flags]) =>
      Object.keys(flags).map((flag) => `${ns}.${flag}`),
    );
    const retiredKeys = Object.entries(postgresRetiredCapabilities).flatMap(([ns, flags]) =>
      Object.keys(flags).map((flag) => `${ns}.${flag}`),
    );
    expect(retiredKeys.filter((key) => databaseKeys.includes(key))).toEqual([]);
  });

  it('are declared by the runtime target, so the client’s checks ignore them', () => {
    expect(postgresRuntimeTarget.retiredCapabilities).toBe(postgresRetiredCapabilities);
  });
});
