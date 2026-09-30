import { tsquery, websearchToTsquery } from '@internal/target-postgres/full-text';
import { describe, expect, it } from 'vitest';
import { setupIntegrationTest, timeouts } from './setup';

describe('integration: ilike (target operation)', { timeout: timeouts.databaseOperation }, () => {
  const { db, runtime } = setupIntegrationTest();

  it('ilike filters case-insensitively in WHERE', async () => {
    const rows = await runtime().query(
      db()
        .public.users.select('id', 'name')
        .where((f, fns) => fns.ilike(f.name, '%alice%'))
        .build(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('Alice');
  });

  it('ilike returns no rows when pattern does not match', async () => {
    const rows = await runtime().query(
      db()
        .public.users.select('id')
        .where((f, fns) => fns.ilike(f.name, '%zzz%'))
        .build(),
    );
    expect(rows).toHaveLength(0);
  });
});

describe('integration: extension functions', { timeout: timeouts.databaseOperation }, () => {
  const { db, runtime } = setupIntegrationTest();

  it('cosineDistance computes distance for identical vectors', async () => {
    const row = await runtime()
      .query(
        db()
          .public.posts.select('id')
          .select('distance', (f, fns) => fns.cosineDistance(f.embedding, [1, 0, 0]))
          .where((f, fns) => fns.eq(f.id, 1))
          .build(),
      )
      .firstOrThrow();
    // template: self <=> arg0, identical vectors → distance = 0
    expect(row.distance).toBeCloseTo(0, 5);
  });

  it('cosineDistance filters in WHERE', async () => {
    // post 1 has embedding [1,0,0] → distance to [1,0,0] is 0.0
    // post 3 has embedding [0,0,1] → distance to [1,0,0] is ~1 (orthogonal)
    const rows = await runtime().query(
      db()
        .public.posts.select('id')
        .where((f, fns) => fns.lt(fns.cosineDistance(f.embedding, [1, 0, 0]), 0.5))
        .build(),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.id === 1)).toBe(true);
  });

  it('cosineSimilarity computes similarity for identical vectors', async () => {
    const row = await runtime()
      .query(
        db()
          .public.posts.select('id')
          .select('similarity', (f, fns) => fns.cosineSimilarity(f.embedding, [1, 0, 0]))
          .where((f, fns) => fns.eq(f.id, 1))
          .build(),
      )
      .firstOrThrow();
    // template: 1 - (self <=> arg0), identical vectors → 1 - 0 = 1
    expect(row.similarity).toBeCloseTo(1, 5);
  });

  it('cosineSimilarity filters in WHERE', async () => {
    // post 1 has embedding [1,0,0] → similarity to [1,0,0] is 1.0
    // post 3 has embedding [0,0,1] → similarity to [1,0,0] is ~0 (orthogonal)
    const rows = await runtime().query(
      db()
        .public.posts.select('id')
        .where((f, fns) => fns.gt(fns.cosineSimilarity(f.embedding, [1, 0, 0]), 0.5))
        .build(),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.id === 1)).toBe(true);
  });
});

describe('integration: full-text search', { timeout: timeouts.databaseOperation }, () => {
  const { db, runtime } = setupIntegrationTest();

  const idsMatching = async (query: string, language?: 'german') => {
    const rows = await runtime().query(
      db()
        .public.comments.select('id')
        .where((f, fns) =>
          language === undefined
            ? fns.fullTextMatches(f.body, fns.websearchToTsquery(query))
            : fns.fullTextMatches(f.body, fns.websearchToTsquery(query, { language }), {
                language,
              }),
        )
        .build(),
    );
    return rows.map((row) => row.id).sort((a, b) => a - b);
  };

  it('fullTextMatches keeps rows containing the word and drops the rest', async () => {
    expect(await idsMatching('alice')).toEqual([101, 102, 106]);
  });

  it('fullTextMatches on a quoted phrase requires the words to be adjacent', async () => {
    expect(await idsMatching('"quick brown"')).toEqual([104]);
  });

  it('fullTextMatches excludes rows carrying a -prefixed word', async () => {
    expect(await idsMatching('alice -manuscript')).toEqual([101, 102]);
  });

  it('fullTextMatches accepts a non-default language', async () => {
    expect(await idsMatching('alice', 'german')).toEqual([101, 102, 106]);
  });

  it('toTsquery takes a word:* prefix, which matches every word it starts', async () => {
    const rows = await runtime().query(
      db()
        .public.comments.select('id')
        .where((f, fns) => fns.fullTextMatches(f.body, fns.toTsquery('manu:*')))
        .build(),
    );
    expect(rows.map((row) => row.id)).toEqual([106]);
  });

  it('toTsquery takes operator syntax', async () => {
    const rows = await runtime().query(
      db()
        .public.comments.select('id')
        .where((f, fns) => fns.fullTextMatches(f.body, fns.toTsquery('alice & !manuscript')))
        .build(),
    );
    expect(rows.map((row) => row.id).sort((a, b) => a - b)).toEqual([101, 102]);
  });

  it('toTsquery on malformed text fails at execution with the Postgres error', async () => {
    await expect(
      runtime().query(
        db()
          .public.comments.select('id')
          .where((f, fns) => fns.fullTextMatches(f.body, fns.toTsquery('alice &')))
          .build(),
      ),
    ).rejects.toThrow(/tsquery/);
  });

  it('a tsquery read back from a query binds as the query and matches the same rows', async () => {
    const { query } = await runtime()
      .query(
        db()
          .public.comments.select('query', (_f, fns) =>
            fns.websearchToTsquery('Alice -manuscripts'),
          )
          .limit(1)
          .build(),
      )
      .firstOrThrow();
    const viaParser = await runtime().query(
      db()
        .public.comments.select('id')
        .where((f, fns) =>
          fns.fullTextMatches(f.body, fns.websearchToTsquery('Alice -manuscripts')),
        )
        .orderBy((f) => f.id, { direction: 'asc' })
        .build(),
    );
    const viaReadBack = await runtime().query(
      db()
        .public.comments.select('id')
        .where((f, fns) => fns.fullTextMatches(f.body, query))
        .orderBy((f) => f.id, { direction: 'asc' })
        .build(),
    );

    expect(query).toBe("'alic' & !'manuscript'");
    expect(viaParser.map((row) => row.id)).toEqual([101, 102]);
    expect(viaReadBack).toEqual(viaParser);
  });

  describe('the tsquery tag', () => {
    const idsMatchingPrefix = async (term: string) => {
      const rows = await runtime().query(
        db()
          .public.comments.select('id')
          .where((f, fns) => fns.fullTextMatches(f.body, tsquery`${term}:*`))
          .build(),
      );
      return rows.map((row) => row.id).sort((a, b) => a - b);
    };

    it.each([
      ['Rep', [101, 103]],
      ['Alice', [101, 102, 106]],
      ['new y', []],
      ["zebra's", []],
      ['a&', []],
      ['re:port', []],
      ["x' | 'secret", []],
      ['', []],
      ['the', []],
    ])('runs the typed term %o as one normalized prefix term, without error', async (term, ids) => {
      expect(await idsMatchingPrefix(term)).toEqual(ids);
    });

    it("keeps the application's operators when the value carries its own", async () => {
      const idsFor = async (term: string) => {
        const rows = await runtime().query(
          db()
            .public.comments.select('id')
            .where((f, fns) => fns.fullTextMatches(f.body, tsquery`${term}:* & 'report'`))
            .build(),
        );
        return rows.map((row) => row.id);
      };

      expect(await idsFor('bob')).toEqual([103]);
      expect(await idsFor("bob' | 'alice")).toEqual([]);
    });
  });

  it('a parser takes a varchar column as its text', async () => {
    const row = await runtime()
      .query(
        db()
          .public.comments.select('id')
          .select('query', (f, fns) => fns.websearchToTsquery(f.subject))
          .where((f, fns) => fns.eq(f.id, 101))
          .build(),
      )
      .firstOrThrow();
    expect(row).toEqual({ id: 101, query: "'alic' & 'subject' & 'line'" });
  });

  it('one query expression can filter, rank and highlight', async () => {
    const query = websearchToTsquery('alice');
    const rows = await runtime().query(
      db()
        .public.comments.select('id')
        .select('snippet', (f, fns) => fns.fullTextHeadline(f.body, query))
        .where((f, fns) => fns.fullTextMatches(f.body, query))
        .orderBy((f, fns) => fns.fullTextRank(f.body, query), { direction: 'desc' })
        .orderBy((f) => f.id, { direction: 'asc' })
        .build(),
    );
    expect(rows).toEqual([
      { id: 102, snippet: '<b>alice</b> met <b>alice</b> and <b>alice</b> again' },
      { id: 101, snippet: '<b>alice</b> wrote the report' },
      { id: 106, snippet: '<b>alice</b> manuscript draft' },
    ]);
  });

  it('a selected parser expression reads back as the normalized tsquery text', async () => {
    const row = await runtime()
      .query(
        db()
          .public.comments.select('id')
          .select('query', (_f, fns) => fns.websearchToTsquery('The zebras grazed'))
          .where((f, fns) => fns.eq(f.id, 101))
          .build(),
      )
      .firstOrThrow();
    expect(row).toEqual({ id: 101, query: "'zebra' & 'graze'" });
  });

  it('fullTextRank ranks the row with more occurrences first', async () => {
    const rows = await runtime().query(
      db()
        .public.comments.select('id')
        .where((f, fns) => fns.fullTextMatches(f.body, fns.websearchToTsquery('alice')))
        .orderBy((f, fns) => fns.fullTextRank(f.body, fns.websearchToTsquery('alice')), {
          direction: 'desc',
        })
        .build(),
    );
    expect(rows.map((row) => row.id)[0]).toBe(102);
  });

  it('fullTextHeadline takes the markers it is given', async () => {
    const row = await runtime()
      .query(
        db()
          .public.comments.select('id')
          .select('snippet', (f, fns) =>
            fns.fullTextHeadline(f.body, fns.websearchToTsquery('alice'), {
              startSel: '<mark>',
              stopSel: '</mark>',
            }),
          )
          .where((f, fns) => fns.eq(f.id, 101))
          .build(),
      )
      .firstOrThrow();
    expect(row.snippet).toBe('<mark>alice</mark> wrote the report');
  });

  it('fullTextRank normalizes the score into (0, 1] when asked', async () => {
    const rows = await runtime().query(
      db()
        .public.comments.select('id')
        .select('rank', (f, fns) =>
          fns.fullTextRank(f.body, fns.websearchToTsquery('alice'), { normalization: 32 }),
        )
        .where((f, fns) => fns.fullTextMatches(f.body, fns.websearchToTsquery('alice')))
        .build(),
    );

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.rank).toBeGreaterThan(0);
      expect(row.rank).toBeLessThanOrEqual(1);
    }
  });

  it('fullTextHeadline marks the matched word up', async () => {
    const row = await runtime()
      .query(
        db()
          .public.comments.select('id')
          .select('snippet', (f, fns) =>
            fns.fullTextHeadline(f.body, fns.websearchToTsquery('alice')),
          )
          .where((f, fns) => fns.eq(f.id, 101))
          .build(),
      )
      .firstOrThrow();
    expect(row.snippet).toBe('<b>alice</b> wrote the report');
  });

  it("fullTextHeadline rejects a minWords at Postgres's default maxWords before the query runs", () => {
    expect(() =>
      db()
        .public.comments.select('id')
        .select('snippet', (f, fns) =>
          fns.fullTextHeadline(f.body, fns.websearchToTsquery('alice'), { minWords: 35 }),
        )
        .build(),
    ).toThrow(expect.objectContaining({ code: 'RUNTIME.ARGUMENT_INVALID' }));
  });

  it('fullTextHeadline takes a maxWords below the default minWords under highlightAll', async () => {
    const row = await runtime()
      .query(
        db()
          .public.comments.select('id')
          .select('snippet', (f, fns) =>
            fns.fullTextHeadline(f.body, fns.websearchToTsquery('alice'), {
              maxWords: 10,
              highlightAll: true,
            }),
          )
          .where((f, fns) => fns.eq(f.id, 101))
          .build(),
      )
      .firstOrThrow();
    expect(row.snippet).toBe('<b>alice</b> wrote the report');
  });
});
