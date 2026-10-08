import type { SqlIndexIR } from '@internal/sql-schema-ir/types';

/** Whether a live index uses btree, the access method Postgres gives an index that names none, and so the kind of backing index `contract emit` derives for a relation. */
export function isPostgresDefaultIndexKind(index: SqlIndexIR): boolean {
  return (index.type ?? 'btree') === 'btree';
}
