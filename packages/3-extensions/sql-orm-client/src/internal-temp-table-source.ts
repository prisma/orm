import type { SelectAst } from '@prisma-next/sql-relational-core/ast';
import type { ScopeField } from '@prisma-next/sql-relational-core/expression';

export const INTERNAL_TO_TEMP_TABLE_QUERY_SOURCE = Symbol.for(
  '@prisma-next/sql-orm-client/internal-temp-table-query-source',
);

export type InternalTempTableQuerySource<Row extends Record<string, ScopeField>> = {
  buildAst(): SelectAst;
  getRowFields(): Row;
};
