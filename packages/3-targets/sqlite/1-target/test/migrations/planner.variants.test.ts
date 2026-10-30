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
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { sqliteContractToSchema } from '../../src/core/migrations/diff-database-schema';
import { createSqliteMigrationPlanner } from '../../src/core/migrations/planner';
import { sqliteCreateNamespace } from '../../src/core/sqlite-unbound-database';
import { sqliteTestComponents, sqliteTestTypes } from '../sqlite-test-types';
import { stubLowerer } from './rename-table-fixtures';

const ALL_CLASSES: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

const publicId = asNamespaceId(UNBOUND_NAMESPACE_ID);
const int4 = { dataType: 'sqlite/integer', codecId: 'sqlite/integer@1', nullable: false };
const textColumn = { dataType: 'sqlite/text', codecId: 'sqlite/text@1', nullable: false };
const int4Type = { kind: 'scalar', codecId: 'sqlite/integer@1' } as const;
const textType = { kind: 'scalar', codecId: 'sqlite/text@1' } as const;

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
          namespaceId: UNBOUND_NAMESPACE_ID,
          fields: Object.fromEntries(
            Object.entries(spec.fields ?? {}).map(([field, column]) => [field, { column }]),
          ),
        },
      },
    ]),
  );
  return {
    target: 'sqlite',
    targetFamily: 'sql',
    profileHash: profileHash(seed),
    storage: new SqlStorage({
      storageHash: coreHash(createHash('sha256').update(seed).digest('hex')),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: sqliteCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              tasks: new StorageTable({
                columns: {
                  id: int4,
                  type: textColumn,
                  ...Object.assign({}, ...shared.map(columnsOf)),
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              }),
              ...Object.fromEntries(
                ownTables.map((spec) => [
                  spec.table,
                  new StorageTable({
                    columns: { id: int4, ...columnsOf(spec) },
                    primaryKey: { columns: ['id'] },
                    uniques: [],
                    indexes: [],
                    foreignKeys: [
                      {
                        source: {
                          namespaceId: UNBOUND_NAMESPACE_ID,
                          tableName: spec.table,
                          columns: ['id'],
                        },
                        target: {
                          namespaceId: UNBOUND_NAMESPACE_ID,
                          tableName: 'tasks',
                          columns: ['id'],
                        },
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
        [UNBOUND_NAMESPACE_ID]: {
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
                namespaceId: UNBOUND_NAMESPACE_ID,
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
  const result = createSqliteMigrationPlanner(stubLowerer).plan({
    contract: to,
    schema: sqliteContractToSchema(from, sqliteTestTypes),
    policy: ALL_CLASSES,
    fromContract: from,
    origin: planOriginOf(from),
    statements,
    frameworkComponents: sqliteTestComponents,
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
  'this.replaceStoredValue({ table: "tasks", column: "type", from: "bug", to: "defect", codecRef: { codecId: "sqlite/text@1" } })';

describe('SQLite planner, variants', () => {
  it('rewrites a changed discriminator value for --convert Bug, after the diff', () => {
    const convert: ResolvedMigrationStatement = { kind: 'convert', entity: 'model', model: bug };
    const result = plan(
      origin,
      tasksContract({ Bug: { ...BUG, value: 'defect' }, Feature: FEATURE }, 'to'),
      [convert],
    );
    const calls = renderedCalls(result);
    expect(calls.at(-1)).toBe(replaceBug);
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
      'this.deleteRows({ table: "tasks", column: "type", value: "bug", codecRef: { codecId: "sqlite/text@1" } })';
    expect(calls.at(-1)).toBe(deleteBug);
    expect(result.dataLoss).toEqual([
      expect.objectContaining({
        operationIndex: calls.indexOf(deleteBug),
        subject: { kind: 'model', ...bug },
        loss: 'drop',
        keepDataAdvice:
          'SQLite migrations run with foreign keys off, so deleting these rows does not delete the rows of other tables that reference them: the apply then fails at PRAGMA foreign_key_check. Delete or change those rows first.',
      }),
    ]);
  });

  it("deletes the rows of a changed value of a variant with its own table, naming that table as its foreign key's cascade", async () => {
    const result = plan(
      origin,
      tasksContract({ Bug: BUG, Feature: { ...FEATURE, value: 'story' } }, 'to'),
    );
    const deleteFeature =
      'this.deleteRows({ table: "tasks", column: "type", value: "feature", codecRef: { codecId: "sqlite/text@1" }, cascade: [{ table: "features", columns: ["id"], references: ["id"] }] })';
    expect(renderedCalls(result).at(-1)).toBe(deleteFeature);
    const operations = await Promise.all(result.plan.operations);
    expect(operations.at(-1)?.execute.map(({ sql }) => sql)).toEqual([
      'DELETE FROM "features" WHERE EXISTS (SELECT 1 FROM "tasks" WHERE "tasks"."type" = ?1 AND "tasks"."id" = "features"."id")',
      'DELETE FROM "tasks" WHERE "type" = ?1',
    ]);
  });

  it('drops the table of a removed variant with its own table and deletes its rows, one subject', () => {
    const result = plan(origin, tasksContract({ Bug: BUG }, 'to'));
    const calls = renderedCalls(result);
    expect(calls.filter((call) => /dropTable|deleteRows/.test(call))).toEqual([
      'this.dropTable({ table: "features" })',
      'this.deleteRows({ table: "tasks", column: "type", value: "feature", codecRef: { codecId: "sqlite/text@1" } })',
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
      'this.dropColumn({ table: "tasks", column: "severity" })',
      'this.deleteRows({ table: "tasks", column: "type", value: "bug", codecRef: { codecId: "sqlite/text@1" } })',
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
      'this.renameColumn({ table: "features", column: "priority", to: "rank" })',
    ]);
  });
});
