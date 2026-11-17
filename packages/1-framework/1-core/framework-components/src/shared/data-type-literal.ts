/**
 * Writing a stored value back as the PSL literal its data type takes.
 *
 * The inverse of reading one. The stored form is read with the same functions a written value
 * takes, `readWrittenValue` and `castTypedValue`: a number or numeral text through the target's
 * number entry, a document or text through the entry that owns that syntax, each a value its type
 * constructs, and the receiving data type must be that type or declare a cast from it. The text is
 * then printed with that type's authoring entry and read straight back the same way, so a literal
 * that would not come back as the stored value never reaches the contract source. ADR 254.
 */

import type { JsonValue } from '@internal/contract/types';
import { blindCast } from '@internal/utils/casts';
import { isInternalError } from '@internal/utils/internal-error';
import {
  type DataTypeId,
  type DataTypeLookup,
  type DataTypeParams,
  type DataTypeValue,
  dataTypeId,
  dataTypeParams,
} from './data-type';
import type {
  AuthoringArgumentDescriptor,
  AuthoringTypeConstructorDescriptor,
  DataTypeAuthoringEntry,
} from './framework-authoring';
import { numeralText } from './numeral-text';
import { printTaggedLiteral } from './tagged-literal';
import {
  castTypedValue,
  type DataTypeSupport,
  readWrittenValue,
  type WrittenScalar,
} from './written-value';

/** What a value is written for: the data type that receives it, that type's parameters, and whether it is a list. */
export interface TypedLiteralOptions {
  /** The stack's data types, whose casts say which other types' values each one takes, with the authoring entries that write them. */
  readonly dataTypes?: DataTypeSupport | undefined;
  /** The data type the value is written in. */
  readonly dataType?: DataTypeId | undefined;
  /** The receiving type's parameters, under which a shorter literal can read back as the stored value, as `-0.5` does on `numeric(65,30)`. */
  readonly typeParams?: unknown;
  /**
   * Whether the value is a list whose elements each carry the receiving data type. Otherwise a
   * written list goes through that type's list cast.
   */
  readonly list?: boolean;
}

/** A string as a contract source writes it, with the escapes its string reader resolves. */
function escapePslString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/**
 * The authoring entries the printer reads, arranged by what it has to look up: the entry that owns
 * each type, and the types each tag writes.
 */
interface WritingSurface {
  readonly support: DataTypeSupport;
  readonly entryOf: ReadonlyMap<string, DataTypeAuthoringEntry>;
  readonly tagTypes: readonly DataTypeId[];
}

function writingSurface(support: DataTypeSupport): WritingSurface {
  const entryOf = new Map<string, DataTypeAuthoringEntry>();
  const tagTypes: DataTypeId[] = [];
  for (const [key, entry] of Object.entries(support.entries)) {
    const written = entry.written;
    if (written.kind === 'tag') {
      const type = dataTypeId(key);
      if (!entryOf.has(type)) entryOf.set(type, entry);
      tagTypes.push(type);
      continue;
    }
    if (written.syntax === 'number') {
      for (const type of written.types) entryOf.set(type, entry);
      continue;
    }
    entryOf.set(key, entry);
  }
  return { support, entryOf, tagTypes };
}

function readValue(surface: WritingSurface, written: WrittenScalar): DataTypeValue | undefined {
  const read = readWrittenValue(surface.support, written);
  return read.ok ? read.value : undefined;
}

/** The value of a tag's type that a stored document is, constructed by that type. */
function tagValue(
  surface: WritingSurface,
  type: DataTypeId,
  value: JsonValue,
): DataTypeValue | undefined {
  try {
    return surface.support.lookup.get(type)?.valueFrom(value, {});
  } catch (error) {
    if (isInternalError(error)) throw error;
    return undefined;
  }
}

/**
 * Every value the stored form could be, in the order a written value would be read: a number or
 * numeral text through the number entry first, then the plain syntax that matches the shape, then
 * each tag, whose stored form is a whole document, which may itself be a number or a boolean.
 */
function classifications(value: JsonValue, surface: WritingSurface): readonly DataTypeValue[] {
  const found: (DataTypeValue | undefined)[] = [];
  if (typeof value === 'number') {
    found.push(readValue(surface, { kind: 'number', text: numeralText(value) }));
  } else if (typeof value === 'boolean') {
    found.push(readValue(surface, { kind: 'boolean', value }));
  } else if (typeof value === 'string') {
    found.push(readValue(surface, { kind: 'number', text: value }));
    found.push(readValue(surface, { kind: 'string', text: value }));
  }
  for (const type of surface.tagTypes) found.push(tagValue(surface, type, value));
  return found.filter((candidate) => candidate !== undefined);
}

/** The receiving data type with the parameters a written value is read under. */
interface ReceivingType {
  readonly id: DataTypeId;
  readonly params: DataTypeParams;
}

/** What the receiving type stores for `json` under its parameters, or `undefined` when it holds no such value. */
function storedUnder(
  json: JsonValue,
  receiver: ReceivingType,
  lookup: DataTypeLookup,
): JsonValue | undefined {
  const type = lookup.get(receiver.id);
  if (type === undefined) return undefined;
  try {
    return type.toContract(type.valueFrom(json, receiver.params));
  } catch (error) {
    if (isInternalError(error)) throw error;
    return undefined;
  }
}

/** The stored form the receiving type takes this value as, spelled as its parameters give it, or `undefined` when its type takes no such value. */
function admitted(
  candidate: DataTypeValue,
  receiver: ReceivingType,
  surface: WritingSurface,
): JsonValue | undefined {
  const cast = castTypedValue(surface.support, receiver.id, receiver.params, candidate);
  return cast.ok ? cast.value.value : undefined;
}

/** The text of the literal: what the entry prints, before the syntax that fences it. */
function printedText(entry: DataTypeAuthoringEntry, value: JsonValue): string | undefined {
  try {
    return entry.print(value);
  } catch {
    return undefined;
  }
}

/** The printed text as the entry's syntax writes it, for reading back. */
function writtenAs(entry: DataTypeAuthoringEntry, text: string): WrittenScalar | undefined {
  const written = entry.written;
  if (written.kind === 'tag') return { kind: 'tag', tag: written.tag, text };
  if (written.syntax !== 'boolean') return { kind: written.syntax, text };
  return text === 'true' || text === 'false'
    ? { kind: 'boolean', value: text === 'true' }
    : undefined;
}

/** What the printed text reads back as, through the same read a written value takes. */
function readBack(
  surface: WritingSurface,
  entry: DataTypeAuthoringEntry,
  text: string,
): DataTypeValue | undefined {
  const written = writtenAs(entry, text);
  return written === undefined ? undefined : readValue(surface, written);
}

function literalText(entry: DataTypeAuthoringEntry, text: string): string {
  const written = entry.written;
  if (written.kind === 'tag') return printTaggedLiteral(written.tag, text);
  return written.syntax === 'string' ? `"${escapePslString(text)}"` : text;
}

/** One element of a written list: its source text and the value the list cast receives. */
interface WrittenElement {
  readonly text: string;
  readonly value: JsonValue;
}

/**
 * The value written as the literal of one of its types, proven by reading the text straight back:
 * the same read, the same cast, and the stored form again. A number is tried first without the
 * trailing fraction zeros the receiving type's scale spells it with.
 */
function writeScalar(
  value: JsonValue,
  receiver: ReceivingType,
  surface: WritingSurface,
): string | undefined {
  const shortest = withoutTrailingFractionZeros(value);
  const candidates = [
    ...(shortest === undefined ? [] : classifications(shortest, surface)),
    ...classifications(value, surface),
  ];
  for (const candidate of candidates) {
    const entry = surface.entryOf.get(candidate.type);
    if (entry === undefined) continue;
    const stored = admitted(candidate, receiver, surface);
    if (stored === undefined || !sameForm(stored, value)) continue;
    const text = printedText(entry, candidate.value);
    if (text === undefined) continue;
    const reread = readBack(surface, entry, text);
    if (reread === undefined) continue;
    const restored = admitted(reread, receiver, surface);
    if (restored === undefined || !sameForm(restored, value)) continue;
    return literalText(entry, text);
  }
  return undefined;
}

/**
 * `value`, a value of `dataType` as `contract.json` stores it, written as the literal of a type that `dataType` takes, proven to read back as `value`: `255` for `pg/int4`, ``sql`"MyType"[]` `` for `sql/expression`. `undefined` when no literal reads back as it.
 */
export function writeDataTypeValue(
  value: JsonValue,
  dataType: DataTypeId,
  support: DataTypeSupport,
): string | undefined {
  return writeScalar(value, { id: dataType, params: {} }, writingSurface(support));
}

const DECIMAL_WITH_FRACTION = /^-?\d+\.\d+$/;

function withoutTrailingFractionZeros(value: JsonValue): string | undefined {
  if (typeof value !== 'string' || !DECIMAL_WITH_FRACTION.test(value)) return undefined;
  const shortened = value.replace(/0+$/, '').replace(/\.$/, '');
  return shortened === value ? undefined : shortened;
}

/** One written element of a list, printed as a value of any type, with no receiving type to admit it. */
function writeElement(
  value: JsonValue,
  of: readonly DataTypeId[],
  surface: WritingSurface,
): WrittenElement | undefined {
  for (const candidate of classifications(value, surface)) {
    if (!of.includes(candidate.type)) continue;
    const entry = surface.entryOf.get(candidate.type);
    if (entry === undefined) continue;
    const text = printedText(entry, candidate.value);
    if (text === undefined) continue;
    const reread = readBack(surface, entry, text);
    if (reread === undefined || !of.includes(reread.type)) continue;
    return { text: literalText(entry, text), value: reread.value };
  }
  return undefined;
}

/**
 * A written list for a scalar data type, which that type's list cast turns into its one value,
 * constructed by the type. Each element is classified on its own and must be of a type the
 * cast takes.
 */
function writeListCast(
  value: readonly JsonValue[],
  receiver: ReceivingType,
  surface: WritingSurface,
): string | undefined {
  const listCast = surface.support.lookup.get(receiver.id)?.listCast;
  if (listCast === undefined) return undefined;
  const parts: string[] = [];
  const elements: JsonValue[] = [];
  for (const element of value) {
    const written = writeElement(element, listCast.of, surface);
    if (written === undefined) return undefined;
    parts.push(written.text);
    elements.push(written.value);
  }
  let cast: JsonValue;
  try {
    cast = listCast.cast(elements);
  } catch (error) {
    if (isInternalError(error)) throw error;
    return undefined;
  }
  const stored = storedUnder(cast, receiver, surface.support.lookup);
  return stored !== undefined && sameForm(stored, value) ? `[${parts.join(', ')}]` : undefined;
}

/** The PSL literal a stored value is written as for the data type `options` describe, or `undefined` when it has no written form that reads back as that value. */
export function writeTypedLiteral(
  value: JsonValue | Date,
  options: TypedLiteralOptions | undefined,
): string | undefined {
  if (value instanceof Date) return undefined;
  const { dataTypes, dataType } = options ?? {};
  if (dataTypes === undefined || dataType === undefined) return undefined;
  const { lookup } = dataTypes;
  const receivingType = lookup.get(dataType);
  const receiver: ReceivingType = {
    id: dataType,
    params: receivingType === undefined ? {} : dataTypeParams(receivingType, options?.typeParams),
  };
  const surface = writingSurface(dataTypes);
  if (options?.list === true) {
    if (!Array.isArray(value)) return undefined;
    const parts: string[] = [];
    for (const element of value) {
      const written = writeScalar(element, receiver, surface);
      if (written === undefined) return undefined;
      parts.push(written);
    }
    return `[${parts.join(', ')}]`;
  }
  const written = writeScalar(value, receiver, surface);
  if (written !== undefined) return written;
  return Array.isArray(value) ? writeListCast(value, receiver, surface) : undefined;
}

/** Whether two stored forms are the same JSON value, member by member and element by element. */
function sameForm(left: JsonValue, right: JsonValue): boolean {
  if (left === right) return true;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) {
    return false;
  }
  const members = Object.entries(left);
  const others = new Map(Object.entries(right));
  return (
    members.length === others.size &&
    members.every(([key, member]) => {
      const other = others.get(key);
      return other !== undefined && sameForm(member, other);
    })
  );
}

/** A value argument of a type constructor, written as a literal of its data type. */
function writtenArgument(
  argument: AuthoringArgumentDescriptor,
  value: unknown,
  dataTypes: DataTypeSupport,
): string | undefined {
  return writeDataTypeValue(
    blindCast<
      JsonValue,
      'a type constructor argument is a type parameter, which contract.json stores as JSON'
    >(value),
    dataTypeId(argument.dataType),
    dataTypes,
  );
}

/**
 * Each argument of a call to `descriptor` as PSL writes it: a value argument as a literal of its data type that reads back as the same value. `undefined` when an argument is not a value argument or no literal reads back as it.
 */
export function writtenTypeArguments(
  descriptor: AuthoringTypeConstructorDescriptor,
  args: readonly unknown[],
  dataTypes: DataTypeSupport,
): readonly string[] | undefined {
  const written: string[] = [];
  for (const [index, value] of args.entries()) {
    const argument = descriptor.args?.[index];
    const text = argument && writtenArgument(argument, value, dataTypes);
    if (text === undefined) return undefined;
    written.push(text);
  }
  return written;
}

/**
 * The call to the type constructor `descriptor` at `path` as PSL writes it, with each argument that has a value written by its name as a literal of its data type, and the bare path when none has one. `undefined` when no literal reads back as one of the values.
 */
export function writtenTypeConstructorCall(
  path: readonly string[],
  descriptor: AuthoringTypeConstructorDescriptor,
  args: readonly unknown[],
  dataTypes: DataTypeSupport,
): string | undefined {
  const written: string[] = [];
  for (const [index, argument] of (descriptor.args ?? []).entries()) {
    const value = args[index];
    if (value === undefined) continue;
    const text = writtenArgument(argument, value, dataTypes);
    if (text === undefined) return undefined;
    written.push(argument.name === undefined ? text : `${argument.name}: ${text}`);
  }
  const name = path.join('.');
  return written.length === 0 ? name : `${name}(${written.join(', ')})`;
}
