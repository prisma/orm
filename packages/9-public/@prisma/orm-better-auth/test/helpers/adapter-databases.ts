import type { BetterAuthOptions, BetterAuthPlugin } from '@better-auth/core';
import type { SqlContract } from '../../src/models/model-lookup';
import { createContractFixture } from './contract-fixture';
import {
  applyContract,
  emitContract,
  openPostgresClient,
  openSqliteClient,
  resetPostgres,
  type TargetName,
} from './databases';
import { type PostgresServer, startPostgresServer } from './postgres-server';
import { pslForConfiguration } from './printed-psl';

export type TestClient =
  | ReturnType<typeof openSqliteClient>
  | ReturnType<typeof openPostgresClient>;

/**
 * Builds test databases from PSL: SQLite in a new file each time, Postgres in one `@prisma/dev` server, started on first use and reset each time. Opening a database closes the client of the one before.
 */
export interface AdapterDatabases {
  emptyContract(target: TargetName): SqlContract;
  open(target: TargetName, psl: string): Promise<TestClient>;
  dispose(): Promise<void>;
}

export async function createAdapterDatabases(): Promise<AdapterDatabases> {
  const contracts = await createContractFixture();
  const workDir = contracts.workDir;
  let server: PostgresServer | undefined;
  let current: TestClient | undefined;
  const closeCurrent = async () => {
    await current?.close();
    current = undefined;
  };
  return {
    emptyContract: (target) => contracts.emptyContract(target),
    async open(target, psl) {
      await closeCurrent();
      const emitted = await emitContract(target, psl, workDir);
      if (target === 'sqlite') {
        const path = `${workDir.nextPath('database')}.sqlite`;
        await applyContract(target, emitted.json, path, workDir);
        current = openSqliteClient(emitted.json, path);
      } else {
        server ??= await startPostgresServer();
        await resetPostgres(server.url);
        await applyContract(target, emitted.json, server.url, workDir);
        current = openPostgresClient(emitted.json, server.url);
      }
      return current;
    },
    async dispose() {
      await closeCurrent();
      await server?.close();
      await workDir.remove();
    },
  };
}

/** A Better Auth model with one field of each type the filters and sorts are tested on. */
export const probePlugin: BetterAuthPlugin = {
  id: 'probe',
  schema: {
    probe: {
      fields: {
        text: { type: 'string', required: false },
        flag: { type: 'boolean', required: false },
        meta: { type: 'json', required: false },
        at: { type: 'date', required: false },
        n: { type: 'number', required: false },
      },
    },
  },
};

export const probeOptions: BetterAuthOptions = {
  plugins: [probePlugin],
  rateLimit: { storage: 'database' },
};

/**
 * The PSL the adapter prints for `probeOptions`, with `Probe.meta` declared `Json` and a column `extra` the application added.
 */
export function probePsl(databases: AdapterDatabases, target: TargetName): string {
  const psl = pslForConfiguration(databases.emptyContract(target), probeOptions);
  const edited = psl
    .replace(/(model Probe \{[^}]*\n\s+meta\s+)String\?/, '$1Json?')
    .replace(/(model Probe \{\n)/, '$1  extra String? @default("added by the application")\n');
  if (!edited.includes('Json?') || !edited.includes('extra')) throw new Error('No Probe model');
  return edited;
}
