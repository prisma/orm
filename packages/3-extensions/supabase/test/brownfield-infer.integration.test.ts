/**
 * Integration test — brownfield inference: the headline "adopt an existing
 * Supabase project" scenario. `contract infer` (with the Supabase pack in
 * the stack) runs against a live database that already has the full
 * Supabase reference schema (auth/storage/roles, via `setUpSupabaseMockSchema`)
 * plus a couple of ordinary app tables in `public` — one of which has a
 * foreign key into `auth.users`, exercising the same cross-space rewrite
 * `infer-cross-space-fk.integration.test.ts` covers in isolation.
 *
 * Asserts on the written PSL:
 *   - the app's own tables (`public.list`, `public.todo`) come back as
 *     ordinary models,
 *   - the FK into `auth.users` comes back as the qualified cross-space
 *     relation `supabase:auth.AuthUser`,
 *   - nothing from `auth`/`storage` (beyond that one qualified reference) or
 *     from any other Supabase-internal schema (`NEVER_LEAKED_SCHEMAS`
 *     below) leaks into the output. `contract infer` only introspects
 *     the default `public` schema, so none of this should be reachable in
 *     the first place — asserting it guards against a regression that
 *     widens that scope.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgresAdapter from '@internal/adapter-postgres/control';
import { createControlClient } from '@internal/cli/control-api';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import { flatPslModels } from '@internal/framework-components/psl-ast';
import { printPsl } from '@internal/psl-printer';
import postgres from '@internal/target-postgres/control';
import { createDevDatabase, timeouts, withClient } from '@repo/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import supabasePack from '../src/exports/pack';
import { setUpSupabaseMockSchema } from './fixtures/supabase-reference/set-up-mock-schema';

/** Schemas that must never appear as an unqualified `<schema>.` reference. */
const NEVER_LEAKED_SCHEMAS = [
  'auth',
  'storage',
  'realtime',
  'vault',
  'pgsodium',
  'supabase_functions',
  'net',
  '_realtime',
  'graphql',
  'graphql_public',
  'extensions',
];

/**
 * Matches an unqualified `<schema>.` reference, word-boundary-aware in both
 * directions the plain-substring check was fragile in: the lookbehind
 * rejects a match inside a longer identifier (`oauth.` never matches the
 * `auth` pattern) and excuses a contract-space-qualified reference
 * (`supabase:auth.` — the one legitimate form a pack-owned schema may take
 * in the output).
 */
function unqualifiedSchemaReference(schemaName: string): RegExp {
  return new RegExp(String.raw`(?<![\w:])${schemaName}\.`);
}

describe('contract infer — brownfield: app tables alongside the full Supabase reference schema', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let migrationsDir: string;

  beforeEach(async () => {
    database = await createDevDatabase();
    migrationsDir = await mkdtemp(join(tmpdir(), 'brownfield-infer-'));
  }, timeouts.spinUpPpgDev);

  afterEach(async () => {
    if (database) await database.close();
    if (migrationsDir) await rm(migrationsDir, { recursive: true, force: true });
  }, timeouts.spinUpPpgDev);

  it(
    'keeps the app tables, qualifies the FK into auth.users, and leaks no auth/storage/realtime/vault/... elements',
    async () => {
      const { connectionString } = database;

      await withClient(connectionString, async (client) => {
        await setUpSupabaseMockSchema(client);
        await client.query(`
          CREATE TABLE public.list (
            id    uuid NOT NULL PRIMARY KEY,
            title text NOT NULL
          )
        `);
        await client.query(`
          CREATE TABLE public.todo (
            id        uuid NOT NULL PRIMARY KEY,
            "listId"  uuid NOT NULL REFERENCES public.list(id) ON DELETE CASCADE,
            "ownerId" uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
            title     text NOT NULL
          )
        `);
      });

      const client = createControlClient({
        family: sql,
        target: postgres,
        adapter: postgresAdapter,
        driver: postgresDriver,
        extensions: [supabasePack],
      });

      try {
        await client.connect(connectionString);
        const schema = await client.introspect({});
        const ast = await client.inferPslContract(schema);
        if (!ast) {
          throw new Error('Expected inferPslContract to return a PSL document');
        }

        const models = flatPslModels(ast);
        const modelNames = models.map((m) => m.name);

        // Positive: the app's own tables survive as ordinary models.
        expect(modelNames).toContain('List');
        expect(modelNames).toContain('Todo');

        const todoModel = models.find((m) => m.name === 'Todo');
        const ownerField = todoModel?.fields.find((f) => f.name === 'owner');
        expect(ownerField?.typeName).toBe('AuthUser');
        expect(ownerField?.typeNamespaceId).toBe('auth');
        expect(ownerField?.typeContractSpaceId).toBe('supabase');

        const printed = printPsl(ast, { pslBlockDescriptors: client.getPslBlockDescriptors() });
        expect(printed).toMatch(/\bowner\s+supabase:auth\.AuthUser\b/);
        expect(printed).toContain(
          '@relation(fields: [ownerId], references: [id], onDelete: Cascade',
        );

        // Negative space: no auth.*/storage.* model or native_enum leaks
        // (the pack's own tables are pack-subtracted), and no element of
        // any other Supabase-internal schema leaks either.
        expect(modelNames).not.toContain('AuthUser');
        expect(modelNames).not.toContain('AuthUsers');
        expect(modelNames).not.toContain('AuthSession');
        expect(modelNames).not.toContain('AuthIdentity');
        expect(modelNames).not.toContain('StorageBucket');
        expect(modelNames).not.toContain('StorageObject');

        // The pattern excuses `supabase:auth.` (asserted present above), so
        // any match here is an unqualified schema-element leak.
        for (const schemaName of NEVER_LEAKED_SCHEMAS) {
          expect(printed).not.toMatch(unqualifiedSchemaReference(schemaName));
        }
      } finally {
        await client.close();
      }
    },
    timeouts.spinUpPpgDev * 2,
  );
});
