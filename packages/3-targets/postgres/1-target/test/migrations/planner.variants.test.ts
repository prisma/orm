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
          table: spec.table ?? 'tasks',
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
              tasks: new StorageTable({
                columns: {
                  id: int4,
                  type: textColumn,
                  ...Object.assign({}, ...shared.map(columnsOf)),
                },
                primaryKey: { columns: ['id'], name: 'tasks_pk' },
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
                        target: { namespaceId: 'public', tableName: 'tasks', columns: ['id'] },
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
                table: 'tasks',
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

function plan(
  from: Contract<SqlStorage>,
  to: Contract<SqlStorage>,
  statements: readonly ResolvedMigrationStatement[] = [],
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
  if (result.kind !== 'success') {
    throw new Error(`expected a plan, got ${JSON.stringify(result.conflicts)}`);
  }
  return result;
}

function renderedCalls(result: ReturnType<typeof plan>): readonly string[] {
  const rendered = result.plan.renderTypeScript((specifier) => specifier);
  return rendered.split('\n').flatMap((line) => {
    const call = /this\.\w+\(.*\)/.exec(line);
    return call === null ? [] : [call[0]];
  });
}

const bug = { namespaceId: publicId, model: 'Bug' };
const feature = { namespaceId: publicId, model: 'Feature' };
const BUG: VariantSpec = { value: 'bug', fields: { severity: 'severity' } };
const FEATURE: VariantSpec = {
  value: 'feature',
  fields: { priority: 'priority' },
  table: 'features',
};
const origin = tasksContract({ Bug: BUG, Feature: FEATURE }, 'from');
const replaceBug =
  'this.replaceStoredValue({ schema: "public", table: "tasks", column: "type", from: "bug", to: "defect", codecRef: { codecId: "pg/text@1" } })';
const dropOldCheck =
  'this.dropCheckConstraint({ schema: "public", table: "tasks", constraint: "tasks_type_check_from" })';

describe('Postgres planner, variants', () => {
  it('rewrites a changed discriminator value for --convert Bug, between the old check and the new one', () => {
    const convert: ResolvedMigrationStatement = { kind: 'convert', entity: 'model', model: bug };
    const result = plan(
      origin,
      tasksContract({ Bug: { ...BUG, value: 'defect' }, Feature: FEATURE }, 'to'),
      [convert],
    );
    const calls = renderedCalls(result);
    expect(calls.filter((call) => /Check|StoredValue|deleteRows/.test(call))).toEqual([
      dropOldCheck,
      replaceBug,
      expect.stringContaining('this.addCheckConstraint('),
    ]);
    expect(result.appliedStatements).toEqual([
      { statement: convert, operationIndexes: [calls.indexOf(replaceBug)] },
    ]);
    expect(result.dataLoss).toEqual([]);
  });

  it('rewrites the value for --rename Bug:Defect when the value changed', () => {
    const rename: ResolvedMigrationStatement = {
      kind: 'rename',
      entity: 'model',
      from: bug,
      to: { namespaceId: publicId, model: 'Defect' },
    };
    const result = plan(
      origin,
      tasksContract({ Defect: { ...BUG, value: 'defect' }, Feature: FEATURE }, 'to'),
      [rename],
    );
    const calls = renderedCalls(result);
    expect(calls).toContain(replaceBug);
    expect(result.appliedStatements).toEqual([
      { statement: rename, operationIndexes: [calls.indexOf(replaceBug)] },
    ]);
    expect(result.dataLoss).toEqual([]);
  });

  it('plans no row change for a rename whose value did not change', () => {
    const rename: ResolvedMigrationStatement = {
      kind: 'rename',
      entity: 'model',
      from: bug,
      to: { namespaceId: publicId, model: 'Defect' },
    };
    const result = plan(origin, tasksContract({ Defect: BUG, Feature: FEATURE }, 'to'), [rename]);
    expect(renderedCalls(result).filter((call) => /StoredValue|deleteRows/.test(call))).toEqual([]);
  });

  it('deletes the rows of a changed value with no statement, asked about as the variant', () => {
    const result = plan(
      origin,
      tasksContract({ Bug: { ...BUG, value: 'defect' }, Feature: FEATURE }, 'to'),
    );
    const calls = renderedCalls(result);
    const deleteBug =
      'this.deleteRows({ schema: "public", table: "tasks", column: "type", value: "bug", codecRef: { codecId: "pg/text@1" } })';
    expect(calls.filter((call) => /Check|StoredValue|deleteRows/.test(call))).toEqual([
      dropOldCheck,
      deleteBug,
      expect.stringContaining('this.addCheckConstraint('),
    ]);
    expect(result.dataLoss).toEqual([
      expect.objectContaining({
        operationIndex: calls.indexOf(deleteBug),
        subject: { kind: 'model', ...bug },
        loss: 'drop',
      }),
    ]);
  });

  it('drops the table of a removed variant with its own table and deletes its rows, one subject', () => {
    const result = plan(origin, tasksContract({ Bug: BUG }, 'to'));
    const calls = renderedCalls(result);
    expect(calls.filter((call) => /dropTable|deleteRows/.test(call))).toEqual([
      'this.dropTable({ schema: "public", table: "features" })',
      'this.deleteRows({ schema: "public", table: "tasks", column: "type", value: "feature", codecRef: { codecId: "pg/text@1" } })',
    ]);
    expect(result.dataLoss.map(({ subject }) => subject)).toEqual([
      { kind: 'model', ...feature },
      { kind: 'model', ...feature },
    ]);
  });

  it('drops the shared columns of a removed variant and deletes its rows, asked about as the variant', () => {
    const result = plan(origin, tasksContract({ Feature: FEATURE }, 'to'));
    const calls = renderedCalls(result);
    expect(calls.filter((call) => /dropColumn|deleteRows/.test(call))).toEqual([
      'this.dropColumn({ schema: "public", table: "tasks", column: "severity" })',
      'this.deleteRows({ schema: "public", table: "tasks", column: "type", value: "bug", codecRef: { codecId: "pg/text@1" } })',
    ]);
    expect(result.dataLoss.map(({ subject }) => subject)).toEqual([
      { kind: 'model', ...bug },
      { kind: 'model', ...bug },
    ]);
  });

  it('deletes the rows of a removed variant with no columns of its own', () => {
    const result = plan(
      tasksContract({ Bug: { value: 'bug' }, Feature: FEATURE }, 'from'),
      tasksContract({ Feature: FEATURE }, 'to'),
    );
    expect(result.dataLoss).toEqual([
      expect.objectContaining({
        subject: { kind: 'model', ...bug },
        label: 'Delete the rows of "tasks" that hold value "bug" in column "type"',
      }),
    ]);
  });

  it('renames a field of a variant with its own table in that table', () => {
    const rename: ResolvedMigrationStatement = {
      kind: 'rename',
      entity: 'field',
      from: { ...feature, field: 'priority' },
      to: { ...feature, field: 'rank' },
    };
    const result = plan(
      origin,
      tasksContract({ Bug: BUG, Feature: { ...FEATURE, fields: { rank: 'rank' } } }, 'to'),
      [rename],
    );
    expect(renderedCalls(result).filter((call) => /renameColumn/.test(call))).toEqual([
      'this.renameColumn({ schema: "public", table: "features", column: "priority", to: "rank" })',
    ]);
  });
});
