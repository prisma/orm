/**
 * Checking a value-object field's literal default against its composite type. The default is one
 * JSON value of the field's column; it must have the shape of the value object, or of a list of
 * them, and each member's value must be a value of the member's type.
 */

import type { JsonValue } from '@internal/contract/types';
import type { CodecLookup, DataTypeId } from '@internal/framework-components/codec';
import {
  isValueObjectMember,
  type ScalarMemberNode,
  type ValueObjectMemberNode,
  type ValueObjectNode,
} from '@internal/sql-contract-ts/contract-builder';
import { InternalError } from '@internal/utils/internal-error';
import {
  type DataTypeSupport,
  type DefaultColumn,
  lowerDataTypeDefault,
  type WrittenValue,
} from './data-type-default';

export interface ValueObjectDefaultInput {
  /** `Model.field`, the start of every path a mismatch names. */
  readonly fieldPath: string;
  readonly value: JsonValue;
  readonly list: boolean;
  readonly valueObjectName: string;
  readonly valueObjects: ReadonlyMap<string, ValueObjectNode>;
  /** The descriptor of the one column the value object is stored in. */
  readonly column: DefaultColumn;
  readonly codecLookup: CodecLookup | undefined;
  readonly support: DataTypeSupport;
}

/** Each way the default does not match the composite type, as a diagnostic message. */
export function valueObjectDefaultMismatches(input: ValueObjectDefaultInput): readonly string[] {
  const mismatches: string[] = [];
  const at = (path: string, message: string) => mismatches.push(`Field "${path}": ${message}`);
  const documentType = dataTypeOf(input.column.codecId, input);

  const checkObject = (value: JsonValue, valueObjectName: string, path: string) => {
    const valueObject = input.valueObjects.get(valueObjectName);
    if (valueObject === undefined) {
      throw new InternalError(
        `Field "${path}" is typed by the value object "${valueObjectName}", which the contract does not declare.`,
      );
    }
    if (!isJsonObject(value)) {
      at(path, `a value of "${valueObjectName}" is a JSON object, not ${jsonKind(value)}`);
      return;
    }
    const members = new Map(valueObject.fields.map((member) => [member.fieldName, member]));
    for (const key of Object.keys(value)) {
      if (!members.has(key)) at(path, `"${key}" is not a member of "${valueObjectName}"`);
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
    if (value === undefined || value === null) {
      if (member.nullable) return;
      at(
        path,
        value === undefined
          ? 'the member is required, and the default has no value for it'
          : 'the member is not optional, so its value is not null',
      );
      return;
    }
    if (member.many === true) {
      if (!Array.isArray(value)) {
        at(path, `the member is a list, so its value is a JSON array, not ${jsonKind(value)}`);
        return;
      }
      for (const [index, element] of value.entries())
        checkOne(element, member, `${path}[${index}]`);
      return;
    }
    checkOne(value, member, path);
  };

  const checkOne = (
    value: JsonValue,
    member: ScalarMemberNode | ValueObjectMemberNode,
    path: string,
  ) => {
    if (isValueObjectMember(member)) {
      checkObject(value, member.valueObjectName, path);
      return;
    }
    const mismatch = scalarMismatch(value, member.descriptor, documentType, path, input);
    if (mismatch !== undefined) mismatches.push(mismatch);
  };

  if (input.list) {
    if (!Array.isArray(input.value)) {
      at(
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
    at(
      input.fieldPath,
      `the default of a value object is a JSON object, not ${jsonKind(input.value)}`,
    );
    return mismatches;
  }
  checkObject(input.value, input.valueObjectName, input.fieldPath);
  return mismatches;
}

/**
 * Why a member's value is not a value of the member's scalar type. A string, number or boolean is read as the literal of that syntax, as a `@default` of a column of the member's type would be, and the type must store it as the same JSON kind. An object or array is part of the JSON document the value object is stored as, so the member's type must be that document's type or cast to or from it.
 */
function scalarMismatch(
  value: JsonValue,
  member: DefaultColumn,
  documentType: DataTypeId,
  path: string,
  input: ValueObjectDefaultInput,
): string | undefined {
  const written = writtenLiteral(value);
  if (written === undefined) {
    const memberType = dataTypeOf(member.codecId, input);
    if (
      memberType === documentType ||
      input.support.lookup.get(memberType)?.casts[documentType] !== undefined ||
      input.support.lookup.get(documentType)?.casts[memberType] !== undefined
    ) {
      return undefined;
    }
    return `Field "${path}": its type ${memberType} does not store ${jsonKind(value)}`;
  }
  const read = lowerDataTypeDefault({
    written,
    isList: false,
    column: member,
    codecLookup: input.codecLookup,
    support: input.support,
    fieldPath: path,
  });
  if (!read.ok) return read.message;
  if (jsonKind(read.value) === jsonKind(value)) return undefined;
  return `Field "${path}": its type stores ${jsonKind(read.value)}, not ${jsonKind(value)}`;
}

function writtenLiteral(value: JsonValue): WrittenValue | undefined {
  if (typeof value === 'string') return { kind: 'string', text: value };
  if (typeof value === 'boolean') return { kind: 'boolean', value };
  if (typeof value === 'number') return { kind: 'number', text: String(value) };
  return undefined;
}

function dataTypeOf(codecId: string, input: ValueObjectDefaultInput): DataTypeId {
  const descriptor = input.codecLookup?.descriptorFor?.(codecId);
  if (descriptor === undefined) {
    throw new InternalError(
      `No codec descriptor is registered for "${codecId}", but a value-object default was read through it.`,
    );
  }
  return descriptor.dataType;
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
