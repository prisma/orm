/**
 * Checking a value-object field's literal default against its composite type. The default is one
 * JSON value of the field's column, holding each member in the stored form its codec writes. It
 * must have the shape of the value object, or of a list of them, and each member's codec must read
 * the member's value. A `null` member value is taken when the member is optional, or when its codec
 * reads `null`, as a JSON member's does.
 */

import type { JsonValue } from '@internal/contract/types';
import {
  type Codec,
  type CodecLookupWithDescriptors,
  codecForRef,
  type DataTypeLookup,
} from '@internal/framework-components/codec';
import {
  isValueObjectMember,
  type ScalarMemberNode,
  type ValueObjectMemberNode,
  type ValueObjectNode,
} from '@internal/sql-contract-ts/contract-builder';
import { blindCast } from '@internal/utils/casts';
import { InternalError } from '@internal/utils/internal-error';
import {
  PSL_INVALID_DEFAULT_LITERAL,
  PSL_VALUE_TYPE_INCOMPATIBLE,
  readStoredValue,
} from './data-type-default';

/** The value objects of a document, and every member each composite type declares. */
export interface ValueObjectTypes {
  readonly nodes: ReadonlyMap<string, ValueObjectNode>;
  /** Includes a member whose type did not resolve, which has no node and is reported once, where it is declared. */
  readonly declaredMembers: ReadonlyMap<string, ReadonlySet<string>>;
}

export interface ValueObjectDefaultMismatch {
  readonly code: string;
  readonly message: string;
}

export interface ValueObjectDefaultInput {
  /** `Model.field`, the start of every path a mismatch names. */
  readonly fieldPath: string;
  readonly value: JsonValue;
  readonly list: boolean;
  readonly nullable: boolean;
  readonly valueObjectName: string;
  readonly types: ValueObjectTypes;
  readonly codecLookup: CodecLookupWithDescriptors | undefined;
  readonly dataTypeLookup: DataTypeLookup;
}

/**
 * The value-object column's default as the document it holds, and in the form the column stores. A
 * column may store the document's JSON text, as `sqlite/json@1` does, so its codec reads the stored
 * value into the document the composite type describes. A list literal on a list of value objects
 * is read element by element; the column stores the list's document in its own form.
 */
export function valueObjectDefaultDocument(input: {
  readonly stored: JsonValue;
  readonly elementwise: boolean;
  readonly codecId: string;
  readonly codecLookup: CodecLookupWithDescriptors | undefined;
}): { readonly document: JsonValue; readonly stored: JsonValue } {
  const codec =
    input.codecLookup === undefined
      ? undefined
      : codecForRef(input.codecLookup, { codecId: input.codecId });
  if (codec === undefined) return { document: input.stored, stored: input.stored };
  if (input.elementwise && Array.isArray(input.stored)) {
    const document = input.stored.map((element) => readDocument(codec, element));
    return { document, stored: codec.encodeJson(document) };
  }
  return { document: readDocument(codec, input.stored), stored: input.stored };
}

/** The column's codec has already read `stored` while the default was lowered, so it reads again. */
function readDocument(codec: Codec, stored: JsonValue): JsonValue {
  if (stored === null) return null;
  return blindCast<
    JsonValue,
    'a value-object column codec reads its stored form into a JSON document'
  >(codec.decodeJson(stored));
}

/** Each way the default does not match the composite type. */
export function valueObjectDefaultMismatches(
  input: ValueObjectDefaultInput,
): readonly ValueObjectDefaultMismatch[] {
  const mismatches: ValueObjectDefaultMismatch[] = [];
  const shape = (path: string, message: string) =>
    mismatches.push({
      code: PSL_VALUE_TYPE_INCOMPATIBLE,
      message: `Field "${path}": ${message}`,
    });
  const checkObject = (value: JsonValue, valueObjectName: string, path: string) => {
    const valueObject = input.types.nodes.get(valueObjectName);
    const declared = input.types.declaredMembers.get(valueObjectName);
    if (valueObject === undefined || declared === undefined) {
      throw new InternalError(
        `Field "${path}" is typed by the value object "${valueObjectName}", which the contract does not declare.`,
      );
    }
    if (!isJsonObject(value)) {
      shape(path, `a value of "${valueObjectName}" is a JSON object, not ${jsonKind(value)}`);
      return;
    }
    for (const key of Object.keys(value)) {
      if (!declared.has(key)) shape(path, `"${key}" is not a member of "${valueObjectName}"`);
    }
    for (const member of valueObject.fields) {
      checkMember(value[member.fieldName], member, `${path}.${member.fieldName}`);
    }
  };

  const checkMember = (
    value: JsonValue | undefined,
    member: ScalarMemberNode | ValueObjectMemberNode,
    path: string,
  ) => {
    if (value === undefined) {
      if (!member.nullable)
        shape(path, 'the member is required, and the default has no value for it');
      return;
    }
    if (value === null && member.nullable) return;
    if (member.many === true) {
      if (!Array.isArray(value)) {
        shape(path, `the member is a list, so its value is a JSON array, not ${jsonKind(value)}`);
        return;
      }
      for (const [index, element] of value.entries()) {
        checkOne(element, member, `${path}[${index}]`, 'an element of the member is not null');
      }
      return;
    }
    checkOne(value, member, path, 'the member is not optional, so its value is not null');
  };

  const checkOne = (
    value: JsonValue,
    member: ScalarMemberNode | ValueObjectMemberNode,
    path: string,
    notNull: string,
  ) => {
    if (isValueObjectMember(member)) {
      if (value === null) shape(path, notNull);
      else checkObject(value, member.valueObjectName, path);
      return;
    }
    const reading = readStoredValue({
      value,
      column: member.descriptor,
      codecLookup: input.codecLookup,
      dataTypeLookup: input.dataTypeLookup,
      fieldPath: path,
    });
    if (!reading.ok) {
      if (value === null) shape(path, notNull);
      else mismatches.push({ code: reading.code, message: reading.message });
      return;
    }
    const enumMismatch = enumValueMismatch(value, member, path, input.codecLookup);
    if (enumMismatch !== undefined) mismatches.push(enumMismatch);
  };

  if (input.value === null) {
    if (input.nullable) return mismatches;
    shape(
      input.fieldPath,
      input.list
        ? 'the default of a list of value objects is a JSON array, not null'
        : 'the default of a value object is a JSON object, not null',
    );
    return mismatches;
  }
  if (input.list) {
    if (!Array.isArray(input.value)) {
      shape(
        input.fieldPath,
        `the default of a list of value objects is a JSON array, not ${jsonKind(input.value)}`,
      );
      return mismatches;
    }
    for (const [index, element] of input.value.entries()) {
      checkObject(element, input.valueObjectName, `${input.fieldPath}[${index}]`);
    }
    return mismatches;
  }
  if (!isJsonObject(input.value)) {
    shape(
      input.fieldPath,
      `the default of a value object is a JSON object, not ${jsonKind(input.value)}`,
    );
    return mismatches;
  }
  checkObject(input.value, input.valueObjectName, input.fieldPath);
  return mismatches;
}

/**
 * A member typed by an enum takes only the enum's values, in the form its codec stores them, as a model field of that enum takes only its members.
 */
function enumValueMismatch(
  value: JsonValue,
  member: ScalarMemberNode,
  path: string,
  codecLookup: CodecLookupWithDescriptors | undefined,
): ValueObjectDefaultMismatch | undefined {
  const handle = member.enumTypeHandle;
  if (handle === undefined) return undefined;
  const codec = codecLookup?.get(handle.codecId);
  const stored = handle.values.map((enumValue) =>
    codec === undefined ? enumValue : codec.encodeJson(enumValue),
  );
  if (stored.some((storedValue) => storedValue === value)) return undefined;
  return {
    code: PSL_INVALID_DEFAULT_LITERAL,
    message: `Field "${path}": Expected one of: ${stored.map((storedValue) => JSON.stringify(storedValue)).join(' | ')}`,
  };
}

function isJsonObject(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jsonKind(value: JsonValue): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a JSON array';
  if (typeof value === 'object') return 'a JSON object';
  return `a JSON ${typeof value}`;
}
