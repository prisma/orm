/**
 * The Vite plugin and the programmatic control client run inside a process the user owns. In a
 * process with no global `Temporal` they read and render date and time defaults, and they set no
 * global `Temporal`.
 *
 * Both load the Postgres target's control entry, which sets a fallback `Temporal` when it is
 * loaded. The fallback is held once per process, so application code in the same process decodes
 * dates too; `temporal-fallback-entries.test.ts` in `@prisma/orm-target-postgres` shows that.
 */
import { writeFileSync } from 'node:fs';
import { withClient } from '@repo/test-utils';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { withTempDir } from './utils/cli-test-helpers';
import { emittedColumns } from './utils/emitted-columns';
import {
  type JourneyContext,
  runContractEmit,
  setupJourney,
  timeouts,
  useDevDatabase,
} from './utils/journey-test-helpers';
import {
  childOutput,
  NO_GLOBAL_TEMPORAL,
  runNodeWithoutTemporal,
} from './utils/node-without-temporal';

const SCHEMA = `// use prisma-8

model Event {
  id        Int      @id
  createdAt DateTime @default("2024-01-01T00:00:00Z")

  @@map("event")
}
`;

const VITE_PLUGIN_SCRIPT = `
import { prismaVitePlugin } from '@internal/vite-plugin-contract-emit';

const sent = [];
const server = {
  httpServer: { on() {} },
  watcher: { on() {}, off() {}, add() {}, unwatch() {} },
  ws: { send: (message) => sent.push(message) },
  moduleGraph: { getModuleById: () => null, onFileChange() {} },
  ssrLoadModule: async () => ({}),
};
const plugin = prismaVitePlugin('prisma.config.ts', { logLevel: 'silent' });
plugin.configResolved({ root: process.cwd() });
await plugin.configureServer(server);
process.stdout.write(JSON.stringify(sent.filter((message) => message.type === 'error')));
`;

const CONTROL_CLIENT_SCRIPT = `
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgresAdapter from '@internal/adapter-postgres/control';
import { createControlClient } from '@internal/cli/control-api';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import postgres from '@internal/target-postgres/control';

const client = createControlClient({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensions: [],
});
try {
  await client.connect(process.env.JOURNEY_DB_URL);
  const result = await client.dbInit({
    contract: JSON.parse(readFileSync('contract.json', 'utf8')),
    mode: 'apply',
    migrationsDir: resolve('migrations'),
  });
  process.stdout.write(JSON.stringify({ ok: result.ok }));
} finally {
  await client.close();
}
`;

function writeProjectFile(ctx: JourneyContext, name: string, content: string): string {
  const path = join(ctx.testDir, name);
  writeFileSync(path, content, 'utf-8');
  return path;
}

withTempDir(({ createTempDir }) => {
  describe('Journey: library entry points in a process with no Temporal', () => {
    const db = useDevDatabase();

    it(
      'the Vite plugin emits a contract with a DateTime default',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        writeProjectFile(ctx, 'contract.prisma', SCHEMA);
        const script = writeProjectFile(ctx, 'run-vite-plugin.mjs', VITE_PLUGIN_SCRIPT);

        const run = await runNodeWithoutTemporal([script], { cwd: ctx.testDir });

        expect(run, childOutput(run)).toMatchObject({
          exitCode: 0,
          stdout: '[]',
          ...NO_GLOBAL_TEMPORAL,
        });
        expect(emittedColumns(ctx.testDir)['createdAt']?.default).toEqual({
          kind: 'literal',
          value: '2024-01-01T00:00:00Z',
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'createControlClient creates a table with a DateTime default',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        writeProjectFile(ctx, 'contract.prisma', SCHEMA);
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `contract emit\n${emit.stderr}\n${emit.stdout}`).toBe(0);
        const script = writeProjectFile(ctx, 'run-control-client.mjs', CONTROL_CLIENT_SCRIPT);

        const run = await runNodeWithoutTemporal([script], {
          cwd: ctx.testDir,
          env: { JOURNEY_DB_URL: db.connectionString },
        });

        expect(run, childOutput(run)).toMatchObject({
          exitCode: 0,
          stdout: '{"ok":true}',
          ...NO_GLOBAL_TEMPORAL,
        });
        const defaults = await withClient(db.connectionString, async (client) => {
          await client.query('INSERT INTO "event" ("id") VALUES (1)');
          const result = await client.query<Record<string, string>>(
            `SELECT ("createdAt" AT TIME ZONE 'UTC')::text AS "createdAt" FROM "event"`,
          );
          return result.rows;
        });
        expect(defaults).toEqual([{ createdAt: '2024-01-01 00:00:00' }]);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
