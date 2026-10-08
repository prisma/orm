import {
  asNamespaceId,
  type Contract,
  type ContractModelBase,
  type ControlPolicy,
  profileHash,
  type StorageHashBase,
} from '@internal/contract/types';
import type {
  MigrationOperationClass,
  ResolvedFieldRenameStatement,
  ResolvedModelRenameStatement,
} from '@internal/framework-components/control';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import type { ColumnRename } from '../src/core/migrations/resolve-column-rename';
import type { TableRename } from '../src/core/migrations/resolve-table-rename';
import type { SchemaTables } from '../src/core/migrations/schema-tables';
import type {
  CallWithCompanions,
  planStatements,
  StatementPlanningTarget,
} from '../src/core/migrations/statement-planning';

export interface ModelSpec {
  /** `null` for a model the contract stores in no table. */
  readonly table: string | null;
  readonly namespace?: string;
  readonly control?: ControlPolicy;
  /** Field name to column name; `null` for a relation field, which has no column. */
  readonly fields?: Readonly<Record<string, string | null>>;
}

const text = { dataType: 'test/text', codecId: 'test/text@1', nullable: false };

function model(namespaceId: string, spec: ModelSpec): ContractModelBase {
  const fields = Object.entries(spec.fields ?? {});
  const columns = fields.flatMap(([field, column]) =>
    column === null ? [] : [[field, column] as const],
  );
  return {
    fields: Object.fromEntries(
      columns.map(([field]) => [
        field,
        { nullable: false, type: { kind: 'scalar', codecId: 'test/text@1' } },
      ]),
    ),
    relations: Object.fromEntries(
      fields
        .filter(([, column]) => column === null)
        .map(([field]) => [
          field,
          {
            to: { namespace: asNamespaceId(namespaceId), model: 'Other' },
            cardinality: '1:N',
            on: { localFields: ['id'], targetFields: ['ownerId'] },
          },
        ]),
    ),
    storage:
      spec.table === null
        ? {}
        : {
            table: spec.table,
            namespaceId,
            fields: Object.fromEntries(columns.map(([field, column]) => [field, { column }])),
          },
  };
}

export function contractOf(models: Record<string, ModelSpec>): Contract<SqlStorage> {
  const namespaceIds = [...new Set(Object.values(models).map((spec) => spec.namespace ?? 'app'))];
  const inNamespace = (id: string) =>
    Object.entries(models).filter(([, spec]) => (spec.namespace ?? 'app') === id);
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('test'),
    storage: new SqlStorage({
      storageHash: 'test' as StorageHashBase<string>,
      namespaces: Object.fromEntries(
        namespaceIds.map((id) => [
          id,
          createTestSqlNamespace({
            id,
            entries: {
              table: Object.fromEntries(
                inNamespace(id)
                  .flatMap(([, spec]) => (spec.table === null ? [] : [spec]))
                  .map((spec) => [
                    spec.table,
                    new StorageTable({
                      columns: Object.fromEntries(
                        Object.values(spec.fields ?? {}).flatMap((column) =>
                          column === null ? [] : [[column, text]],
                        ),
                      ),
                      uniques: [],
                      indexes: [],
                      foreignKeys: [],
                      ...(spec.control === undefined ? {} : { control: spec.control }),
                    }),
                  ]),
              ),
            },
          }),
        ]),
      ),
    }),
    domain: {
      namespaces: Object.fromEntries(
        namespaceIds.map((id) => [
          id,
          {
            models: Object.fromEntries(
              inNamespace(id).map(([name, spec]) => [name, model(id, spec)]),
            ),
          },
        ]),
      ),
    },
    roots: {},
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

export function renameModel(
  from: string,
  to: string,
  fromNs = 'app',
  toNs = fromNs,
): ResolvedModelRenameStatement {
  return {
    kind: 'rename',
    entity: 'model',
    from: { namespaceId: asNamespaceId(fromNs), model: from },
    to: { namespaceId: asNamespaceId(toNs), model: to },
  };
}

export function renameField(
  model: string,
  from: string,
  to: string,
  newModel = model,
): ResolvedFieldRenameStatement {
  return {
    kind: 'rename',
    entity: 'field',
    from: { namespaceId: asNamespaceId('app'), model, field: from },
    to: { namespaceId: asNamespaceId('app'), model: newModel, field: to },
  };
}

/** A fake target's call: its text names the rename, and it carries one companion. */
export interface FakeCall extends CallWithCompanions {
  readonly text: string;
}

/**
 * A target whose calls carry a text naming the rename and one companion, and whose working schema
 * maps each qualified table name to its columns. Every operation has the first of
 * `operationClasses`.
 */
export function fakeTarget(
  initial: readonly string[],
  columns: Readonly<Record<string, readonly string[]>> = {},
  operationClasses: readonly MigrationOperationClass[] = ['widening'],
  sameName: (left: string, right: string) => boolean = (left, right) => left === right,
): StatementPlanningTarget<FakeCall> {
  const tables = new Map(initial.map((table) => [table, new Set(columns[table] ?? [])]));
  const schemaTables: SchemaTables = {
    hasTable: (namespaceId, table) => tables.has(`${namespaceId}.${table}`),
    hasColumn: (namespaceId, table, column) =>
      tables.get(`${namespaceId}.${table}`)?.has(column) === true,
    tablesNamed: (namespaceId, table) =>
      [...tables.keys()]
        .filter((key) => key.startsWith(`${namespaceId}.`))
        .map((key) => key.slice(namespaceId.length + 1))
        .filter((existing) => sameName(existing, table)),
    columnsNamed: (namespaceId, table, column) =>
      [...(tables.get(`${namespaceId}.${table}`) ?? [])].filter((existing) =>
        sameName(existing, column),
      ),
    namespacesWithTable: () => [],
  };
  const operationClass = operationClasses[0] ?? 'widening';
  const call = (text: string): FakeCall => ({
    text,
    operationClass,
    companions: [{ operationClass }],
  });
  return {
    tables: () => schemaTables,
    renameTableCall: (rename: TableRename) =>
      call(`table ${rename.namespaceId}.${rename.from} -> ${rename.to}`),
    renameColumnCall: (rename: ColumnRename) =>
      call(`column ${rename.namespaceId}.${rename.table}.${rename.from} -> ${rename.to}`),
    renderTableRename: (rename: TableRename) =>
      `renameTable ${rename.namespaceId}.${rename.from} -> ${rename.to}`,
    tableRenameByHand: (rename: TableRename) => [
      `RENAME ${rename.namespaceId}.${rename.from} TO ${rename.to}`,
    ],
    apply: ({ text }) => {
      const [kind, from, , to] = text.split(' ');
      if (from === undefined || to === undefined) return;
      const parts = from.split('.');
      if (kind === 'table') {
        const [namespaceId] = parts;
        const existing = tables.get(from) ?? new Set<string>();
        tables.delete(from);
        tables.set(`${namespaceId}.${to}`, existing);
        return;
      }
      const [namespaceId, table, column] = parts;
      const existing = tables.get(`${namespaceId}.${table}`);
      existing?.delete(column ?? '');
      existing?.add(to);
    },
  };
}

/** The planned statements, with each call given by its text. */
export function planned(result: ReturnType<typeof planStatements<FakeCall>>) {
  if (!result.ok) throw new Error(`expected a plan, got: ${result.failure.summary}`);
  return { ...result.value, calls: result.value.calls.map((call) => call.text) };
}

export function rejection(result: ReturnType<typeof planStatements<FakeCall>>) {
  if (result.ok) throw new Error('expected a rejection');
  return result.failure;
}

export const ALL_CLASSES = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
};
