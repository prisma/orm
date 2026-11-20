import { createHash } from 'node:crypto';
import {
  asNamespaceId,
  type Contract,
  type ContractModelBase,
  coreHash,
  profileHash,
} from '@internal/contract/types';
import {
  APP_SPACE_ID,
  type MigrationOperationPolicy,
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

const ALL_CLASSES: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

const publicId = asNamespaceId('public');
const int4 = { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false };
const textColumn = { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false };
const int4Type = { kind: 'scalar', codecId: 'pg/int4@1' } as const;
const textType = { kind: 'scalar', codecId: 'pg/text@1' } as const;

/** How a variant of `Task` is stored: in `tasks` with its own columns, or in a table of its own. */
interface VariantSpec {
  readonly value: string;
  readonly fields?: Readonly<Record<string, string>>;
  readonly table?: string;
}

/** `Task`, in table `tasks` discriminated by `type`, with the variants of `variants`, keyed by model name. */
function tasksContract(
  baseTable: string,
  variants: Readonly<Record<string, VariantSpec>>,
  seed: string,
): Contract<SqlStorage> {
  const shared = Object.values(variants).filter(({ table }) => table === undefined);
  const ownTables = Object.values(variants).filter(
    (spec): spec is VariantSpec & { readonly table: string } => spec.table !== undefined,
  );
  const columnsOf = (spec: VariantSpec) =>
    Object.fromEntries(
      Object.values(spec.fields ?? {}).map((column) => [column, { ...textColumn, nullable: true }]),
    );
  const values = Object.values(variants)
    .map(({ value }) => `'${value}'`)
    .sort();
  const variantModels: Record<string, ContractModelBase> = Object.fromEntries(
    Object.entries(variants).map(([model, spec]) => [
      model,
      {
        fields: Object.fromEntries(
          Object.keys(spec.fields ?? {}).map((field) => [
            field,
            { nullable: true, type: textType },
          ]),
        ),
        relations: {},
        base: { namespace: publicId, model: 'Task' },
        storage: {
          table: spec.table ?? baseTable,
          namespaceId: 'public',
          fields: Object.fromEntries(
            Object.entries(spec.fields ?? {}).map(([field, column]) => [field, { column }]),
          ),
        },
      },
    ]),
  );
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash(seed),
    storage: new SqlStorage({
      storageHash: coreHash(createHash('sha256').update(seed).digest('hex')),
      namespaces: {
        public: postgresCreateNamespace({
          id: 'public',
          entries: {
            table: {
              [baseTable]: new StorageTable({
                columns: {
                  id: int4,
                  type: textColumn,
                  ...Object.assign({}, ...shared.map(columnsOf)),
                },
                primaryKey: { columns: ['id'], name: `${baseTable}_pk` },
                uniques: [],
                indexes: [],
                foreignKeys: [],
                checks: [
                  {
                    naming: { kind: 'exact', name: `tasks_type_check_${seed}` },
                    expression: `"type" IN (${values.join(', ')})`,
                  },
                ],
              }),
              ...Object.fromEntries(
                ownTables.map((spec) => [
                  spec.table,
                  new StorageTable({
                    columns: { id: int4, ...columnsOf(spec) },
                    primaryKey: { columns: ['id'], name: `${spec.table}_pk` },
                    uniques: [],
                    indexes: [],
                    foreignKeys: [
                      {
                        source: { namespaceId: 'public', tableName: spec.table, columns: ['id'] },
                        target: { namespaceId: 'public', tableName: baseTable, columns: ['id'] },
                        onDelete: 'cascade',
                        index: { primaryKey: true },
                      },
                    ],
                  }),
                ]),
              ),
            },
          },
        }),
      },
    }),
    roots: {},
    domain: {
      namespaces: {
        public: {
          models: {
            Task: {
              fields: {
                id: { nullable: false, type: int4Type },
                type: { nullable: false, type: textType },
              },
              relations: {},
              discriminator: { field: 'type' },
              variants: Object.fromEntries(
                Object.entries(variants).map(([model, { value }]) => [
                  value,
                  { namespace: publicId, model },
                ]),
              ),
              storage: {
                table: baseTable,
                namespaceId: 'public',
                fields: { id: { column: 'id' }, type: { column: 'type' } },
              },
            },
            ...variantModels,
          },
        },
      },
    },
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

function planWith(
  from: Contract<SqlStorage>,
  to: Contract<SqlStorage>,
  statements: readonly ResolvedMigrationStatement[],
) {
  return createPostgresMigrationPlanner(stubLowerer).plan({
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
}

function plan(from: Contract<SqlStorage>, to: Contract<SqlStorage>) {
  const result = planWith(from, to, []);
  if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
  return result;
}

async function labelsOf(result: ReturnType<typeof plan>): Promise<readonly string[]> {
  return (await Promise.all(result.plan.operations)).map((op) => op.label);
}

const bug: VariantSpec = { value: 'bug', fields: { severity: 'severity' } };
const story: VariantSpec = { value: 'story', fields: { points: 'points' } };
const feature: VariantSpec = {
  value: 'feature',
  fields: { priority: 'priority' },
  table: 'features',
};

describe('Postgres planner, the table of a base and its variants', () => {
  it('renames the table of a base whose single-table variant is removed, and asks about the variant', async () => {
    const result = plan(
      tasksContract('tasks', { Bug: bug, Story: story }, 'a'),
      tasksContract('work', { Story: story }, 'b'),
    );
    expect(await labelsOf(result)).toEqual([
      'Rename table "tasks" to "work"',
      'Rename primary key "tasks_pk" to "work_pk" on "work"',
      'Drop check constraint "tasks_type_check_a" on "work"',
      'Drop column "severity" from "work"',
      'Delete the rows of "work" that hold value "bug" in column "type"',
      'Add check constraint "tasks_type_check_b" on "work"',
    ]);
    expect(
      result.dataLoss.map(({ operationIndex, subject }) => ({ operationIndex, subject })),
    ).toEqual([
      { operationIndex: 3, subject: { kind: 'model', namespaceId: publicId, model: 'Bug' } },
      { operationIndex: 4, subject: { kind: 'model', namespaceId: publicId, model: 'Bug' } },
    ]);
  });

  it("renames no table when a variant's own table joins its base's table as the base's table is renamed", async () => {
    const result = plan(
      tasksContract('tasks', { Feature: feature }, 'a'),
      tasksContract('work', { Feature: { ...feature, table: 'work' } }, 'b'),
    );
    expect(await labelsOf(result)).toEqual([
      'Drop table "features"',
      'Drop table "tasks"',
      'Create table "work"',
      'Add foreign key "work_id_fkey" on "work"',
    ]);
  });

  it('refuses a model rename statement that would move the rows of the base out of its table, and plans the change without it', async () => {
    const from = tasksContract('tasks', { Bug: bug }, 'a');
    const to = tasksContract('tasks', { Defect: { ...bug, table: 'defects' } }, 'b');
    const statement: ResolvedMigrationStatement = {
      kind: 'rename',
      entity: 'model',
      from: { namespaceId: publicId, model: 'Bug' },
      to: { namespaceId: publicId, model: 'Defect' },
    };

    const refused = planWith(from, to, [statement]);
    expect(refused.kind === 'failure' && refused.conflicts).toEqual([
      {
        kind: 'statementRefused',
        summary:
          'Cannot rename table "tasks" to "defects": table "tasks" also stores model "public.Task"',
        why: 'A table rename moves every row of the table, and the rows of model "public.Task" do not move to table "defects". Moving the rows of one model out of a table it shares with others is a data migration, which a plan does not write. Leave out this --rename to plan the change without moving them: the command then stops and says what the change would delete. If it offers this same --rename for model "public.Bug", that is refused again for the same reason; give --delete for model "public.Bug" in its place, which plans the change and deletes the data. To keep the data with migration plan, write this change as a hand-written migration instead: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the rows of model "public.Bug" into table "defects" yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.',
        refusedStatement: statement,
        location: { namespaceId: 'public', entityKind: 'table', entityName: 'tasks' },
      },
    ]);

    const without = plan(from, to);
    expect(await labelsOf(without)).toEqual([
      'Drop check constraint "tasks_type_check_a" on "tasks"',
      'Drop column "severity" from "tasks"',
      'Create table "defects"',
      'Delete the rows of "tasks" that hold value "bug" in column "type"',
      'Add check constraint "tasks_type_check_b" on "tasks"',
      'Add foreign key "defects_id_fkey" on "defects"',
    ]);
    expect(
      without.dataLoss.map(({ operationIndex, subject }) => ({ operationIndex, subject })),
    ).toEqual([
      { operationIndex: 1, subject: { kind: 'model', namespaceId: publicId, model: 'Bug' } },
      { operationIndex: 3, subject: { kind: 'model', namespaceId: publicId, model: 'Bug' } },
    ]);
  });
});
