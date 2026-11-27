import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import {
  createMigrationPlan,
  INIT_ADDITIVE_POLICY,
  type SqlControlFamilyInstance,
} from '@internal/family-sql/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { buildFabricatedMigrationEdge } from '@internal/migration-tools/aggregate';
import { type SqlControlDriverInstance, SqlStorage } from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import type { PostgresPlanTargetDetails } from '../../src/core/migrations/planner-target-details';
import { createPostgresMigrationRunner } from '../../src/core/migrations/runner';
import { PostgresSchema } from '../../src/core/postgres-schema';

// Every row of the shipped table is the same, so no supported server passes one contract and fails another. This table has a flag only from 17.
const table = {
  15: { sql: { returning: true } },
  16: { sql: { returning: true } },
  17: { sql: { returning: true, mergeReturning: true } },
} as const;

function contractRequiring(
  name: string,
  capabilities: Contract['capabilities'],
): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash(name),
    storage: new SqlStorage({
      storageHash: coreHash(name),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: new PostgresSchema({
          id: UNBOUND_NAMESPACE_ID,
          entries: { table: {} },
        }),
      },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities,
    extensions: {},
    meta: {},
  };
}

function spaceCreatingTable(
  space: string,
  contract: Contract<SqlStorage>,
  driver: SqlControlDriverInstance<string>,
) {
  const plan = createMigrationPlan<PostgresPlanTargetDetails>({
    targetId: 'postgres',
    spaceId: space,
    origin: null,
    destination: { storageHash: contract.storage.storageHash, profileHash: contract.profileHash },
    operations: [
      {
        id: `${space}.create`,
        label: `Create ${space}_table`,
        operationClass: 'additive',
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'table', name: `${space}_table` },
        },
        precheck: [],
        execute: [
          { description: 'create', sql: `create table public.${space}_table (id integer)` },
        ],
        postcheck: [],
      },
    ],
    providedInvariants: [],
  });
  return {
    space,
    plan,
    migrationEdges: [
      buildFabricatedMigrationEdge({
        currentMarkerStorageHash: undefined,
        destinationStorageHash: contract.storage.storageHash,
        operationCount: 1,
      }),
    ],
    driver,
    destinationContract: contract,
    policy: INIT_ADDITIVE_POLICY,
    frameworkComponents: [],
  };
}

/** A driver for a PostgreSQL 16.4 server that records every statement it is sent. */
function recordingDriverOnPostgres16() {
  const sent: string[] = [];
  const driver: SqlControlDriverInstance<string> = {
    familyId: 'sql',
    targetId: 'postgres',
    query: async <Row = Record<string, unknown>>(sql: string) => {
      sent.push(sql);
      const rows = sql.includes('server_version_num') ? [{ server_version_num: 160004 }] : [];
      return { rows: rows as unknown as Row[] };
    },
    close: async () => {},
  };
  return { driver, sent };
}

describe('the PostgreSQL runner and the database capabilities', () => {
  it('checks every space before any runs, so a refused run sends nothing that changes the database', async () => {
    const { driver, sent } = recordingDriverOnPostgres16();
    const runner = createPostgresMigrationRunner({} as SqlControlFamilyInstance, table);

    const result = await runner.execute({
      driver,
      perSpaceOptions: [
        spaceCreatingTable('ext', contractRequiring('ext', { sql: { returning: true } }), driver),
        spaceCreatingTable(
          'app',
          contractRequiring('app', { sql: { returning: true, mergeReturning: true } }),
          driver,
        ),
      ],
    });

    const failure = result.assertNotOk();
    expect({
      code: failure.code,
      message: failure.message,
      failingSpace: failure.meta.failingSpace,
      databaseUnchanged: failure.meta.databaseUnchanged,
      databaseCapabilitiesNotProvided: failure.meta.databaseCapabilitiesNotProvided,
    }).toEqual({
      code: 'MIGRATION.DATABASE_CAPABILITIES_NOT_PROVIDED',
      message:
        "Your contract requires database capabilities first available in PostgreSQL 17 (sql.mergeReturning), but this database runs PostgreSQL 16.4. Either upgrade the database, or remove them from your contract's required capabilities.",
      failingSpace: 'app',
      databaseCapabilitiesNotProvided: {
        database: 'PostgreSQL',
        findings: [
          {
            kind: 'missing-capabilities',
            databaseVersion: '16.4',
            capabilities: [{ capability: 'sql.mergeReturning', firstVersion: 17 }],
          },
        ],
      },
      databaseUnchanged: true,
    });
    expect(sent).toEqual([
      'BEGIN',
      "SELECT current_setting('server_version_num')::int AS server_version_num",
      'ROLLBACK',
    ]);
  });
});
