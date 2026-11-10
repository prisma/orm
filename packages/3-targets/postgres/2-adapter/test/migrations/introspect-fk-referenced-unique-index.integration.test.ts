import type { PostgresDatabaseSchemaNode } from '@internal/target-postgres/types';
import { createDevDatabase } from '@repo/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  controlAdapter,
  createDriver,
  type PostgresControlDriver,
  testTimeout,
} from './fixtures/runner-fixtures';

/**
 * A foreign key may reference a plain `CREATE UNIQUE INDEX` (no unique
 * constraint object). For FK constraints, `pg_constraint.conindid` points at
 * that index on the REFERENCED table, so the constraint-backed-index
 * exclusion in the index introspection must only consider constraints that
 * own their index (`contype IN ('p','u','x')`) — otherwise the referenced
 * index disappears from introspection and verify reports it missing.
 */
describe('introspection of a plain unique index referenced by a foreign key', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let driver: PostgresControlDriver;

  beforeAll(async () => {
    database = await createDevDatabase();
    driver = await createDriver(database.connectionString);

    await driver.query(`CREATE TABLE public.hub (
      id int4 NOT NULL,
      code text NOT NULL,
      CONSTRAINT hub_pkey PRIMARY KEY (id)
    )`);
    await driver.query('CREATE UNIQUE INDEX hub_code_idx ON public.hub (code)');
    await driver.query(`CREATE TABLE public.spoke (
      id int4 NOT NULL,
      hub_code text NOT NULL,
      CONSTRAINT spoke_pkey PRIMARY KEY (id),
      CONSTRAINT spoke_hub_code_fkey FOREIGN KEY (hub_code) REFERENCES public.hub(code)
    )`);
  }, testTimeout);

  afterAll(async () => {
    if (driver) await driver.close();
    if (database) await database.close();
  }, testTimeout);

  it(
    'the referenced unique index still introspects; constraint-backed indexes stay excluded',
    async () => {
      const result = (await controlAdapter.introspect(
        driver,
        undefined,
        'public',
      )) as PostgresDatabaseSchemaNode;
      const hub = result.namespaces['public']?.tables['hub'];
      const spoke = result.namespaces['public']?.tables['spoke'];

      expect(hub?.indexes.map((i) => i.name)).toEqual(['hub_code_idx']);
      expect(hub?.primaryKey?.columns).toEqual(['id']);
      expect(spoke?.indexes).toEqual([]);
      expect(spoke?.foreignKeys.map((fk) => fk.name)).toEqual(['spoke_hub_code_fkey']);
    },
    testTimeout,
  );
});
