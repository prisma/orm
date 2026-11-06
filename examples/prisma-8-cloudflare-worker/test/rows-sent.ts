import { Client } from 'pg';

/**
 * Runs `read` and returns how many rows of the post table the server sent while it ran, read from
 * pg_stat_statements through a separate pg.Client.
 */
export async function countPostRowsSent(
  connectionString: string,
  read: () => Promise<void>,
): Promise<number> {
  const observer = new Client({ connectionString });
  observer.on('error', () => {});
  await observer.connect();
  try {
    await observer.query('SELECT pg_stat_statements_reset()');
    await read();
    const result = await observer.query<{ rows: string }>(
      `SELECT COALESCE(SUM(rows), 0)::text AS rows
       FROM pg_stat_statements
       WHERE query ILIKE '%from%post%'`,
    );
    return Number(result.rows[0]?.rows ?? '0');
  } finally {
    await observer.end();
  }
}
