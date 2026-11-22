import type { Client } from 'pg';

/** Lets the Supabase roles write through the dev database's change-capture trigger, which every table in it fires. */
export async function grantDevDatabaseSchema(client: Client): Promise<void> {
  await client.query('GRANT USAGE ON SCHEMA _prisma_dev_wal TO anon, authenticated, service_role');
  await client.query(
    'GRANT ALL ON ALL TABLES IN SCHEMA _prisma_dev_wal TO anon, authenticated, service_role',
  );
  await client.query(
    'GRANT ALL ON ALL SEQUENCES IN SCHEMA _prisma_dev_wal TO anon, authenticated, service_role',
  );
  await client.query(
    'GRANT EXECUTE ON FUNCTION _prisma_dev_wal.capture_event() TO anon, authenticated, service_role',
  );
}
