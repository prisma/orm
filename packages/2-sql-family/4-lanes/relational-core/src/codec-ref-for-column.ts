import type { JsonValue } from '@internal/contract/types';
import type { CodecRef } from '@internal/framework-components/codec';
import { resolveStorageTable } from '@internal/sql-contract/resolve-storage-table';
import { nonEmptyTypeParams, type SqlStorage } from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';

/**
 * Derive the canonical {@link CodecRef} for a `(table, column)` pair against a {@link SqlStorage}. This is the build-time path every column-bound `ParamRef` / `ProjectionItem` uses to stamp its `codec` slot before the AST is handed to the runtime — the runtime resolver then materialises a memoised {@link import('@internal/sql-relational-core/ast').Codec} for the same `CodecRef` via `forCodecRef`.
 *
 * Resolution rules over namespace `entries.table[table].columns[column]`:
 *
 * - `typeParams` column → `{codecId, typeParams}` from the column itself.
 * - non-parameterized column → `{codecId}` with `typeParams` undefined.
 *
 * Returns `undefined` when the table or column is unknown.
 *
 * `namespaceId` leads the coordinate args and is always supplied: every
 * model/table sits in an explicit namespace, so the table is resolved strictly
 * within that namespace (see {@link resolveStorageTable}).
 */
export function codecRefForStorageColumn(
  storage: SqlStorage,
  namespaceId: string,
  tableName: string,
  columnName: string,
): CodecRef | undefined {
  const resolved = resolveStorageTable(storage, tableName, namespaceId);
  if (resolved === undefined) return undefined;
  const tableDef = resolved.table;
  const columnDef = tableDef.columns[columnName];
  if (!columnDef) return undefined;
  const typeParams = nonEmptyTypeParams(columnDef.typeParams);
  const params =
    typeParams === undefined
      ? {}
      : {
          typeParams: blindCast<
            JsonValue,
            'column typeParams is a validated contract record; its values are JSON-serialisable'
          >(typeParams),
        };
  return columnDef.many
    ? { codecId: columnDef.codecId, ...params, many: true }
    : { codecId: columnDef.codecId, ...params };
}
