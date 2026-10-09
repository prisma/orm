import { readFileSync } from 'node:fs';
import pg from 'pg';

const client = new pg.Client({ connectionString: readFileSync('database-url.txt', 'utf8') });
await client.connect();
for (const sql of process.argv.slice(2)) {
  console.log(`\n> ${sql}`);
  try {
    const { rows } = await client.query(sql);
    if (rows.length === 0) console.log('  (no rows)');
    for (const row of rows) console.log(`  ${JSON.stringify(row)}`);
  } catch (error) {
    console.log(`  error: ${error.message}`);
  }
}
await client.end();
