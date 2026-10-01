import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { loadAppConfig } from '../src/app-config';
import { ormClientBm25TopMatches } from '../src/orm-client/bm25-top-matches';
import { db } from '../src/prisma/db';
import { bm25Match } from '../src/queries/bm25-match';
import { bm25TopByScore } from '../src/queries/bm25-top-by-score';

const SKIP = process.env['DATABASE_URL'] === undefined;

describe.skipIf(SKIP)('paradedb BM25 integration', { timeout: timeouts.databaseOperation }, () => {
  it('matchBm25 returns rows whose description matches the query', async () => {
    const { databaseUrl } = loadAppConfig();
    const runtime = await db.connect({ url: databaseUrl });
    try {
      const rows = await bm25Match('headphones');
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.some((r) => r.description.toLowerCase().includes('headphones'))).toBe(true);
    } finally {
      await runtime.close();
    }
  });

  it('bm25Score orders matching rows by descending relevance', async () => {
    const { databaseUrl } = loadAppConfig();
    const runtime = await db.connect({ url: databaseUrl });
    try {
      const rows = await bm25TopByScore('laptop');
      expect(rows.length).toBeGreaterThan(0);
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i - 1]!.score).toBeGreaterThanOrEqual(rows[i]!.score);
      }
    } finally {
      await runtime.close();
    }
  });

  it('ORM client returns top matches', async () => {
    const { databaseUrl } = loadAppConfig();
    const runtime = await db.connect({ url: databaseUrl });
    try {
      const rows = await ormClientBm25TopMatches('laptop', 5, runtime);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.some((r) => r.description.toLowerCase().includes('laptop'))).toBe(true);
    } finally {
      await runtime.close();
    }
  });
});
