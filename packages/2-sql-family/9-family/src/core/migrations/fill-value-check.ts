import {
  asNamespaceId,
  type Contract,
  type ContractValueObjectField,
  type JsonValue,
  valueObjectAt,
  valueObjectsWithCoordinates,
} from '@internal/contract/types';
import {
  type AuthoringTypeNamespace,
  collectScalarTypeConstructors,
} from '@internal/framework-components/authoring';
import type { CodecRef, TypeLookups } from '@internal/framework-components/codec';
import { valueObjectFieldStatementText } from '@internal/framework-components/control';
import { isStorageValueSet, type SqlStorage } from '@internal/sql-contract/types';
import { acceptedByDataType } from './accepted-by-data-type';
import { buildColumnCodecRef } from './contract-to-schema-ir';

/** The codecs and data types of a stack, and the name its authors write each scalar type as. */
export interface FillValueTypes extends TypeLookups {
  /** The type name a schema writes for a codec, such as `String`, when the stack has one. */
  readonly scalarTypeName: (codecRef: CodecRef) => string | undefined;
}

/** The contract and the stack a `fillStoredKey` value is checked against. */
export interface FillValueCheck {
  readonly contract: Contract<SqlStorage>;
  readonly types: FillValueTypes;
}

/**
 * The value object field a `fillStoredKey` call fills, as a statement names it, such as
 * `Address.country`. With `check`, the call's value must be one the field takes; the planner's own
 * placeholders and temporary values need none.
 */
export interface StoredKeyFillField {
  readonly text: string;
  readonly check: FillValueCheck | undefined;
}

/** The name each scalar type constructor of `namespace` is written as, by the codec it makes; the first declared wins. */
export function scalarTypeNamesOf(
  namespace: AuthoringTypeNamespace,
): (codecRef: CodecRef) => string | undefined {
  const constructors = [...collectScalarTypeConstructors(namespace)];
  return (codecRef) =>
    constructors.find(
      ([, output]) =>
        output.codecId === codecRef.codecId &&
        JSON.stringify(output.typeParams ?? {}) === JSON.stringify(codecRef.typeParams ?? {}),
    )?.[0];
}

interface NamedField {
  readonly text: string;
  readonly field: ContractValueObjectField;
}

function fieldNamed(contract: Contract<SqlStorage>, text: string): NamedField | undefined {
  for (const { coordinate, valueObject } of valueObjectsWithCoordinates(contract.storage)) {
    for (const [name, field] of Object.entries(valueObject.fields)) {
      const named = valueObjectFieldStatementText(contract, {
        namespaceId: asNamespaceId(coordinate.namespaceId),
        valueObject: coordinate.entityName,
        field: name,
      });
      if (named === text) return { text, field };
    }
  }
  return undefined;
}

function isMany(field: ContractValueObjectField): boolean {
  return field.many !== undefined && field.many !== false;
}

function valueSetValues(
  contract: Contract<SqlStorage>,
  field: ContractValueObjectField,
): readonly JsonValue[] | undefined {
  const reference = field.valueSet;
  if (reference === undefined) return undefined;
  const valueSet = Object.hasOwn(contract.storage.namespaces, reference.namespaceId)
    ? contract.storage.namespaces[reference.namespaceId]?.entries?.['valueSet']?.[
        reference.entityName
      ]
    : undefined;
  return isStorageValueSet(valueSet) ? valueSet.values : undefined;
}

function isJsonObject(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function json(value: JsonValue): string {
  return JSON.stringify(value);
}

class FieldValueCheck {
  constructor(private readonly check: FillValueCheck) {}

  /** The type of one value of `field`, as its schema writes it. */
  typeText(field: ContractValueObjectField): string {
    const { type } = field;
    if (type.kind === 'valueObject') return type.entityName;
    if (type.kind === 'union') return 'value of its union';
    if (field.valueSet !== undefined) return `value of ${field.valueSet.entityName}`;
    const codecRef = buildColumnCodecRef(type, undefined);
    return this.check.types.scalarTypeName(codecRef) ?? `value of codec ${json(type.codecId)}`;
  }

  fieldProblem(value: JsonValue, named: NamedField): string | undefined {
    const { field, text } = named;
    if (value === null && field.nullable) return undefined;
    if (!isMany(field)) return this.oneValueProblem(value, named);
    if (!Array.isArray(value)) {
      return `value ${json(value)} for field ${json(text)} is not a list of ${this.typeText(field)}`;
    }
    const elementNullable = field.many !== false && field.many?.elementNullable === true;
    for (const element of value) {
      if (element === null && elementNullable) continue;
      const problem = this.oneValueProblem(element, named);
      if (problem !== undefined) return problem;
    }
    return undefined;
  }

  private oneValueProblem(value: JsonValue, named: NamedField): string | undefined {
    const { field, text } = named;
    const { type } = field;
    const notA = `value ${json(value)} for field ${json(text)} is not a ${this.typeText(field)}`;
    if (type.kind === 'union') return undefined;
    if (type.kind === 'valueObject') {
      return isJsonObject(value) ? this.objectProblem(value, type, text) : notA;
    }
    const values = valueSetValues(this.check.contract, field);
    if (values !== undefined) {
      return values.includes(value)
        ? undefined
        : `${notA}; it takes ${values.map(json).join(', ')}`;
    }
    const codecRef = buildColumnCodecRef(type, undefined);
    if (this.check.types.codecLookup.descriptorFor(codecRef.codecId) === undefined) {
      return `field ${json(text)} has codec ${json(codecRef.codecId)}, which the stack does not have, so no value can be checked against it`;
    }
    return acceptedByDataType(value, codecRef, this.check.types) ? undefined : notA;
  }

  private objectProblem(
    value: { readonly [key: string]: JsonValue },
    reference: Parameters<typeof valueObjectAt>[1],
    text: string,
  ): string | undefined {
    const valueObject = valueObjectAt(this.check.contract.storage, reference);
    if (valueObject === undefined) return undefined;
    const name = reference.entityName;
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(valueObject.fields, key)) {
        return `value ${json(value)} for field ${json(text)} has key ${json(key)}, and ${name} has no field ${json(key)}`;
      }
    }
    for (const [key, field] of Object.entries(valueObject.fields)) {
      const fieldText = valueObjectFieldStatementText(this.check.contract, {
        namespaceId: asNamespaceId(reference.namespaceId),
        valueObject: name,
        field: key,
      });
      const member = Object.hasOwn(value, key) ? value[key] : undefined;
      if (member === undefined) {
        if (field.nullable) continue;
        return `value ${json(value)} for field ${json(text)} lacks field ${json(fieldText)}, which is required`;
      }
      const problem = this.fieldProblem(member, { text: fieldText, field });
      if (problem !== undefined) return problem;
    }
    return undefined;
  }
}

/**
 * Why `value` cannot fill the field, or `undefined` when the field has no check or takes the value:
 * an enum value must be one of its value set's values, a list must hold values of its element's
 * type, a value object must hold its required fields and no other key, each checked the same way,
 * and a scalar must be one its codec's data type accepts.
 */
export function fillValueProblem(
  value: JsonValue,
  field: StoredKeyFillField | undefined,
): string | undefined {
  const check = field?.check;
  if (field === undefined || check === undefined) return undefined;
  const named = fieldNamed(check.contract, field.text);
  if (named === undefined) {
    return `field ${json(field.text)} is not a value object field of the end contract`;
  }
  return new FieldValueCheck(check).fieldProblem(value, named);
}
