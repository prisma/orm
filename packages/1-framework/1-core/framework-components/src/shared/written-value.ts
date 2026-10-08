/**
 * The ADR 254 cast rule for one written value: the authoring entry for the syntax it is written in
 * reads it into a value of a data type, and the receiving type takes that value directly or
 * through a cast it declares. Family-blind; list casts stay with the family that reads lists.
 */

import type { JsonValue } from '@internal/contract/types';
import { isInternalError } from '@internal/utils/internal-error';
import { notOk, ok, type Result } from '@internal/utils/result';
import { type DataTypeId, type DataTypeLookup, dataTypeId } from './data-type';
import { authoringEntryType, type DataTypeAuthoringEntry } from './framework-authoring';
import { printedTaggedLiteralReadsBack, printTaggedLiteral } from './tagged-literal';

/** One written value, in the syntax a contract source wrote it in. The framework defines the list shape, and the family's default reader is the only reader of it. ADR 254. */
export type WrittenValue =
  | { readonly kind: 'tag'; readonly tag: string; readonly text: string }
  | { readonly kind: 'string'; readonly text: string }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'number'; readonly text: string }
  | { readonly kind: 'list'; readonly elements: readonly WrittenValue[] };

export type WrittenScalar = Exclude<WrittenValue, { readonly kind: 'list' }>;

/** A stack's registered data types with their authoring entries. */
export interface DataTypeSupport {
  readonly entries: Readonly<Record<string, DataTypeAuthoringEntry>>;
  readonly lookup: DataTypeLookup;
}

/** A value with its data type; `value` is the canonical form of `type`. */
export interface TypedValue {
  readonly type: DataTypeId;
  readonly value: JsonValue;
}

export type ReadRefusal =
  | { readonly kind: 'unreadable'; readonly message: string }
  | { readonly kind: 'unknown-tag'; readonly tag: string; readonly known: readonly string[] }
  | { readonly kind: 'unwritable'; readonly syntax: 'string' | 'boolean' | 'number' };

export type CastRefusal =
  | {
      readonly kind: 'no-cast';
      readonly receivingType: DataTypeId;
      readonly valueType: DataTypeId;
      readonly casts: readonly string[];
    }
  | { readonly kind: 'unreadable'; readonly message: string };

/** A cast-rule refusal worded for a diagnostic. */
export interface RefusalDescription {
  readonly code: 'PSL_UNKNOWN_LITERAL_TAG' | 'PSL_VALUE_TYPE_INCOMPATIBLE' | 'PSL_INVALID_LITERAL';
  readonly message: string;
}

/** A syntax a value is written in, with the phrase a diagnostic names it by. */
export type WrittenForm =
  | { readonly kind: 'tag'; readonly tag: string; readonly phrase: string }
  | { readonly kind: 'string' | 'boolean' | 'number'; readonly phrase: string };

/** What a refusal tells the author to write: the forms the position admits, and an exact rewrite of the written value when there is one. */
export interface RefusalGuidance {
  /** Each form the position admits, as {@link admittedForms} lists them. */
  readonly forms: readonly WrittenForm[];
  /** The written value rewritten in an admitted form, as in ``sql`8` ``. */
  readonly rewrite: string | undefined;
}

/**
 * Words a refusal of the cast rule. The message leads with what to write; the types are named only when the value has a form the position admits and its type is still refused, such as a number too large for the receiving type.
 */
export function describeRefusal(
  refusal: ReadRefusal | CastRefusal,
  support: DataTypeSupport,
  guidance: RefusalGuidance,
): RefusalDescription {
  switch (refusal.kind) {
    case 'unknown-tag':
      return {
        code: 'PSL_UNKNOWN_LITERAL_TAG',
        message: `Unknown literal tag "${refusal.tag}". Known tags: ${refusal.known.join(', ')}.`,
      };
    case 'unwritable':
      return {
        code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
        message: `${describeExpected(guidance.forms)}; this target has no data type for a ${refusal.syntax} value`,
      };
    case 'unreadable':
      return { code: 'PSL_INVALID_LITERAL', message: refusal.message };
    case 'no-cast':
      return {
        code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
        message: describeRefusedValueType(refusal, support, guidance),
      };
  }
}

/** `Expected <forms>`, the forms joined with `or`: the start of every refusal that says what to write. */
export function describeExpected(forms: readonly WrittenForm[]): string {
  return `Expected ${joinForms(forms)}`;
}

/**
 * Words a value of type `valueType` that `receivingType` refuses, where `guidance.forms` may be written. The types are named only when the value has one of those forms.
 */
export function describeRefusedValueType(
  refused: { readonly receivingType: DataTypeId; readonly valueType: DataTypeId },
  support: DataTypeSupport,
  guidance: RefusalGuidance,
): string {
  const expected = describeExpected(guidance.forms);
  const valueForm = writtenForm(support, refused.valueType);
  if (valueForm !== undefined && guidance.forms.some((form) => isSameForm(form, valueForm))) {
    return `${expected} that ${refused.receivingType} can hold; got ${refused.valueType}`;
  }
  return guidance.rewrite === undefined ? expected : `${expected}; write ${guidance.rewrite}`;
}

function isSameForm(a: WrittenForm, b: WrittenForm): boolean {
  return a.kind === 'tag' && b.kind === 'tag' ? a.tag === b.tag : a.kind === b.kind;
}

/**
 * The literal to write in place of a quoted string that `receivingType` refuses: the string as a literal of the first tag the type admits. `undefined` when the value is not a quoted string, the type admits no tag, the literal would not read back as the same text, or the type would refuse the literal too.
 */
export function exactRewrite(
  support: DataTypeSupport,
  receivingType: DataTypeId,
  written: WrittenScalar,
): string | undefined {
  const [tag] = admittedTags(support, receivingType);
  if (written.kind !== 'string' || tag === undefined) return undefined;
  if (!printedTaggedLiteralReadsBack(written.text)) return undefined;
  const read = readWrittenValue(support, { kind: 'tag', tag, text: written.text });
  if (!read.ok || !castTypedValue(support, receivingType, read.value).ok) return undefined;
  return printTaggedLiteral(tag, written.text);
}

interface FoundEntry {
  readonly key: string;
  readonly entry: DataTypeAuthoringEntry;
}

function findEntry(
  support: DataTypeSupport,
  matches: (entry: DataTypeAuthoringEntry) => boolean,
): FoundEntry | undefined {
  for (const [key, entry] of Object.entries(support.entries)) {
    if (matches(entry)) return { key, entry };
  }
  return undefined;
}

/** The entry a tag names, or `undefined` when no pack registered that tag. */
export function entryForTag(support: DataTypeSupport, tag: string): FoundEntry | undefined {
  return findEntry(support, ({ written }) => written.kind === 'tag' && written.tag === tag);
}

/** The entry that reads a plain string, boolean or number, or `undefined` when none does. */
export function entryForPlain(
  support: DataTypeSupport,
  syntax: 'string' | 'boolean' | 'number',
): FoundEntry | undefined {
  return findEntry(support, ({ written }) => written.kind === 'plain' && written.syntax === syntax);
}

/** Every tag a stack registers, in the order the entries were merged. */
export function knownTags(support: DataTypeSupport): readonly string[] {
  return Object.values(support.entries).flatMap((entry) =>
    entry.written.kind === 'tag' ? [entry.written.tag] : [],
  );
}

function textOf(written: WrittenScalar): string {
  return written.kind === 'boolean' ? String(written.value) : written.text;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Read one written value through the authoring entry for its syntax. */
export function readWrittenValue(
  support: DataTypeSupport,
  written: WrittenScalar,
): Result<TypedValue, ReadRefusal> {
  const found =
    written.kind === 'tag'
      ? entryForTag(support, written.tag)
      : entryForPlain(support, written.kind);
  if (found === undefined) {
    return written.kind === 'tag'
      ? notOk({ kind: 'unknown-tag', tag: written.tag, known: knownTags(support) })
      : notOk({ kind: 'unwritable', syntax: written.kind });
  }

  const text = textOf(written);
  const form = found.entry.written;
  if (form.kind === 'plain' && form.syntax === 'number') {
    const classified = form.classify(text);
    return classified === undefined
      ? notOk({
          kind: 'unreadable',
          message: `no data type of this target holds the number ${text}`,
        })
      : ok(classified);
  }
  try {
    return ok({
      type: dataTypeId(authoringEntryType(found.key, found.entry)),
      value: form.parse(text),
    });
  } catch (error) {
    if (isInternalError(error)) throw error;
    return notOk({ kind: 'unreadable', message: messageOf(error) });
  }
}

/** Take a typed value into the receiving type, directly or through the cast that type declares. */
export function castTypedValue(
  support: DataTypeSupport,
  receivingType: DataTypeId,
  typed: TypedValue,
): Result<TypedValue, CastRefusal> {
  if (typed.type === receivingType) return ok({ type: receivingType, value: typed.value });
  const declaration = support.lookup.get(receivingType);
  const cast = declaration?.casts[typed.type];
  if (cast === undefined) {
    return notOk({
      kind: 'no-cast',
      receivingType,
      valueType: typed.type,
      casts: Object.keys(declaration?.casts ?? {}),
    });
  }
  try {
    return ok({ type: receivingType, value: cast(typed.value) });
  } catch (error) {
    if (isInternalError(error)) throw error;
    return notOk({ kind: 'unreadable', message: messageOf(error) });
  }
}

/** The type itself, then each type it casts from, in key order. */
function admittedTypes(support: DataTypeSupport, dataType: DataTypeId): readonly string[] {
  return [dataType, ...Object.keys(support.lookup.get(dataType)?.casts ?? {})];
}

/** The tags a position of `dataType` admits: its own tag, then the tags of the types it casts from. */
export function admittedTags(support: DataTypeSupport, dataType: DataTypeId): readonly string[] {
  const tags = admittedTypes(support, dataType).flatMap((type) => {
    const written = support.entries[type]?.written;
    return written?.kind === 'tag' ? [written.tag] : [];
  });
  return [...new Set(tags)];
}

/** The form a value of a tagged literal's type is written in. */
export function tagForm(tag: string): WrittenForm {
  return { kind: 'tag', tag, phrase: `${tag}\`...\`` };
}

const PLAIN_PHRASES = {
  string: 'a quoted string',
  boolean: 'true or false',
  number: 'a number',
} as const;

function writtenForm(support: DataTypeSupport, type: string): WrittenForm | undefined {
  const written = support.entries[type]?.written;
  if (written?.kind === 'tag') return tagForm(written.tag);
  if (written?.kind === 'plain' && written.syntax !== 'number') {
    return { kind: written.syntax, phrase: PLAIN_PHRASES[written.syntax] };
  }
  const isNumber = Object.entries(support.entries).some(
    ([key, entry]) =>
      entry.written.kind === 'plain' &&
      entry.written.syntax === 'number' &&
      (key === type || entry.written.types.some((listed) => listed === type)),
  );
  return isNumber ? { kind: 'number', phrase: PLAIN_PHRASES.number } : undefined;
}

/** What {@link describeAdmittedForms} returns for a type that nothing writes. */
const NO_WRITTEN_FORM = 'no written form';

/** Each form a position receiving every one of `receivingTypes` admits, once, in order: ``sql`...` ``, `true or false`. */
export function admittedForms(
  support: DataTypeSupport,
  receivingTypes: readonly DataTypeId[],
): readonly WrittenForm[] {
  const forms: WrittenForm[] = [];
  for (const type of receivingTypes.flatMap((receiving) => admittedTypes(support, receiving))) {
    const form = writtenForm(support, type);
    if (form !== undefined && !forms.some((listed) => isSameForm(listed, form))) forms.push(form);
  }
  return forms;
}

function joinForms(forms: readonly WrittenForm[]): string {
  return forms.length === 0 ? NO_WRITTEN_FORM : forms.map((form) => form.phrase).join(' or ');
}

/** How a position of `dataType` can be written, for a diagnostic: ``sql`...` ``, `true or false`. */
export function describeAdmittedForms(support: DataTypeSupport, dataType: DataTypeId): string {
  return joinForms(admittedForms(support, [dataType]));
}
