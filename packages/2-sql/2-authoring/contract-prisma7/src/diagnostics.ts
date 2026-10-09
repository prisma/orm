import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import type { PslSpan } from '@internal/psl-parser';

export type Prisma7DiagnosticCode = `PSL.${Prisma7Subcode}`;

type Prisma7Subcode =
  | 'PRISMA7_PROVIDER_MISMATCH'
  | 'PRISMA7_RELATION_MODE_UNSUPPORTED'
  | 'PRISMA7_VIEW_UNSUPPORTED'
  | 'PRISMA7_UNSUPPORTED_TYPE'
  | 'PRISMA7_NATIVE_TYPE_UNSUPPORTED'
  | 'PRISMA7_ENUM_NAMESPACE_MISMATCH'
  | 'PRISMA7_RELATION_UNRESOLVED'
  | 'PRISMA7_JUNCTION_ID_UNSUPPORTED'
  | 'PRISMA7_JUNCTION_NAME_COLLISION'
  | 'PRISMA7_RELATION_NAME_SHARED'
  | 'PRISMA7_TABLE_COLLISION'
  | 'PRISMA7_REFERENTIAL_ACTION_UNSUPPORTED'
  | 'PRISMA7_JSON_NULL_DEFAULT_UNSUPPORTED'
  | 'PRISMA7_UNKNOWN_DEFAULT'
  | 'PRISMA7_OPTIONAL_GENERATED_FIELD_UNSUPPORTED'
  | 'PRISMA7_UPDATED_AT_WITH_DEFAULT_UNSUPPORTED'
  | 'PRISMA7_UPDATED_AT_TYPE_UNSUPPORTED'
  | 'PRISMA7_INDEX_ARGUMENT_UNSUPPORTED'
  | 'PRISMA7_CONSTRAINT_NAME_TOO_LONG'
  | 'PRISMA7_IGNORED_FIELD_REFERENCED'
  | 'PRISMA7_UNKNOWN_ATTRIBUTE'
  | 'PRISMA7_SCHEMA_READ_FAILED'
  | 'PRISMA7_CONTRACT_INVALID';

export function prisma7Diagnostic(
  code: Prisma7DiagnosticCode,
  message: string,
  sourceId: string,
  span: PslSpan | undefined,
): ContractSourceDiagnostic {
  return { code, message, sourceId, ...(span !== undefined ? { span } : {}) };
}

export function andList(items: readonly string[]): string {
  const leading = items.slice(0, -1);
  const last = items[items.length - 1] ?? '';
  return leading.length === 0 ? last : `${leading.join(', ')} and ${last}`;
}

export function fieldList(modelName: string, fieldNames: readonly string[]): string {
  return andList(fieldNames.map((name) => `"${modelName}.${name}"`));
}

/** An `@ignore` field in the model's primary key: without it the model has no field that identifies a row. */
export function ignoredFieldInPrimaryKey(input: {
  readonly modelName: string;
  readonly fieldNames: readonly string[];
  readonly usedBy: string;
  readonly sourceId: string;
  readonly span: PslSpan;
}): ContractSourceDiagnostic {
  const fields = fieldList(input.modelName, input.fieldNames);
  const one = input.fieldNames.length === 1;
  return prisma7Diagnostic(
    'PSL.PRISMA7_IGNORED_FIELD_REFERENCED',
    `${one ? 'Field' : 'Fields'} ${fields} ${one ? 'is' : 'are'} marked @ignore, but ${input.usedBy} uses ${one ? 'it' : 'them'}, and without ${one ? 'it' : 'them'} model "${input.modelName}" has no field that identifies a row, so Prisma 8 could not update, delete or relate its rows. Remove @ignore from ${fields}: Prisma 7's next migration is then empty, and ${one ? 'the field appears' : 'the fields appear'} in the Prisma 7 client again. Or replace ${one ? 'it' : 'them'} with @@ignore on model "${input.modelName}": Prisma 7 then requires @ignore on every relation field that points to the model, its next migration is empty, Prisma 8 keeps the model's table with its primary key, and the model disappears from both clients.`,
    input.sourceId,
    input.span,
  );
}

/** A relation that is not `@ignore` joins on `@ignore` fields: Prisma 8 relations join on fields, and the domain has no ignored field. */
export function ignoredFieldJoined(input: {
  readonly modelName: string;
  readonly fieldNames: readonly string[];
  readonly relationField: string;
  readonly sourceId: string;
  readonly span: PslSpan;
}): ContractSourceDiagnostic {
  const fields = fieldList(input.modelName, input.fieldNames);
  const one = input.fieldNames.length === 1;
  const relation = `relation field "${input.relationField}"`;
  return prisma7Diagnostic(
    'PSL.PRISMA7_IGNORED_FIELD_REFERENCED',
    `${one ? 'Field' : 'Fields'} ${fields} ${one ? 'is' : 'are'} marked @ignore, but ${relation} joins on ${one ? 'it' : 'them'}, and Prisma 8 relations join on fields. Remove @ignore from ${fields}: Prisma 7's next migration is then empty, and ${one ? 'the field appears' : 'the fields appear'} in the Prisma 7 client again. Or mark ${relation} @ignore as well: Prisma 7's next migration is then empty, the relation field disappears from the Prisma 7 client, and Prisma 8 keeps its foreign key while leaving the relation out of the contract's models.`,
    input.sourceId,
    input.span,
  );
}
