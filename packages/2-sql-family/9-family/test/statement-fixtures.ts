import {
  asNamespaceId,
  type Contract,
  type ContractModelBase,
  type ControlPolicy,
  crossRef,
  profileHash,
  type StorageHashBase,
} from '@internal/contract/types';
import type {
  MigrationOperationClass,
  ResolvedFieldBackfillStatement,
  ResolvedFieldConvertStatement,
  ResolvedFieldRenameStatement,
  ResolvedModelRenameStatement,
  ResolvedNamespaceRenameStatement,
} from '@internal/framework-components/control';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import type { ColumnRename } from '../src/core/migrations/resolve-column-rename';
import type { TableRename } from '../src/core/migrations/resolve-table-rename';
import type { SchemaTables } from '../src/core/migrations/schema-tables';
import type {
  CallWithCompanions,
  NamespaceRename,
  planStatements,
  StatementPlanningTarget,
  TableMove,
} from '../src/core/migrations/statement-planning';

export interface ModelSpec {
  /** `null` for a model the contract stores in no table. */
  readonly table: string | null;
  readonly namespace?: string;
  readonly control?: ControlPolicy;
  /** Field name to column name; `null` for a relation field, which has no column. */
  readonly fields?: Readonly<Record<string, string | null>>;
  /** The model this one is a variant of, in the same namespace. */
  readonly base?: string;
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
    ...(spec.base === undefined ? {} : { base: crossRef(spec.base, namespaceId) }),
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
  fromNs = 'app',
  toNs = fromNs,
): ResolvedFieldRenameStatement {
  return {
    kind: 'rename',
    entity: 'field',
    from: { namespaceId: asNamespaceId(fromNs), model, field: from },
    to: { namespaceId: asNamespaceId(toNs), model: newModel, field: to },
  };
}

export function convertField(model: string, field: string): ResolvedFieldConvertStatement {
  return {
    kind: 'convert',
    entity: 'field',
    field: { namespaceId: asNamespaceId('app'), model, field },
  };
}

export function backfillField(
  model: string,
  field: string,
  namespace = 'app',
): ResolvedFieldBackfillStatement {
  return {
    kind: 'backfill',
    entity: 'field',
    field: { namespaceId: asNamespaceId(namespace), model, field },
  };
}

/** A fake target's call: its text names the rename or move, and a rename carries one companion. */
export interface FakeCall extends CallWithCompanions {
  readonly text: string;
}

/**
 * A target whose calls carry a text naming the rename and one companion, and whose working schema
 * maps each qualified table name to its columns. Every operation has the first of
 * `operationClasses`. `namespaces` lists the namespaces the working schema has; when it is left
 * out, it has every namespace, and a move creates none.
 */
export function fakeTarget(
  initial: readonly string[],
  columns: Readonly<Record<string, readonly string[]>> = {},
  operationClasses: readonly MigrationOperationClass[] = ['widening'],
  sameName: (left: string, right: string) => boolean = (left, right) => left === right,
  namespaces?: readonly string[],
): StatementPlanningTarget<FakeCall> {
  const tables = new Map(initial.map((table) => [table, new Set(columns[table] ?? [])]));
  const existingNamespaces = namespaces === undefined ? undefined : new Set(namespaces);
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
    hasNamespace: (namespaceId) =>
      existingNamespaces?.has(namespaceId) ??
      [...tables.keys()].some((key) => key.startsWith(`${namespaceId}.`)),
  };
  const operationClass = operationClasses[0] ?? 'widening';
  const call = (text: string): FakeCall => ({
    text,
    operationClass,
    companions: [{ operationClass }],
  });
  return {
    tables: () => schemaTables,
    namespaces: {
      createNamespaceCalls: (namespaceId: string) =>
        existingNamespaces === undefined || existingNamespaces.has(namespaceId)
          ? []
          : [{ text: `namespace ${namespaceId}`, operationClass: 'additive', companions: [] }],
      namespaceRenameRefusal: () => undefined,
      renameNamespaceCall: (rename: NamespaceRename) => ({
        text: `rename-namespace ${rename.from} -> ${rename.to}`,
        operationClass,
        companions: [],
      }),
      moveTableCall: (move: TableMove) => ({
        text: `move ${move.from}.${move.table} -> ${move.to}`,
        operationClass,
        companions: [],
      }),
    },
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
      if (kind === 'namespace' && from !== undefined) {
        existingNamespaces?.add(from);
        return;
      }
      if (kind === 'rename-namespace' && from !== undefined && to !== undefined) {
        for (const [key, existing] of [...tables.entries()]) {
          if (!key.startsWith(`${from}.`)) continue;
          tables.delete(key);
          tables.set(`${to}.${key.slice(from.length + 1)}`, existing);
        }
        existingNamespaces?.delete(from);
        existingNamespaces?.add(to);
        return;
      }
      if (kind === 'move' && from !== undefined && to !== undefined) {
        const [, table] = from.split('.');
        const existing = tables.get(from) ?? new Set<string>();
        tables.delete(from);
        tables.set(`${to}.${table}`, existing);
        return;
      }
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

/** `target` as one of a database without namespaces. */
export function withoutNamespaces(
  target: StatementPlanningTarget<FakeCall>,
): StatementPlanningTarget<FakeCall> {
  return { ...target, namespaces: undefined };
}

/** `target`, refusing every namespace rename with `refusal`. */
export function refusingNamespaceRenames(
  target: StatementPlanningTarget<FakeCall>,
  refusal: { readonly reason: string; readonly fix: string },
): StatementPlanningTarget<FakeCall> {
  const { namespaces } = target;
  if (namespaces === undefined) return target;
  return { ...target, namespaces: { ...namespaces, namespaceRenameRefusal: () => refusal } };
}

export function renameNamespace(from: string, to: string): ResolvedNamespaceRenameStatement {
  return {
    kind: 'rename',
    entity: 'namespace',
    from: asNamespaceId(from),
    to: asNamespaceId(to),
  };
}

/** The planned statements, with each call given by its text. */
export function planned(result: ReturnType<typeof planStatements<FakeCall>>) {
  if (!result.ok) throw new Error(`expected a plan, got: ${result.failure.summary}`);
  const { origins: _origins, ...value } = result.value;
  return { ...value, calls: value.calls.map((call) => call.text) };
}

export function rejection(result: ReturnType<typeof planStatements<FakeCall>>) {
  if (result.ok) throw new Error('expected a rejection');
  return result.failure;
}

export const ALL_CLASSES = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
};
