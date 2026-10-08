import { PGlite } from '@electric-sql/pglite';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { POSTGRES_QUOTED_KEYWORDS } from '../src/core/postgres-keywords';

describe('POSTGRES_QUOTED_KEYWORDS', () => {
  it(
    'lists every keyword pg_get_keywords reports as not unreserved',
    async () => {
      const db = new PGlite();
      try {
        const { rows } = await db.query<{ word: string }>(
          "select word from pg_get_keywords() where catcode <> 'U'",
        );
        expect([...POSTGRES_QUOTED_KEYWORDS].sort()).toEqual(rows.map((row) => row.word).sort());
      } finally {
        await db.close();
      }
    },
    timeouts.spinUpPpgDev,
  );
});
