import { jsonToTsSource } from '@internal/ts-render';
import type { SqlTextSources } from './sql-text-sources';

/**
 * SQL a planned call writes into a statement: written SQL, or a placeholder slot the user fills in
 * `migration.ts`. While a slot is unfilled, the call lowers to no operation.
 */
export type SqlSlot =
  | { readonly kind: 'sql'; readonly sql: string }
  | { readonly kind: 'placeholder'; readonly slot: string };

/** Whether `slot` is a placeholder the user has not filled yet. */
export function isUnfilledSlot(
  slot: SqlSlot | undefined,
): slot is Extract<SqlSlot, { readonly kind: 'placeholder' }> {
  return slot?.kind === 'placeholder';
}

/** The SQL of a written slot; undefined for an unfilled one or none. */
export function sqlOfSlot(slot: SqlSlot | undefined): string | undefined {
  return slot?.kind === 'sql' ? slot.sql : undefined;
}

/** The slot as `migration.ts` writes it: SQL text written through `sql`, or a `placeholder(...)` call. */
export function slotSource(slot: SqlSlot, sql: SqlTextSources): string {
  return slot.kind === 'placeholder'
    ? `placeholder(${jsonToTsSource(slot.slot)})`
    : sql.source(slot.sql);
}
