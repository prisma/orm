import { TableSource } from '@internal/sql-relational-core/ast';
import {
  type ColumnDescriptor,
  type ColumnSchema,
  type TableHandle,
  table,
} from '@internal/sql-relational-core/contract-free';
import {
  SQLITE_DATETIME_CODEC_ID,
  SQLITE_INTEGER_CODEC_ID,
  SQLITE_JSON_CODEC_ID,
  SQLITE_TEXT_CODEC_ID,
} from '../core/codec-ids';

type ColOpts = { readonly nullable?: boolean };

const desc = (codecId: string, opts?: ColOpts): ColumnDescriptor => ({
  codecId,
  nullable: opts?.nullable ?? false,
});

export const text = (opts?: ColOpts): ColumnDescriptor => desc(SQLITE_TEXT_CODEC_ID, opts);
export const integer = (opts?: ColOpts): ColumnDescriptor => desc(SQLITE_INTEGER_CODEC_ID, opts);
export const jsonText = (opts?: ColOpts): ColumnDescriptor => desc(SQLITE_JSON_CODEC_ID, opts);
export const datetime = (opts?: ColOpts): ColumnDescriptor => desc(SQLITE_DATETIME_CODEC_ID, opts);

/**
 * Declare a SQLite control-plane table with a typed column schema. SQLite tables
 * are addressed by a flat name (no schema prefix).
 *
 * ```ts
 * const marker = sqliteTable('_prisma_marker', {
 *   space:     text(),
 *   core_hash: text(),
 *   updated_at: datetime(),
 * });
 * ```
 */
export function sqliteTable<Schema extends ColumnSchema>(
  name: string,
  columns: Schema,
): TableHandle<Schema> {
  return table(TableSource.named(name), columns);
}
