/**
 * Writing a stored default back as the PSL literal the column takes.
 *
 * The inverse of reading one. The stored form is read with the same functions a written value
 * takes, `readWrittenValue` and `castTypedValue`: a number or numeral text through the target's
 * number entry, a document or text through the entry that owns that syntax, each a value its type
 * constructs, and the column's data type must be that type or declare a cast from it. The text is
 * then printed with that type's authoring entry and read straight back the same way, so a literal
 * that would not come back as the stored value never reaches the contract source. ADR 254.
 */

import type {
  ColumnDefault,
  ColumnDefaultLiteralInputValue,
  JsonValue,
} from '@internal/contract/types';
import type {
  DataTypeAuthoringEntry,
  DataTypeSupport,
  WrittenScalar,
} from '@internal/framework-components/authoring';
import {
  castTypedValue,
  printTaggedLiteral,
  readWrittenValue,
} from '@internal/framework-components/authoring';
import type {
  CodecDescriptor,
  DataTypeId,
  DataTypeLookup,
  DataTypeParams,
  DataTypeValue,
} from '@internal/framework-components/codec';
import { dataTypeId, dataTypeParams } from '@internal/framework-components/codec';
import { numeralText } from '@internal/sql-contract/data-type';
import { escapePslString } from '@internal/sql-contract/data-type-support';
import { SQL_EXPRESSION_TAG } from '@internal/sql-contract/sql-expression';
import { isInternalError } from '@internal/utils/internal-error';

const DEFAULT_FUNCTION_ATTRIBUTES: Readonly<Record<string, string>> = {
  'autoincrement()': '@default(autoincrement())',
  'now()': '@default(now())',
};

export interface DefaultMappingOptions {
  readonly functionAttributes?: Readonly<Record<string, string>>;
  /** The stack's data types, whose casts say which other types' values each one takes, with the authoring entries that write them. */
  readonly dataTypes?: DataTypeSupport | undefined;
  /** The column's codec, whose data type a default is written in. */
  readonly columnCodec?: Pick<CodecDescriptor, 'dataType'> | undefined;
  /** The column's type parameters, under which a shorter literal can read back as the stored value, as `-0.5` does on `numeric(65,30)`. */
  readonly typeParams?: unknown;
  /**
   * Whether the column is a list, whose elements each carry the column's own data type. A written
   * list on a scalar column goes through that type's list cast instead.
   */
  readonly list?: boolean;
}

export type DefaultMappingResult = { readonly attribute: string };

/**
 * The attribute a stored default prints as: a named function, a literal the column takes, or any
 * other expression as a `sql` literal. `undefined` when a literal has no written form. An expression
 * prints even when the literal would read back as different text: default expressions are compared
 * with case and whitespace ignored (`SqlColumnDefaultIR.isEqualTo`), and canonicalization changes only
 * whitespace (ADR 129).
 */
export function mapDefault(
  columnDefault: ColumnDefault,
  options?: DefaultMappingOptions,
): DefaultMappingResult | undefined {
  switch (columnDefault.kind) {
    case 'literal': {
      const text = writeDefaultLiteral(columnDefault.value, options);
      return text === undefined ? undefined : { attribute: `@default(${text})` };
    }
    case 'function': {
      const attribute =
        options?.functionAttributes?.[columnDefault.expression] ??
        DEFAULT_FUNCTION_ATTRIBUTES[columnDefault.expression] ??
        `@default(${printTaggedLiteral(SQL_EXPRESSION_TAG, columnDefault.expression)})`;
      return { attribute };
    }
  }
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

/** The column's data type with the parameters a written value is read under. */
interface ColumnType {
  readonly id: DataTypeId;
  readonly params: DataTypeParams;
}

/** What the column's type stores for `json` under the column's parameters, or `undefined` when it holds no such value. */
function storedUnder(
  json: JsonValue,
  column: ColumnType,
  lookup: DataTypeLookup,
): JsonValue | undefined {
  const type = lookup.get(column.id);
  if (type === undefined) return undefined;
  try {
    return type.toContract(type.valueFrom(json, column.params));
  } catch (error) {
    if (isInternalError(error)) throw error;
    return undefined;
  }
}

/** The stored form the column takes this value as, spelled as its parameters give it, or `undefined` when its type takes no such value. */
function admitted(
  candidate: DataTypeValue,
  column: ColumnType,
  surface: WritingSurface,
): JsonValue | undefined {
  const cast = castTypedValue(surface.support, column.id, column.params, candidate);
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
 * trailing fraction zeros the column's scale spells it with.
 */
function writeScalar(
  value: JsonValue,
  column: ColumnType,
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
    const stored = admitted(candidate, column, surface);
    if (stored === undefined || !sameForm(stored, value)) continue;
    const text = printedText(entry, candidate.value);
    if (text === undefined) continue;
    const reread = readBack(surface, entry, text);
    if (reread === undefined) continue;
    const restored = admitted(reread, column, surface);
    if (restored === undefined || !sameForm(restored, value)) continue;
    return literalText(entry, text);
  }
  return undefined;
}

const DECIMAL_WITH_FRACTION = /^-?\d+\.\d+$/;

function withoutTrailingFractionZeros(value: JsonValue): string | undefined {
  if (typeof value !== 'string' || !DECIMAL_WITH_FRACTION.test(value)) return undefined;
  const shortened = value.replace(/0+$/, '').replace(/\.$/, '');
  return shortened === value ? undefined : shortened;
}

/** One written element of a list, printed as a value of any type, with no column type to admit it. */
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
 * A written list on a scalar column, which the column type's list cast turns into its one value,
 * constructed by the column's type. Each element is classified on its own and must be of a type the
 * cast takes.
 */
function writeListCast(
  value: readonly JsonValue[],
  column: ColumnType,
  surface: WritingSurface,
): string | undefined {
  const listCast = surface.support.lookup.get(column.id)?.listCast;
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
  const stored = storedUnder(cast, column, surface.support.lookup);
  return stored !== undefined && sameForm(stored, value) ? `[${parts.join(', ')}]` : undefined;
}

function writeDefaultLiteral(
  value: ColumnDefaultLiteralInputValue,
  options: DefaultMappingOptions | undefined,
): string | undefined {
  if (value instanceof Date) return undefined;
  const { dataTypes, columnCodec } = options ?? {};
  if (dataTypes === undefined || columnCodec === undefined) return undefined;
  const { lookup } = dataTypes;
  const columnDataType = columnCodec.dataType;
  const columnType = lookup.get(columnDataType);
  const column: ColumnType = {
    id: columnDataType,
    params: columnType === undefined ? {} : dataTypeParams(columnType, options?.typeParams),
  };
  const surface = writingSurface(dataTypes);
  if (options?.list === true) {
    if (!Array.isArray(value)) return undefined;
    const parts: string[] = [];
    for (const element of value) {
      const written = writeScalar(element, column, surface);
      if (written === undefined) return undefined;
      parts.push(written);
    }
    return `[${parts.join(', ')}]`;
  }
  const written = writeScalar(value, column, surface);
  if (written !== undefined) return written;
  return Array.isArray(value) ? writeListCast(value, column, surface) : undefined;
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
