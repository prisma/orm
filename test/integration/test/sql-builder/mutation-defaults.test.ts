import { describe, expect, it } from 'vitest';
import { setupIntegrationTest, timeouts } from './setup';

describe('integration: mutation defaults', { timeout: timeouts.databaseOperation }, () => {
  const { db, runtime } = setupIntegrationTest();

  it('INSERT applies execution default (generated uuid) when column is omitted', async () => {
    const row = await runtime()
      .query(
        db()
          .public.articles.insert([{ title: 'Hello' }])
          .returning('id', 'title')
          .build(),
      )
      .firstOrThrow();

    expect(row.title).toBe('Hello');
    expect(row.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('INSERT respects user-provided value over execution default', async () => {
    const explicitId = '00000000-0000-4000-8000-000000000001';
    const row = await runtime()
      .query(
        db()
          .public.articles.insert([{ id: explicitId, title: 'Explicit' }])
          .returning('id', 'title')
          .build(),
      )
      .firstOrThrow();

    expect(row.id).toBe(explicitId);
    expect(row.title).toBe('Explicit');
  });
});
