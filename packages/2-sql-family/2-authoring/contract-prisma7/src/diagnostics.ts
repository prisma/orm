import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import type { PslSpan } from '@internal/psl-parser';

export type Prisma7DiagnosticCode = `PSL.${Prisma7Subcode}`;

type Prisma7Subcode =
  | 'PRISMA7_PROVIDER_MISMATCH'
  | 'PRISMA7_RELATION_MODE_UNSUPPORTED'
  | 'PRISMA7_VIEW_UNSUPPORTED'
  | 'PRISMA7_UNSUPPORTED_TYPE'
  | 'PRISMA7_NATIVE_TYPE_UNSUPPORTED'
  | 'PRISMA7_EXTENSIONS_PREVIEW_FEATURE_MISSING'
  | 'PRISMA7_EXTENSION_PACK_MISSING'
  | 'PRISMA7_EXTENSION_ARGUMENT_UNSUPPORTED'
  | 'PRISMA7_EXTENSION_SCHEMA_MISMATCH'
  | 'PRISMA7_ENUM_NAMESPACE_MISMATCH'
  | 'PRISMA7_RELATION_UNRESOLVED'
  | 'PRISMA7_JUNCTION_ID_UNSUPPORTED'
  | 'PRISMA7_JUNCTION_NAME_COLLISION'
  | 'PRISMA7_RELATION_NAME_SHARED'
  | 'PRISMA7_TABLE_COLLISION'
  | 'PRISMA7_REFERENTIAL_ACTION_UNSUPPORTED'
  | 'PRISMA7_JSON_NULL_DEFAULT_UNSUPPORTED'
  | 'PRISMA7_UNKNOWN_DEFAULT'
  | 'PRISMA7_GENERATOR_REFUSED'
  | 'PRISMA7_INDEX_ARGUMENT_UNSUPPORTED'
  | 'PRISMA7_CONSTRAINT_NAME_TOO_LONG'
  | 'PRISMA7_IGNORED_FIELD_REFERENCED'
  | 'PRISMA7_UNKNOWN_ATTRIBUTE'
  | 'PRISMA7_UPDATED_AT_FIELD_INVALID'
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

const UNMAPPED_REASONS = ['ignored', 'unsupported'] as const;

/** Why a model has no field for a column its table keeps: the field is `@ignore`, or its type is `Unsupported(...)`. */
export type UnmappedReason = (typeof UNMAPPED_REASONS)[number];

function unmappedClause(reason: UnmappedReason, one: boolean): string {
  if (reason === 'ignored') return `${one ? 'is' : 'are'} marked @ignore`;
  return `${one ? 'has' : 'have'} type Unsupported(...), so the Prisma 8 model has no field for ${one ? 'it' : 'them'}`;
}

/** A field with no Prisma 8 field in the model's primary key: without it the model has no field that identifies a row. */
export function unmappedFieldInPrimaryKey(input: {
  readonly modelName: string;
  readonly fieldNames: readonly string[];
  readonly reason: UnmappedReason;
  readonly usedBy: string;
  readonly sourceId: string;
  readonly span: PslSpan;
}): ContractSourceDiagnostic {
  const fields = fieldList(input.modelName, input.fieldNames);
  const one = input.fieldNames.length === 1;
  const modelIgnore = `@@ignore on model "${input.modelName}": Prisma 7 then requires @ignore on every relation field that points to the model, its next migration is empty, Prisma 8 keeps the model's table with its primary key, and the model disappears from both clients.`;
  const edits =
    input.reason === 'ignored'
      ? `Remove @ignore from ${fields}: Prisma 7's next migration is then empty, and ${one ? 'the field appears' : 'the fields appear'} in the Prisma 7 client again. Or replace ${one ? 'it' : 'them'} with ${modelIgnore}`
      : `Add ${modelIgnore}`;
  return prisma7Diagnostic(
    'PSL.PRISMA7_IGNORED_FIELD_REFERENCED',
    `${one ? 'Field' : 'Fields'} ${fields} ${unmappedClause(input.reason, one)}, but ${input.usedBy} uses ${one ? 'it' : 'them'}, and without ${one ? 'it' : 'them'} model "${input.modelName}" has no field that identifies a row, so Prisma 8 could not update, delete or relate its rows. ${edits}`,
    input.sourceId,
    input.span,
  );
}

/** A relation that is not `@ignore` joins on fields with no Prisma 8 field: Prisma 8 relations join on fields. */
export function unmappedFieldJoined(input: {
  readonly modelName: string;
  readonly fieldNames: readonly string[];
  readonly reason: UnmappedReason;
  readonly relationField: string;
  readonly sourceId: string;
  readonly span: PslSpan;
}): ContractSourceDiagnostic {
  const fields = fieldList(input.modelName, input.fieldNames);
  const one = input.fieldNames.length === 1;
  const relation = `relation field "${input.relationField}"`;
  const relationIgnore = `${relation} @ignore${input.reason === 'ignored' ? ' as well' : ''}: Prisma 7's next migration is then empty, the relation field disappears from the Prisma 7 client, and Prisma 8 keeps its foreign key while leaving the relation out of the contract's models.`;
  const edits =
    input.reason === 'ignored'
      ? `Remove @ignore from ${fields}: Prisma 7's next migration is then empty, and ${one ? 'the field appears' : 'the fields appear'} in the Prisma 7 client again. Or mark ${relationIgnore}`
      : `Mark ${relationIgnore}`;
  return prisma7Diagnostic(
    'PSL.PRISMA7_IGNORED_FIELD_REFERENCED',
    `${one ? 'Field' : 'Fields'} ${fields} ${unmappedClause(input.reason, one)}, but ${relation} joins on ${one ? 'it' : 'them'}, and Prisma 8 relations join on fields. ${edits}`,
    input.sourceId,
    input.span,
  );
}

/** The diagnostics for the fields among `fieldNames` that have no Prisma 8 field, one per reason. */
export function unmappedFieldDiagnostics(
  fieldNames: readonly string[],
  unmapped: ReadonlyMap<string, UnmappedReason>,
  diagnostic: (fieldNames: readonly string[], reason: UnmappedReason) => ContractSourceDiagnostic,
): ContractSourceDiagnostic[] {
  return UNMAPPED_REASONS.flatMap((reason) => {
    const names = fieldNames.filter((name) => unmapped.get(name) === reason);
    return names.length === 0 ? [] : [diagnostic(names, reason)];
  });
}
