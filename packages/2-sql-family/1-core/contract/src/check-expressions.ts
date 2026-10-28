import type {
  ContractValueObject,
  ContractValueObjectField,
  EntityCoordinate,
  StorageBase,
} from '@internal/contract/types';
import { valueObjectAt } from '@internal/contract/types';
import type { CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import type { CheckKind } from '@internal/sql-schema-ir/naming';
import { invariant } from '@internal/utils/assertions';
import { declaredJsonType, type JsonType } from './codec-json-type';
import { contractError } from './contract-errors';
import { isStorageValueSet } from './ir/storage-value-set';

type CodecDescriptors = Pick<CodecLookupWithDescriptors, 'descriptorFor'>;

/** A value object with each nested value object inlined, as the target's check renderer reads it. */
export interface ResolvedValueObject {
  readonly fields: Readonly<Record<string, ResolvedValueObjectField>>;
}

export interface ResolvedValueObjectField {
  readonly nullable: boolean;
  readonly many: false | { readonly elementNullable: boolean };
  readonly type: ResolvedValueObjectFieldType;
}

/**
 * `jsonType` is the JSON type the member's codec declares. `values` holds the stored values of the value set an enum member refers to. `anyObject` stands where a value object that contains itself refers back into itself: any object is accepted there, as the MongoDB validator does.
 */
export type ResolvedValueObjectFieldType =
  | {
      readonly kind: 'scalar';
      readonly jsonType: JsonType;
      readonly values: readonly (string | number)[] | undefined;
    }
  | { readonly kind: 'valueObject'; readonly valueObject: ResolvedValueObject }
  | { readonly kind: 'anyObject' };

/** One column's shape, as the contract builder hands it to a target's check renderer. */
export interface CheckExpressionInput {
  readonly tableName: string;
  readonly columnName: string;
  readonly many: false | { readonly elementNullable: boolean };
  /** The values a column typed by a domain enum, or a discriminator column, may hold. */
  readonly memberValues: readonly (string | number)[] | undefined;
  /** The value object the column holds, or `undefined` when it holds none. */
  readonly valueObject: ResolvedColumnValueObject | undefined;
}

/** The value object a column holds, with the column's nullability, and whether the column's JSON value is an array of them. */
export interface ResolvedColumnValueObject {
  readonly nullable: boolean;
  readonly many: false | { readonly elementNullable: boolean };
  readonly valueObject: ResolvedValueObject;
}

/** A check the target wants written: what it enforces, the column it constrains, and the predicate body without the surrounding `CHECK (…)`. The family names it. */
export interface CheckExpressionCandidate {
  readonly kind: CheckKind;
  readonly columnName: string;
  readonly expression: string;
}

export type CheckExpressionRenderer = (
  input: CheckExpressionInput,
) => ReadonlyArray<CheckExpressionCandidate>;

/**
 * What the check of a column that holds a value object reads. The contract build and `contract print` both derive it here, so print recognises exactly the check the build writes.
 */
export function resolveColumnValueObject(
  storage: Pick<StorageBase, 'namespaces'>,
  column: {
    readonly reference: EntityCoordinate<'storage', 'valueObject'>;
    readonly nullable: boolean;
    readonly many: false | { readonly elementNullable: boolean };
  },
  codecs: CodecDescriptors,
): ResolvedColumnValueObject {
  return {
    nullable: column.nullable,
    many: column.many,
    valueObject: resolveValueObject(storage, column.reference, codecs),
  };
}

/**
 * The value set a discriminator column names (ADR 309): keyed `<Base>.<field>`, and holding the variants' values sorted, so the order variants are declared in does not change the storage hash. The contract build writes it and `contract print` compares a contract's value set with it.
 */
export function discriminatorValueSet(
  baseModelName: string,
  discriminatorField: string,
  variantValues: readonly string[],
): { readonly name: string; readonly values: readonly string[] } {
  return { name: `${baseModelName}.${discriminatorField}`, values: [...variantValues].sort() };
}

/**
 * The value object a reference names, with nested value objects inlined, enum members' values read from their storage value sets, and each scalar member's JSON type read from its codec.
 */
export function resolveValueObject(
  storage: Pick<StorageBase, 'namespaces'>,
  reference: EntityCoordinate<'storage', 'valueObject'>,
  codecs: CodecDescriptors,
): ResolvedValueObject {
  return resolveEntered(storage, reference, [referenceKey(reference)], codecs);
}

function resolveEntered(
  storage: Pick<StorageBase, 'namespaces'>,
  reference: EntityCoordinate<'storage', 'valueObject'>,
  path: readonly string[],
  codecs: CodecDescriptors,
): ResolvedValueObject {
  const valueObject = requiredValueObject(storage, reference);
  return {
    fields: Object.fromEntries(
      Object.entries(valueObject.fields).map(([name, field]) => [
        name,
        {
          nullable: field.nullable,
          many: field.many ?? false,
          type: resolveFieldType(storage, { reference, name, field }, path, codecs),
        },
      ]),
    ),
  };
}

interface ValueObjectMember {
  readonly reference: EntityCoordinate<'storage', 'valueObject'>;
  readonly name: string;
  readonly field: ContractValueObjectField;
}

function resolveFieldType(
  storage: Pick<StorageBase, 'namespaces'>,
  member: ValueObjectMember,
  path: readonly string[],
  codecs: CodecDescriptors,
): ResolvedValueObjectFieldType {
  const { field } = member;
  const { type } = field;
  invariant(
    type.kind !== 'union' && field.dict !== true,
    'a SQL value object member is never a union or a dictionary',
  );
  if (type.kind === 'scalar') {
    return {
      kind: 'scalar',
      jsonType: memberJsonType(member, type.codecId, codecs),
      values: field.valueSet === undefined ? undefined : valueSetValues(storage, field.valueSet),
    };
  }
  const key = referenceKey(type);
  if (reachesAny(storage, type, new Set(path))) return { kind: 'anyObject' };
  return {
    kind: 'valueObject',
    valueObject: resolveEntered(storage, type, [...path, key], codecs),
  };
}

function memberJsonType(
  member: ValueObjectMember,
  codecId: string,
  codecs: CodecDescriptors,
): JsonType {
  const descriptor = codecs.descriptorFor(codecId);
  invariant(
    descriptor !== undefined,
    `value object member codec "${codecId}" is not a codec of the stack; the contract validators refuse a codec the stack does not register`,
  );
  const jsonType = declaredJsonType(descriptor);
  if (jsonType !== undefined) return jsonType;
  const valueObject = `${member.reference.namespaceId}:${member.reference.entityName}`;
  throw contractError(
    'CONTRACT.CODEC_JSON_TYPE_MISSING',
    `The codec "${codecId}" of value object "${valueObject}" member "${member.name}" declares no jsonType, so the check of the value object cannot be derived.`,
    {
      why: 'The check of a value object column requires each member to be of the JSON type its codec declares, and this codec declares none.',
      fix: `The author of the codec "${codecId}" adds a jsonType to its descriptor, the JSON type its value is written as inside a JSON document.`,
      meta: { codecId, valueObject, member: member.name, property: 'jsonType' },
    },
  );
}

/**
 * Whether `from` refers, through its own fields or nested ones, to a value object on the path being resolved. Each value object on the path refers to `from`, so this holds exactly when `from` is in a group of value objects that contain each other which the path has already entered.
 */
function reachesAny(
  storage: Pick<StorageBase, 'namespaces'>,
  from: EntityCoordinate<'storage', 'valueObject'>,
  targets: ReadonlySet<string>,
): boolean {
  const seen = new Set<string>();
  const pending: EntityCoordinate<'storage', 'valueObject'>[] = [from];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const key = referenceKey(next);
    if (targets.has(key)) return true;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const field of Object.values(requiredValueObject(storage, next).fields)) {
      if (field.type.kind === 'valueObject') pending.push(field.type);
    }
  }
  return false;
}

function requiredValueObject(
  storage: Pick<StorageBase, 'namespaces'>,
  reference: EntityCoordinate<'storage', 'valueObject'>,
): ContractValueObject {
  const valueObject = valueObjectAt(storage, reference);
  invariant(
    valueObject !== undefined,
    `value object "${reference.entityName}" in namespace "${reference.namespaceId}" is not in storage; the contract validators refuse a reference to a missing value object`,
  );
  return valueObject;
}

function valueSetValues(
  storage: Pick<StorageBase, 'namespaces'>,
  reference: EntityCoordinate<'storage', 'valueSet'>,
): readonly (string | number)[] {
  const valueSet = Object.hasOwn(storage.namespaces, reference.namespaceId)
    ? storage.namespaces[reference.namespaceId]?.entries?.['valueSet']?.[reference.entityName]
    : undefined;
  invariant(
    isStorageValueSet(valueSet),
    `value set "${reference.entityName}" in namespace "${reference.namespaceId}" is not in storage; the contract validators refuse a value object member whose value set is missing`,
  );
  return valueSet.values.filter(
    (value): value is string | number => typeof value === 'string' || typeof value === 'number',
  );
}

function referenceKey(reference: EntityCoordinate<'storage', 'valueObject'>): string {
  return JSON.stringify([reference.namespaceId, reference.entityName]);
}
