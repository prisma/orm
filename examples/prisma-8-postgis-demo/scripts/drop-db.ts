import 'dotenv/config';
import pg from 'pg';

async function dropDatabase() {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const client = new pg.Client({ connectionString: databaseUrl });

  try {
    await client.connect();
    console.log('Connected to database');

    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
    console.log('✔ Dropped and recreated public schema');

    await client.query('DROP SCHEMA IF EXISTS _prisma CASCADE');
    await client.query('DROP SCHEMA IF EXISTS prisma_contract CASCADE');
    console.log('✔ Dropped the _prisma and prisma_contract schemas');

    console.log('\nDatabase reset complete');
  } finally {
    await client.end();
  }
}

dropDatabase().catch((error) => {
  console.error('Fatal error while resetting database:', error);
  process.exitCode = 1;
});
