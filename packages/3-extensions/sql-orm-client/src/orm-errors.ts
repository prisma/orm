import type { StructuredError, StructuredErrorOptions } from '@internal/utils/structured-error';
import { structuredError } from '@internal/utils/structured-error';

export type OrmCode = `ORM.${OrmSubcode}`;

type OrmSubcode =
  | 'TABLE_UNKNOWN'
  | 'COLUMN_UNKNOWN'
  | 'FIELD_UNKNOWN'
  | 'RELATION_UNKNOWN'
  | 'FILTER_UNSUPPORTED'
  | 'ARGUMENT_INVALID'
  | 'OPERATION_UNSUPPORTED'
  | 'RELATION_MUTATION_UNSUPPORTED'
  | 'RELATION_MUTATION_INVALID'
  | 'RELATION_ROW_MISSING'
  | 'RELATION_LINK_DUPLICATE'
  | 'INCLUDE_INVALID'
  | 'INCLUDE_UNSUPPORTED'
  | 'AGGREGATE_OPERATION_RESERVED'
  | 'AGGREGATE_PROJECTION_ONLY'
  | 'AGGREGATE_SELECTOR_MISSING'
  | 'AGGREGATE_SELECTOR_INVALID'
  | 'AGGREGATE_UNSUPPORTED'
  | 'GROUP_BY_FIELD_MISSING'
  | 'HAVING_EXPRESSION_UNSUPPORTED'
  | 'CURSOR_VALUE_MISSING'
  | 'CURSOR_ORDER_NULLS_UNSUPPORTED'
  | 'MUTATION_DATA_MISSING'
  | 'MUTATION_ROW_MISSING'
  | 'ROW_IDENTITY_MISSING'
  | 'CAPABILITY_MISSING';

export function ormError(
  code: OrmCode,
  message: string,
  options?: StructuredErrorOptions,
): StructuredError {
  return structuredError(code, message, options);
}
