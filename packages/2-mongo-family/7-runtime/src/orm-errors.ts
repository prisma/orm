import { type StructuredError, structuredError } from '@internal/utils/structured-error';

type OrmSubcode = 'ARGUMENT_INVALID';

export type OrmCode = `ORM.${OrmSubcode}`;

export function ormError(code: OrmCode, message: string): StructuredError {
  return structuredError(code, message);
}
