/**
 * Integration test — `contract infer` against a live database that has a
 * cross-space foreign key from an app table into the Supabase pack's `auth`
 * space, alongside the app's own unrelated `public.users` table.
 *
 * `public.profile.userId` references `auth.users.id` directly via raw SQL
 * DDL (no planner/app-contract involved — `contract infer` describes an
 * existing database, so the fixture only needs the DB state, not a contract
 * that produced it). The app also owns a `public.users` table that shares the
 * bare name `users` with the pack-owned `auth.users` — the FK classifier must
 * consult `referencedSchema` and the pack-owned coordinate before the bare
 * name, so the local `public.users` shadow does not capture the FK. With the
 * Supabase pack in the stack, `contract infer` must:
 *
 *   - keep `public.profile` in the inferred PSL,
 *   - keep the app's own `public.users` as a `Users` model,
 *   - omit `auth.users` (the pack already describes it),
 *   - emit the FK as the qualified cross-space relation
 *     `supabase:auth.AuthUser @relation(fields: [userId], references: [id],
 *     onDelete: Cascade)` — matching how `examples/supabase/src/contract.prisma`
 *     hand-authors the same relationship — rather than wiring it to the local
 *     `Users` model or stripping it.
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

describe('contract infer — cross-space FK into the Supabase pack', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let migrationsDir: string;

  beforeEach(async () => {
    database = await createDevDatabase();
    migrationsDir = await mkdtemp(join(tmpdir(), 'infer-cross-space-fk-'));
  }, timeouts.spinUpPpgDev);

  afterEach(async () => {
    if (database) await database.close();
    if (migrationsDir) await rm(migrationsDir, { recursive: true, force: true });
  }, timeouts.spinUpPpgDev);

  it(
    'keeps profile and the local public.users, omits auth.users, emits supabase:auth.AuthUser @relation(...)',
    async () => {
      const { connectionString } = database;

      await withClient(connectionString, async (client) => {
        await setUpSupabaseMockSchema(client);
        await client.query(`
          CREATE TABLE public.users (
            id    uuid NOT NULL PRIMARY KEY,
            handle text NOT NULL
          )
        `);
        await client.query(`
          CREATE TABLE public.profile (
            id         uuid NOT NULL PRIMARY KEY,
            "userId"   uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
            username   text NOT NULL
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
        expect(modelNames).toContain('Profile');
        expect(modelNames).toContain('Users');
        expect(modelNames).not.toContain('AuthUser');
        expect(modelNames).not.toContain('AuthUsers');

        const profileModel = models.find((m) => m.name === 'Profile');
        const relationField = profileModel?.fields.find((f) => f.name === 'user');
        expect(relationField?.typeName).toBe('AuthUser');
        expect(relationField?.typeNamespaceId).toBe('auth');
        expect(relationField?.typeContractSpaceId).toBe('supabase');
        expect(profileModel?.fields.some((f) => f.typeName === 'Users')).toBe(false);

        const printed = printPsl(ast, { pslBlockDescriptors: client.getPslBlockDescriptors() });
        expect(printed).toMatch(/\buser\s+supabase:auth\.AuthUser\b/);
        expect(printed).toContain(
          '@relation(fields: [userId], references: [id], onDelete: Cascade',
        );
      } finally {
        await client.close();
      }
    },
    timeouts.spinUpPpgDev * 2,
  );
});
