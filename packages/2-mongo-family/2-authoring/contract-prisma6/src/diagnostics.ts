import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import type { PslSpan } from '@internal/psl-parser';

export type Prisma6MongoDiagnosticCode = `PSL.PRISMA6_MONGO_${Prisma6MongoSubcode}`;

type Prisma6MongoSubcode =
  | 'PROVIDER_MISMATCH'
  | 'ID_NOT_OBJECTID'
  | 'COMPOSITE_ID_UNSUPPORTED'
  | 'NATIVE_TYPE_UNSUPPORTED'
  | 'UPDATED_AT_TYPE_UNSUPPORTED'
  | 'OPTIONAL_GENERATED_FIELD_UNSUPPORTED'
  | 'DEFAULT_UNSUPPORTED'
  | 'COMPOSITE_MAP_UNSUPPORTED'
  | 'REFERENTIAL_ACTION_UNSUPPORTED'
  | 'LIST_RELATION_UNSUPPORTED'
  | 'INDEX_ARGUMENT_UNSUPPORTED'
  | 'TEXT_INDEX_LIMIT'
  | 'IGNORED_FIELD_REFERENCED'
  | 'SCHEMA_UNSUPPORTED'
  | 'VIEW_UNSUPPORTED'
  | 'UNKNOWN_ATTRIBUTE'
  | 'SCHEMA_READ_FAILED'
  | 'CONTRACT_INVALID';

export function prisma6Diagnostic(
  code: Prisma6MongoDiagnosticCode,
  message: string,
  sourceId: string,
  span: PslSpan | undefined,
): ContractSourceDiagnostic {
  return { code, message, sourceId, ...(span !== undefined ? { span } : {}) };
}
