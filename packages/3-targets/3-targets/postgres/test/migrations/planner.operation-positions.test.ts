import {
  asNamespaceId,
  type Contract,
  type ContractModelBase,
  coreHash,
  profileHash,
} from '@internal/contract/types';
import {
  APP_SPACE_ID,
  planOriginOf,
  type ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import { postgresContractToSchema } from '../../src/core/migrations/postgres-contract-to-schema';
import { postgresCreateNamespace } from '../../src/core/postgres-schema';
import { postgresTypeComponents } from '../postgres-type-lookups';
import { stubLowerer } from './rename-table-fixtures';

const NAMESPACES = ['auth', 'billing'] as const;
const int4 = { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false };
const text = { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false };

function model(namespaceId: string, table: string): ContractModelBase {
  return {
    fields: {},
    relations: {},
    storage: { table, namespaceId, fields: {} },
  };
}

/** The same model and table name in two schemas. */
function contractWithTableInBothSchemas(table: string, hashSeed: string): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash(hashSeed),
    storage: new SqlStorage({
      storageHash: coreHash(hashSeed),
      namespaces: Object.fromEntries(
        NAMESPACES.map((id) => [
          id,
          postgresCreateNamespace({
            id,
            entries: {
              table: {
                [table]: new StorageTable({
                  columns: { id: int4, email: text, note: text },
                  primaryKey: { columns: ['id'] },
                  uniques: [{ columns: ['email'] }],
                  indexes: [],
                  foreignKeys: [],
                }),
              },
            },
          }),
        ]),
      ),
    }),
    domain: {
      namespaces: Object.fromEntries(
        NAMESPACES.map((id) => [id, { models: { [table]: model(id, table) } }]),
      ),
    },
    roots: {},
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

function renameIn(namespaceId: string): ResolvedMigrationStatement {
  return {
    kind: 'rename',
    entity: 'model',
    from: { namespaceId: asNamespaceId(namespaceId), model: 'Profile' },
    to: { namespaceId: asNamespaceId(namespaceId), model: 'User' },
  };
}

function plan(
  from: Contract<SqlStorage>,
  to: Contract<SqlStorage>,
  statements: readonly ResolvedMigrationStatement[],
) {
  const result = createPostgresMigrationPlanner(stubLowerer).plan({
    contract: to,
    schema: postgresContractToSchema(from, postgresTypeComponents),
    policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
    fromContract: from,
    origin: planOriginOf(from),
    statements,
    frameworkComponents: postgresTypeComponents,
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
  if (result.kind !== 'success') {
    throw new Error(`expected a plan, got ${JSON.stringify(result.conflicts)}`);
  }
  return result;
}

type PlannedOperation = {
  readonly id: string;
  readonly target: { readonly details?: { readonly schema?: string } };
};

async function operationsOf(result: ReturnType<typeof plan>): Promise<readonly PlannedOperation[]> {
  return Promise.all(result.plan.operations);
}

describe('Postgres statements over same-named tables in two schemas', () => {
  const from = contractWithTableInBothSchemas('Profile', 'from');
  const to = contractWithTableInBothSchemas('User', 'to');

  it('point each statement at its own operations by position, although their ids are the same', async () => {
    const result = plan(from, to, [renameIn('auth'), renameIn('billing')]);
    const operations = await operationsOf(result);
    const [auth, billing] = result.appliedStatements.map((applied) =>
      applied.operationIndexes.map((index) => operations[index]),
    );

    expect(auth?.map((operation) => operation?.target.details?.schema)).toEqual(
      auth?.map(() => 'auth'),
    );
    expect(billing?.map((operation) => operation?.target.details?.schema)).toEqual(
      billing?.map(() => 'billing'),
    );
    expect(auth?.[0]?.id).toBe(billing?.[0]?.id);
    expect(auth?.length).toBeGreaterThan(0);
  });
});
