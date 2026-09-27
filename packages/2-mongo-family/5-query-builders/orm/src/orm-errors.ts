import {
  type StructuredError,
  type StructuredErrorOptions,
  structuredError,
} from '@internal/utils/structured-error';

type OrmSubcode =
  | 'MODEL_UNKNOWN'
  | 'RELATION_UNKNOWN'
  | 'WHERE_MISSING'
  | 'OPERATION_UNSUPPORTED'
  | 'INCLUDE_UNSUPPORTED'
  | 'FIELD_IMMUTABLE'
  | 'MUTATION_DEFAULTS_MISSING';

export type OrmCode = `ORM.${OrmSubcode}`;

export function ormError(
  code: OrmCode,
  message: string,
  options?: StructuredErrorOptions,
): StructuredError {
  return structuredError(code, message, options);
}
