/**
 * Codec lifecycle hook planner — runs `onFieldEvent` for every per-field
 * delta between two contracts and concatenates the returned ops in a
 * deterministic order.
 *
 * Wired by each target's planner (`PostgresMigrationPlanner`,
 * `SqliteMigrationPlanner`) so codec-emitted ops are inlined alongside
 * structural DDL in the app-space migration's `ops.json`. Pure, target-
 * agnostic, and only ever invoked at the app-space emitter; extension-space
 * planning never reaches this helper.
 *
 * Ordering rules (see ADR 213):
 *
 * - Events are grouped by phase: `'added'` → `'dropped'` → `'altered'`.
 * - Within each phase, entries are sorted alphabetically by
 *   `(namespaceId, tableName, fieldName)`.
 * - The hook's returned ops are appended in the order the hook returned them.
 *
 * `'altered'` is suppressed when only `codecId` differs (codec rotation is a
 * v1 non-goal).
 *
 * See: `docs/architecture docs/adrs/ADR 213 - Codec lifecycle hooks.md`.
 */

import type { Contract } from '@internal/contract/types';
import type { OpFactoryCall } from '@internal/framework-components/control';
import { type SqlStorage, type StorageColumn, StorageTable } from '@internal/sql-contract/types';
import type { ResolvedTableRename } from './resolve-table-rename';
import type { CodecControlHooks, FieldEvent, FieldEventContext } from './types';

export interface PlanFieldEventOperationsOptions {
  /**
   * Prior contract the planner is diffing against. `null` for first emits
   * (every field is treated as added).
   */
  readonly priorContract: Contract<SqlStorage> | null;
  /**
   * New contract the user just authored.
   */
  readonly newContract: Contract<SqlStorage>;
  /**
   * Codec-id keyed map of control hooks, as produced by
   * {@link import('./assembly').extractCodecControlHooks}. Hooks carry
   * `unknown` target details after extraction; the caller casts the
   * helper's returned ops to its target's `SqlMigrationPlanOperation`
   * specialisation at the integration boundary, mirroring how
   * `storageTypePlanCallStrategy` lifts `planTypeOperations` results into
   * `RawSqlCall`.
   */
  readonly codecHooks: ReadonlyMap<string, CodecControlHooks>;
  /**
   * The table renames the plan applies. A column under a renamed table's old name is the same
   * column under its new name, so a rename alone fires no event.
   */
  readonly renames: readonly ResolvedTableRename[];
}

interface FieldEntry {
  readonly namespaceId: string;
  readonly tableName: string;
  readonly fieldName: string;
  readonly priorTable: StorageTable | undefined;
  readonly newTable: StorageTable | undefined;
  readonly priorField: StorageColumn | undefined;
  readonly newField: StorageColumn | undefined;
}

export function planFieldEventOperations(
  options: PlanFieldEventOperationsOptions,
): readonly OpFactoryCall[] {
  const priorContract = options.priorContract;
  const newContract = options.newContract;
  const renamedTo = new Map(
    options.renames.map((rename) => [renameKey(rename.namespaceId, rename.from), rename.to]),
  );
  const newNameOf = (namespaceId: string, tableName: string) =>
    renamedTo.get(renameKey(namespaceId, tableName));

  const added: FieldEntry[] = [];
  const dropped: FieldEntry[] = [];
  const altered: FieldEntry[] = [];

  const namespaceIds = unionSorted(
    priorContract ? Object.keys(priorContract.storage.namespaces) : [],
    Object.keys(newContract.storage.namespaces),
  );

  for (const namespaceId of namespaceIds) {
    const priorNs = priorContract?.storage.namespaces[namespaceId];
    const newNs = newContract.storage.namespaces[namespaceId];
    const priorTables = underNewNames(priorNs?.entries.table, (tableName) =>
      newNameOf(namespaceId, tableName),
    );
    const newTables = newNs?.entries.table;

    const tableNames = unionSorted(
      priorTables ? Object.keys(priorTables) : [],
      newTables ? Object.keys(newTables) : [],
    );

    for (const tableName of tableNames) {
      const priorTableRaw = priorTables?.[tableName];
      const newTableRaw = newTables?.[tableName];
      const priorTable = StorageTable.is(priorTableRaw) ? priorTableRaw : undefined;
      const newTable = StorageTable.is(newTableRaw) ? newTableRaw : undefined;
      const fieldNames = unionSorted(
        priorTable ? Object.keys(priorTable.columns) : [],
        newTable ? Object.keys(newTable.columns) : [],
      );
      for (const fieldName of fieldNames) {
        const priorField = priorTable?.columns[fieldName];
        const newField = newTable?.columns[fieldName];
        const entry: FieldEntry = {
          namespaceId,
          tableName,
          fieldName,
          priorTable,
          newTable,
          priorField,
          newField,
        };
        if (priorField === undefined && newField !== undefined) {
          added.push(entry);
        } else if (priorField !== undefined && newField === undefined) {
          dropped.push(entry);
        } else if (priorField !== undefined && newField !== undefined) {
          if (isAlteration(priorField, newField)) altered.push(entry);
        }
      }
    }
  }

  const calls: OpFactoryCall[] = [];
  appendCalls('added', added, options.codecHooks, calls, (e) => e.newField?.codecId);
  appendCalls('dropped', dropped, options.codecHooks, calls, (e) => e.priorField?.codecId);
  appendCalls('altered', altered, options.codecHooks, calls, (e) => e.newField?.codecId);
  return calls;
}

function renameKey(namespaceId: string, tableName: string): string {
  return JSON.stringify([namespaceId, tableName]);
}

function underNewNames<T>(
  tables: Readonly<Record<string, T>> | undefined,
  newNameOf: (tableName: string) => string | undefined,
): Readonly<Record<string, T>> | undefined {
  if (tables === undefined) return undefined;
  return Object.fromEntries(
    Object.entries(tables).map(([tableName, table]) => [newNameOf(tableName) ?? tableName, table]),
  );
}

function appendCalls(
  event: FieldEvent,
  entries: readonly FieldEntry[],
  codecHooks: ReadonlyMap<string, CodecControlHooks>,
  calls: OpFactoryCall[],
  pickCodecId: (entry: FieldEntry) => string | undefined,
): void {
  for (const entry of entries) {
    const codecId = pickCodecId(entry);
    if (codecId === undefined) continue;
    const hook = codecHooks.get(codecId);
    if (!hook?.onFieldEvent) continue;
    const ctx = buildContext(event, entry);
    const emitted = hook.onFieldEvent(event, ctx);
    for (const call of emitted) calls.push(call);
  }
}

/**
 * The context's prior/new sides are scoped to the event:
 *
 * - `'added'`   — only `newTable` / `newField` populated.
 * - `'dropped'` — only `priorTable` / `priorField` populated.
 * - `'altered'` — both sides populated.
 */
function buildContext(event: FieldEvent, entry: FieldEntry): FieldEventContext {
  const base = {
    namespaceId: entry.namespaceId,
    tableName: entry.tableName,
    fieldName: entry.fieldName,
  };
  if (event === 'added') {
    return {
      ...base,
      ...(entry.newTable !== undefined ? { newTable: entry.newTable } : {}),
      ...(entry.newField !== undefined ? { newField: entry.newField } : {}),
    };
  }
  if (event === 'dropped') {
    return {
      ...base,
      ...(entry.priorTable !== undefined ? { priorTable: entry.priorTable } : {}),
      ...(entry.priorField !== undefined ? { priorField: entry.priorField } : {}),
    };
  }
  return {
    ...base,
    ...(entry.priorTable !== undefined ? { priorTable: entry.priorTable } : {}),
    ...(entry.newTable !== undefined ? { newTable: entry.newTable } : {}),
    ...(entry.priorField !== undefined ? { priorField: entry.priorField } : {}),
    ...(entry.newField !== undefined ? { newField: entry.newField } : {}),
  };
}

/**
 * `'altered'` predicate. Returns `false` whenever `codecId` differs —
 * any codec change suppresses the `altered` event entirely, including
 * cases where another property also differs in the same diff. Codec
 * rotation is a v1 non-goal; avoiding the mixed event keeps the
 * migration semantics for codec changes explicit rather than smuggling
 * them through as `altered`.
 *
 * For non-`codecId` diffs, returns `true` iff any other column property
 * differs.
 */
function isAlteration(prior: StorageColumn, current: StorageColumn): boolean {
  if (prior.codecId !== current.codecId) return false;
  return !sameStorageColumn(prior, current);
}

function sameStorageColumn(a: StorageColumn, b: StorageColumn): boolean {
  if (a === b) return true;
  if (a.nativeType !== b.nativeType) return false;
  if (a.nullable !== b.nullable) return false;
  if (a.typeRef !== b.typeRef) return false;
  if (!sameJson(a.typeParams, b.typeParams)) return false;
  if (!sameJson(a.default, b.default)) return false;
  return true;
}

function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function unionSorted(a: readonly string[], b: readonly string[]): readonly string[] {
  const set = new Set<string>();
  for (const name of a) set.add(name);
  for (const name of b) set.add(name);
  return [...set].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
}
