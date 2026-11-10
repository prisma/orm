/**
 * After a namespace rename or a model move, a model or field the plan drops is still asked about
 * by its name in the origin contract, so the question offers `--rename` as well as `--delete`.
 */
import { createHash } from 'node:crypto';
import { asNamespaceId, type Contract, coreHash, profileHash } from '@internal/contract/types';
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

const ALL_CLASSES = { allowedOperationClasses: ['additive', 'widening', 'destructive'] as const };
const int4 = { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false };

/** Per namespace, each model's table and its columns besides `id`; each column is a field of the same name. */
type Spec = Readonly<
  Record<
    string,
    Readonly<Record<string, { readonly table: string; readonly columns?: readonly string[] }>>
  >
>;

function contractOf(spec: Spec, seed: string): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash(seed),
    storage: new SqlStorage({
      storageHash: coreHash(createHash('sha256').update(seed).digest('hex')),
      namespaces: Object.fromEntries(
        Object.entries(spec).map(([id, models]) => [
          id,
          postgresCreateNamespace({
            id,
            entries: {
              table: Object.fromEntries(
                Object.values(models).map(({ table, columns = [] }) => [
                  table,
                  new StorageTable({
                    columns: Object.fromEntries(['id', ...columns].map((column) => [column, int4])),
                    primaryKey: { columns: ['id'] },
                    uniques: [],
                    indexes: [],
                    foreignKeys: [],
                  }),
                ]),
              ),
            },
          }),
        ]),
      ),
    }),
    roots: {},
    domain: {
      namespaces: Object.fromEntries(
        Object.entries(spec).map(([id, models]) => [
          id,
          {
            models: Object.fromEntries(
              Object.entries(models).map(([model, { table, columns = [] }]) => [
                model,
                {
                  fields: {},
                  relations: {},
                  storage: {
                    table,
                    namespaceId: id,
                    fields: Object.fromEntries(
                      ['id', ...columns].map((column) => [column, { column }]),
                    ),
                  },
                },
              ]),
            ),
          },
        ]),
      ),
    },
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

function dataLossOf(
  from: Contract<SqlStorage>,
  to: Contract<SqlStorage>,
  statements: readonly ResolvedMigrationStatement[],
) {
  const result = createPostgresMigrationPlanner(stubLowerer).plan({
    contract: to,
    schema: postgresContractToSchema(from, postgresTypeComponents),
    policy: ALL_CLASSES,
    fromContract: from,
    origin: planOriginOf(from),
    statements,
    frameworkComponents: postgresTypeComponents,
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
  if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
  return result.dataLoss.map(({ subject }) => subject);
}

const ns = asNamespaceId;

describe('Postgres planner, subjects after namespace statements', () => {
  it('names a model of a renamed namespace that the destination stores under another name', () => {
    const from = contractOf({ billing: { Invoice: { table: 'Invoice' } } }, 'rename-from');
    const to = contractOf({ finance: { Bill: { table: 'Bill' } } }, 'rename-to');

    expect(
      dataLossOf(from, to, [
        { kind: 'rename', entity: 'namespace', from: ns('billing'), to: ns('finance') },
      ]),
    ).toEqual([{ kind: 'model', namespaceId: ns('billing'), model: 'Invoice' }]);
  });

  it('names a field the destination drops from a moved model', () => {
    const from = contractOf(
      { public: { Invoice: { table: 'Invoice', columns: ['status'] } }, billing: {} },
      'move-from',
    );
    const to = contractOf({ public: {}, billing: { Invoice: { table: 'Invoice' } } }, 'move-to');

    expect(
      dataLossOf(from, to, [
        {
          kind: 'rename',
          entity: 'model',
          from: { namespaceId: ns('public'), model: 'Invoice' },
          to: { namespaceId: ns('billing'), model: 'Invoice' },
        },
      ]),
    ).toEqual([{ kind: 'field', namespaceId: ns('public'), model: 'Invoice', field: 'status' }]);
  });

  it('names a field the destination drops from a model of a renamed namespace', () => {
    const from = contractOf(
      { billing: { Invoice: { table: 'Invoice', columns: ['status'] } } },
      'field-from',
    );
    const to = contractOf({ finance: { Invoice: { table: 'Invoice' } } }, 'field-to');

    expect(
      dataLossOf(from, to, [
        { kind: 'rename', entity: 'namespace', from: ns('billing'), to: ns('finance') },
      ]),
    ).toEqual([{ kind: 'field', namespaceId: ns('billing'), model: 'Invoice', field: 'status' }]);
  });
});
