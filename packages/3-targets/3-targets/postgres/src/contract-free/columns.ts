import {
  type ColumnDescriptor,
  type ColumnSchema,
  type TableHandle,
  table,
} from '@internal/sql-relational-core/contract-free';
import { PostgresTableSource } from '../core/ast/table-source';
import {
  PG_INT4_CODEC_ID,
  PG_INT8_CODEC_ID,
  PG_JSONB_CODEC_ID,
  PG_TEXT_ARRAY_CODEC_ID,
  PG_TEXT_CODEC_ID,
  PG_TIMESTAMPTZ_STRING_CODEC_ID,
} from '../core/codec-ids';

type ColOpts = { readonly nullable?: boolean };

const desc = (codecId: string, opts?: ColOpts): ColumnDescriptor => ({
  codecId,
  nullable: opts?.nullable ?? false,
});

export const text = (opts?: ColOpts): ColumnDescriptor => desc(PG_TEXT_CODEC_ID, opts);
export const int4 = (opts?: ColOpts): ColumnDescriptor => desc(PG_INT4_CODEC_ID, opts);
export const int8 = (opts?: ColOpts): ColumnDescriptor => desc(PG_INT8_CODEC_ID, opts);
export const jsonb = (opts?: ColOpts): ColumnDescriptor => desc(PG_JSONB_CODEC_ID, opts);
export const textArray = (opts?: ColOpts): ColumnDescriptor => desc(PG_TEXT_ARRAY_CODEC_ID, opts);
/**
 * Control-plane tables are read by Prisma's own tooling, which has to run wherever the user's Node
 * runs — so this declares the string representation rather than the Temporal one. Nothing here needs
 * a `Temporal` global, and a marker or migration row that cannot be read on a stock runtime would
 * break `migrate` rather than a user's query.
 */
export const timestamptz = (opts?: ColOpts): ColumnDescriptor =>
  desc(PG_TIMESTAMPTZ_STRING_CODEC_ID, opts);

/**
 * Declare a PostgreSQL control-plane table with a typed column schema. Wraps
 * the generic `table()` factory with a `PostgresTableSource` so the renderer
 * qualifies the table name with the optional schema prefix.
 *
 * ```ts
 * const marker = pgTable(
 *   { name: 'marker', schema: 'prisma_contract' },
 *   { space: text(), core_hash: text(), updated_at: timestamptz() },
 * );
 * ```
 */
export function pgTable<Schema extends ColumnSchema>(
  source: { readonly name: string; readonly schema?: string; readonly alias?: string },
  columns: Schema,
): TableHandle<Schema> {
  return table(new PostgresTableSource(source), columns);
}
