import { blindCast } from '@internal/utils/casts';
import { valueObjectAt } from './storage-value-objects';
import type { StorageBase } from './types';

interface FieldTypeLike {
  readonly kind?: string;
  readonly plane?: string;
  readonly namespaceId?: string;
  readonly entityKind?: string;
  readonly entityName?: string;
  readonly name?: string;
  readonly members?: readonly FieldTypeLike[];
}

export interface FieldLike {
  readonly type?: FieldTypeLike;
  readonly valueSet?: { readonly namespaceId?: string; readonly entityName?: string };
  readonly many?: unknown;
  readonly elementNullable?: unknown;
  readonly dict?: boolean;
}

export function fieldLike(field: unknown): FieldLike | undefined {
  return blindCast<FieldLike | undefined, 'contract fields are runtime-validated shapes'>(field);
}

function valueObjectReferenceProblem(type: FieldTypeLike): string | undefined {
  if (type.plane === undefined && type.entityKind === undefined) {
    return `refers to value object "${type.name}" by name; contracts no longer do: a field refers to its value object by the coordinate of a storage entity under storage.namespaces.<namespace>.entries.valueObject, so re-emit the contract from its source, or rewrite a stored contract such as a migration snapshot with value-objects-in-storage.ts, which ships in the value-objects-in-storage scripts of the Prisma 8 upgrade guide`;
  }
  if (type.plane !== 'storage' || type.entityKind !== 'valueObject') {
    return `refers to a value object with plane "${type.plane}" and entityKind "${type.entityKind}"; a value object reference has plane "storage" and entityKind "valueObject"`;
  }
  return undefined;
}

/** What is wrong with the value object references of a field's type, a union's members included, each prefixed with `location`. */
export function valueObjectTypeProblems(
  storage: Pick<StorageBase, 'namespaces'>,
  type: FieldTypeLike | undefined,
  location: string,
): readonly string[] {
  if (type === undefined) return [];
  if (type.kind === 'union') {
    return (type.members ?? []).flatMap((member) =>
      valueObjectTypeProblems(storage, member, location),
    );
  }
  if (type.kind !== 'valueObject') return [];
  const problem = valueObjectReferenceProblem(type);
  if (problem !== undefined) return [`${location} ${problem}`];
  const namespaceId = type.namespaceId ?? '';
  const entityName = type.entityName ?? '';
  const found = valueObjectAt(storage, {
    plane: 'storage',
    namespaceId,
    entityKind: 'valueObject',
    entityName,
  });
  return found === undefined
    ? [
        `${location} refers to value object "${entityName}" in storage namespace "${namespaceId}", which storage.namespaces.${namespaceId}.entries.valueObject does not have`,
      ]
    : [];
}

/** What is wrong with a field's `many`, `elementNullable` and `dict`, each prefixed with `location`. */
export function fieldModifierProblems(location: string, field: unknown): readonly string[] {
  const candidate = fieldLike(field);
  const many = candidate?.many;
  const isList =
    typeof many === 'object' &&
    many !== null &&
    !Array.isArray(many) &&
    Object.keys(many).length === 1 &&
    'elementNullable' in many &&
    typeof many.elementNullable === 'boolean';
  const problems: string[] = [];
  if (many !== undefined && many !== false && !isList) {
    problems.push(
      `${location} has invalid "many"; expected false or an elementNullable descriptor`,
    );
  }
  if (candidate?.elementNullable !== undefined) {
    problems.push(`${location} cannot have sibling "elementNullable"; put it inside "many"`);
  }
  if (isList && candidate?.dict) {
    problems.push(`${location} cannot have both "many" and "dict" modifiers`);
  }
  return problems;
}
