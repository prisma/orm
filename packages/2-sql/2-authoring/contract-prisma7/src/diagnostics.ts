import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import type { PslSpan } from '@internal/psl-parser';

export type Prisma7DiagnosticCode =
  | 'PRISMA7_PROVIDER_MISMATCH'
  | 'PRISMA7_RELATION_MODE_UNSUPPORTED'
  | 'PRISMA7_VIEW_UNSUPPORTED'
  | 'PRISMA7_UNSUPPORTED_TYPE'
  | 'PRISMA7_NATIVE_TYPE_UNSUPPORTED'
  | 'PRISMA7_ENUM_NAMESPACE_MISMATCH'
  | 'PRISMA7_RELATION_UNRESOLVED'
  | 'PRISMA7_JUNCTION_ID_UNSUPPORTED'
  | 'PRISMA7_TABLE_COLLISION'
  | 'PRISMA7_UNKNOWN_DEFAULT'
  | 'PRISMA7_OPTIONAL_GENERATED_FIELD_UNSUPPORTED'
  | 'PRISMA7_UPDATED_AT_WITH_DEFAULT_UNSUPPORTED'
  | 'PRISMA7_INDEX_ARGUMENT_UNSUPPORTED'
  | 'PRISMA7_IGNORED_FIELD_REFERENCED'
  | 'PRISMA7_UNKNOWN_ATTRIBUTE'
  | 'PRISMA7_SCHEMA_READ_FAILED';

export function prisma7Diagnostic(
  code: Prisma7DiagnosticCode,
  message: string,
  sourceId: string,
  span: PslSpan | undefined,
): ContractSourceDiagnostic {
  return { code, message, sourceId, ...(span !== undefined ? { span } : {}) };
}

function quotedList(names: readonly string[]): string {
  const quoted = names.map((name) => `"${name}"`);
  const last = quoted.pop();
  return quoted.length === 0 ? `${last}` : `${quoted.join(', ')} and ${last}`;
}

export function ignoredFieldReferenced(input: {
  readonly modelName: string;
  readonly fieldNames: readonly string[];
  readonly usedBy: string;
  readonly constraint: 'primary key' | 'unique index' | 'index' | 'foreign key';
  readonly sourceId: string;
  readonly span: PslSpan;
}): ContractSourceDiagnostic {
  const fields = quotedList(input.fieldNames.map((name) => `${input.modelName}.${name}`));
  const one = input.fieldNames.length === 1;
  return prisma7Diagnostic(
    'PRISMA7_IGNORED_FIELD_REFERENCED',
    `${one ? 'Field' : 'Fields'} ${fields} ${one ? 'is' : 'are'} marked @ignore, but ${input.usedBy} uses ${one ? 'it' : 'them'}, and Prisma 7 still creates the ${input.constraint} that includes ${one ? 'its column' : 'their columns'}. Remove @ignore from ${fields}; Prisma 7's next migration is then empty.`,
    input.sourceId,
    input.span,
  );
}
