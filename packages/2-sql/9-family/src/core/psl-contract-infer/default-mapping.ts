/**
 * Writing a stored default back as the PSL literal the column takes.
 *
 * The inverse of reading one. The stored canonical form is classified with the same rules a written
 * value uses — a number or numeral text through the target's classifier, a document or text through
 * the entry that owns that syntax — and the column's data type must be the classified type or
 * declare a cast from it. The text is then printed with the classified type's authoring entry and
 * read straight back through that entry and the same cast, so a literal that would not come back as
 * the stored value never reaches the schema. ADR 254.
 */

import type {
  ColumnDefault,
  ColumnDefaultLiteralInputValue,
  JsonValue,
} from '@internal/contract/types';
import type {
  AuthoringDataTypeEntry,
  DataTypeAuthoringEntry,
} from '@internal/framework-components/authoring';
import { isDataTypeLoweringEntry } from '@internal/framework-components/authoring';
import type { DataTypeId, DataTypeLookup } from '@internal/framework-components/codec';
import { dataTypeId } from '@internal/framework-components/codec';
import { escapePslString, numeralText } from '@internal/sql-relational-core/ast';

const DEFAULT_FUNCTION_ATTRIBUTES: Readonly<Record<string, string>> = {
  'autoincrement()': '@default(autoincrement())',
  'now()': '@default(now())',
};

export interface DefaultMappingOptions {
  readonly functionAttributes?: Readonly<Record<string, string>>;
  readonly fallbackFunctionAttribute?: ((expression: string) => string | undefined) | undefined;
  /** PSL support for the stack's data types, keyed by data type id. */
  readonly dataTypeEntries?: Readonly<Record<string, AuthoringDataTypeEntry>> | undefined;
  /** The stack's data types, whose casts say which other types' values each one takes. */
  readonly dataTypes?: DataTypeLookup | undefined;
  /** The data type of the column's codec. */
  readonly columnDataType?: DataTypeId | undefined;
  /**
   * Whether the column is a list, whose elements each carry the column's own data type. A written
   * list on a scalar column goes through that type's list cast instead.
   */
  readonly list?: boolean;
}

export type DefaultMappingResult = { readonly attribute: string } | { readonly comment: string };

export function mapDefault(
  columnDefault: ColumnDefault,
  options?: DefaultMappingOptions,
): DefaultMappingResult {
  switch (columnDefault.kind) {
    case 'literal': {
      const text = writeDefaultLiteral(columnDefault.value, options);
      return text === undefined
        ? { comment: `// Literal default: ${JSON.stringify(columnDefault.value)}` }
        : { attribute: `@default(${text})` };
    }
    case 'function': {
      const attribute =
        options?.functionAttributes?.[columnDefault.expression] ??
        DEFAULT_FUNCTION_ATTRIBUTES[columnDefault.expression] ??
        options?.fallbackFunctionAttribute?.(columnDefault.expression);
      return attribute
        ? { attribute }
        : { comment: `// Raw default: ${columnDefault.expression.replace(/[\r\n]+/g, ' ')}` };
    }
  }
}

/** One data type's value in the form its own authoring entry reads and writes. */
interface TypedValue {
  readonly type: DataTypeId;
  readonly value: JsonValue;
}

/**
 * The authoring entries the printer reads, arranged by what it has to look up: the entry that owns
 * each type, the one classifier, and the types reachable from each written form.
 */
interface WritingSurface {
  readonly entryOf: ReadonlyMap<string, DataTypeAuthoringEntry>;
  readonly classify: ((text: string) => TypedValue | undefined) | undefined;
  readonly plainStringType: DataTypeId | undefined;
  readonly plainBooleanType: DataTypeId | undefined;
  readonly tagTypes: readonly DataTypeId[];
}

function writingSurface(entries: Readonly<Record<string, AuthoringDataTypeEntry>>): WritingSurface {
  const entryOf = new Map<string, DataTypeAuthoringEntry>();
  let classify: ((text: string) => TypedValue | undefined) | undefined;
  let plainStringType: DataTypeId | undefined;
  let plainBooleanType: DataTypeId | undefined;
  const tagTypes: DataTypeId[] = [];
  for (const [key, entry] of Object.entries(entries)) {
    if (isDataTypeLoweringEntry(entry)) continue;
    const written = entry.written;
    if (written.kind === 'tag') {
      entryOf.set(key, entry);
      tagTypes.push(dataTypeId(key));
      continue;
    }
    if (written.syntax === 'number') {
      classify = written.classify;
      for (const type of written.types) entryOf.set(type, entry);
      continue;
    }
    entryOf.set(key, entry);
    if (written.syntax === 'string') plainStringType = dataTypeId(key);
    else plainBooleanType = dataTypeId(key);
  }
  return { entryOf, classify, plainStringType, plainBooleanType, tagTypes };
}

/**
 * Every type the stored form could be a value of, in the order a written value would be read: a
 * number or numeral text through the classifier first, then the plain syntax that matches the
 * shape, then each tag, whose canonical form is a whole document.
 */
function classifications(value: JsonValue, surface: WritingSurface): readonly TypedValue[] {
  const found: TypedValue[] = [];
  if (typeof value === 'number') {
    const classified = surface.classify?.(numeralText(value));
    return classified === undefined ? [] : [classified];
  }
  if (typeof value === 'boolean') {
    return surface.plainBooleanType === undefined
      ? []
      : [{ type: surface.plainBooleanType, value }];
  }
  if (typeof value === 'string') {
    const classified = surface.classify?.(value);
    if (classified !== undefined) found.push(classified);
    if (surface.plainStringType !== undefined) found.push({ type: surface.plainStringType, value });
  }
  for (const type of surface.tagTypes) found.push({ type, value });
  return found;
}

/** The stored form the column takes this value as, or `undefined` when its type takes no such value. */
function admitted(
  candidate: TypedValue,
  columnDataType: DataTypeId,
  dataTypes: DataTypeLookup,
): JsonValue | undefined {
  if (candidate.type === columnDataType) return candidate.value;
  const cast = dataTypes.get(columnDataType)?.casts[candidate.type];
  if (cast === undefined) return undefined;
  try {
    return cast(candidate.value);
  } catch {
    return undefined;
  }
}

/** The body of the literal: what the entry prints, before the syntax that fences it. */
function printedBody(entry: DataTypeAuthoringEntry, value: JsonValue): string | undefined {
  try {
    return entry.print(value);
  } catch {
    return undefined;
  }
}

/** What the entry reads the printed body back as, which for a number is the classifier's answer. */
function readBack(
  entry: DataTypeAuthoringEntry,
  type: DataTypeId,
  body: string,
): TypedValue | undefined {
  const written = entry.written;
  try {
    return written.kind === 'plain' && written.syntax === 'number'
      ? written.classify(body)
      : { type, value: written.parse(body) };
  } catch {
    return undefined;
  }
}

/**
 * The literal as PSL source. A tag body sits inside a backtick fence, which resolves `` \` `` and
 * `\\` and nothing else, so a `\n` in the body survives as the two characters the entry wrote.
 */
function literalText(entry: DataTypeAuthoringEntry, body: string): string {
  const written = entry.written;
  if (written.kind === 'tag') {
    const fenced = body.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
    return `${written.tag}\`${fenced}\``;
  }
  return written.syntax === 'string' ? `"${escapePslString(body)}"` : body;
}

/** One element of a written list: its source text and the canonical form the list cast receives. */
interface WrittenElement {
  readonly text: string;
  readonly value: JsonValue;
}

/**
 * The value written as the literal of one of its types, proven by reading the text straight back:
 * the same entry, the same cast, and the stored form again.
 */
function writeScalar(
  value: JsonValue,
  columnDataType: DataTypeId,
  dataTypes: DataTypeLookup,
  surface: WritingSurface,
): string | undefined {
  for (const candidate of classifications(value, surface)) {
    const entry = surface.entryOf.get(candidate.type);
    if (entry === undefined) continue;
    const stored = admitted(candidate, columnDataType, dataTypes);
    if (stored === undefined || !sameForm(stored, value)) continue;
    const body = printedBody(entry, candidate.value);
    if (body === undefined) continue;
    const reread = readBack(entry, candidate.type, body);
    if (reread === undefined) continue;
    const restored = admitted(reread, columnDataType, dataTypes);
    if (restored === undefined || !sameForm(restored, value)) continue;
    return literalText(entry, body);
  }
  return undefined;
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
    const body = printedBody(entry, candidate.value);
    if (body === undefined) continue;
    const reread = readBack(entry, candidate.type, body);
    if (reread === undefined || !of.includes(reread.type)) continue;
    return { text: literalText(entry, body), value: reread.value };
  }
  return undefined;
}

/**
 * A written list on a scalar column, which the column type's list cast turns into its one value.
 * Each element is classified on its own and must be of a type the cast takes.
 */
function writeListCast(
  value: readonly JsonValue[],
  columnDataType: DataTypeId,
  dataTypes: DataTypeLookup,
  surface: WritingSurface,
): string | undefined {
  const listCast = dataTypes.get(columnDataType)?.listCast;
  if (listCast === undefined) return undefined;
  const parts: string[] = [];
  const elements: JsonValue[] = [];
  for (const element of value) {
    const written = writeElement(element, listCast.of, surface);
    if (written === undefined) return undefined;
    parts.push(written.text);
    elements.push(written.value);
  }
  try {
    if (!sameForm(listCast.cast(elements), value)) return undefined;
  } catch {
    return undefined;
  }
  return `[${parts.join(', ')}]`;
}

function writeDefaultLiteral(
  value: ColumnDefaultLiteralInputValue,
  options: DefaultMappingOptions | undefined,
): string | undefined {
  if (value instanceof Date) return undefined;
  const { dataTypeEntries, dataTypes, columnDataType } = options ?? {};
  if (dataTypeEntries === undefined || dataTypes === undefined || columnDataType === undefined) {
    return undefined;
  }
  const surface = writingSurface(dataTypeEntries);
  if (options?.list === true) {
    if (!Array.isArray(value)) return undefined;
    const parts: string[] = [];
    for (const element of value) {
      const written = writeScalar(element, columnDataType, dataTypes, surface);
      if (written === undefined) return undefined;
      parts.push(written);
    }
    return `[${parts.join(', ')}]`;
  }
  const written = writeScalar(value, columnDataType, dataTypes, surface);
  if (written !== undefined) return written;
  return Array.isArray(value)
    ? writeListCast(value, columnDataType, dataTypes, surface)
    : undefined;
}

/** Whether two canonical forms are the same JSON value, member by member and element by element. */
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
