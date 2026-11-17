/**
 * The ADR 254 cast rule for one written value: the authoring entry for the syntax it is written in
 * reads it into a value of a data type, and the receiving type takes that value directly or
 * through a cast it declares. Family-blind.
 */

import type { JsonValue } from '@internal/contract/types';
import { InternalError, isInternalError } from '@internal/utils/internal-error';
import { notOk, ok, type Result } from '@internal/utils/result';
import type { CodecLookupWithDescriptors, CodecRef } from './codec-types';
import {
  type DataTypeId,
  type DataTypeLookup,
  type DataTypeParams,
  type DataTypeValue,
  dataTypeId,
  dataTypeParams,
} from './data-type';
import type { DataTypeAuthoringEntry } from './framework-authoring';
import { numeralText } from './numeral-text';
import { codecForRef } from './resolve-codec';
import { printedTaggedLiteralReadsBack, printTaggedLiteral } from './tagged-literal';

/** One written value, in the syntax a contract source wrote it in. ADR 254. */
export type WrittenValue =
  | { readonly kind: 'tag'; readonly tag: string; readonly text: string }
  | { readonly kind: 'string'; readonly text: string }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'number'; readonly text: string }
  | { readonly kind: 'list'; readonly elements: readonly WrittenValue[] };

export type WrittenScalar = Exclude<WrittenValue, { readonly kind: 'list' }>;

/** A stack's registered data types with their authoring entries, and the data type each of its codecs represents. */
export interface DataTypeSupport {
  readonly entries: Readonly<Record<string, DataTypeAuthoringEntry>>;
  readonly lookup: DataTypeLookup;
  readonly dataTypeOfCodec: (codecId: string) => DataTypeId | undefined;
  /** Every component's {@link AuthoringContributions.textDataTypes}, each once: the data types whose values are text. None when the stack names none. */
  readonly textDataTypes?: readonly DataTypeId[];
}

export type ReadRefusal =
  | { readonly kind: 'unreadable'; readonly message: string }
  | { readonly kind: 'unknown-tag'; readonly tag: string; readonly known: readonly string[] }
  | { readonly kind: 'unwritable'; readonly syntax: 'string' | 'boolean' | 'number' };

export type CastRefusal =
  | {
      readonly kind: 'no-cast';
      readonly receivingType: DataTypeId;
      /** The parameters the receiving position holds its value under. */
      readonly receivingParams: DataTypeParams;
      readonly valueType: DataTypeId;
      readonly casts: readonly string[];
    }
  | { readonly kind: 'unreadable'; readonly message: string }
  | {
      /** The receiving type does not hold the value under the receiving position's parameters. */
      readonly kind: 'refused-by-type';
      readonly receivingType: DataTypeId;
      readonly message: string;
    };

/** A cast-rule refusal worded for a diagnostic. */
export interface RefusalDescription {
  readonly code:
    | 'PSL_UNKNOWN_LITERAL_TAG'
    | 'PSL_VALUE_TYPE_INCOMPATIBLE'
    | 'PSL_INVALID_LITERAL'
    | 'PSL_VALUE_REFUSED';
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
    case 'refused-by-type':
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

/** Text a contract source reads as a number literal. */
const NUMBER_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$|^[+-]?(?:NaN|Infinity)$/;

const DECIMAL_TEXT = /^([+-]?)0*(\d*?)(?:\.(\d*?))?0*$/;

/** A decimal numeral in one form: no plus sign, no leading or trailing zeros, the sign of zero kept. Other text is itself. */
function canonicalNumber(text: string): string {
  const match = text.includes('.') ? DECIMAL_TEXT.exec(text) : /^([+-]?)0*(\d*)$/.exec(text);
  if (match === null) return text;
  const [, sign = '', whole = '', fraction = ''] = match;
  return `${sign === '-' ? '-' : ''}${whole === '' ? '0' : whole}${fraction === '' ? '' : `.${fraction}`}`;
}

/** Whether a stored value is the number `text` writes, digit for digit and with its sign, so writing the text unquoted stores what it says. */
function sameNumber(text: string, stored: JsonValue): boolean {
  const storedText =
    typeof stored === 'number'
      ? Object.is(stored, -0)
        ? '-0'
        : numeralText(stored)
      : typeof stored === 'string'
        ? stored
        : undefined;
  return storedText !== undefined && canonicalNumber(storedText) === canonicalNumber(text);
}

/**
 * The literal to write in place of a quoted string that `receivingType` refuses under `receivingParams`: the string as a literal of the first tag the type admits, or else the string's text unquoted, as a number or a boolean. `undefined` when the value is not a quoted string, no such literal reads back as the same text, the type would refuse each of them too, or the number the text writes would be stored as another number, as `-0` is stored without its sign or `9007199254740993` as the nearest double.
 */
export function exactRewrite(
  support: DataTypeSupport,
  receiving: { readonly receivingType: DataTypeId; readonly receivingParams: DataTypeParams },
  written: WrittenScalar,
): string | undefined {
  if (written.kind !== 'string') return undefined;
  const castOf = (candidate: WrittenScalar): DataTypeValue | undefined => {
    const read = readWrittenValue(support, candidate);
    if (!read.ok) return undefined;
    const cast = castTypedValue(
      support,
      receiving.receivingType,
      receiving.receivingParams,
      read.value,
    );
    return cast.ok ? cast.value : undefined;
  };
  const admits = (candidate: WrittenScalar): boolean => castOf(candidate) !== undefined;
  const [tag] = admittedTags(support, receiving.receivingType);
  if (
    tag !== undefined &&
    printedTaggedLiteralReadsBack(written.text) &&
    admits({ kind: 'tag', tag, text: written.text })
  ) {
    return printTaggedLiteral(tag, written.text);
  }
  if (NUMBER_TEXT.test(written.text)) {
    const stored = castOf({ kind: 'number', text: written.text });
    if (stored !== undefined && sameNumber(written.text, stored.value)) return written.text;
  }
  if (
    (written.text === 'true' || written.text === 'false') &&
    admits({ kind: 'boolean', value: written.text === 'true' })
  ) {
    return written.text;
  }
  return undefined;
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

/** The value of `type` that `json` gives under `params`, constructed by that type; a refusal is worded for a diagnostic. */
function valueOfType<F>(
  support: DataTypeSupport,
  type: DataTypeId,
  json: () => JsonValue,
  params: DataTypeParams,
  refuse: (message: string) => F,
): Result<DataTypeValue, F> {
  const declaration = support.lookup.get(type);
  if (declaration === undefined) {
    throw new InternalError(
      `A value of "${type}" was written, and this stack does not register it.`,
    );
  }
  try {
    return ok(declaration.valueFrom(json(), params));
  } catch (error) {
    if (isInternalError(error)) throw error;
    return notOk(refuse(messageOf(error)));
  }
}

/** Read one written value through the authoring entry for its syntax, as a value its type constructs. */
export function readWrittenValue(
  support: DataTypeSupport,
  written: WrittenScalar,
): Result<DataTypeValue, ReadRefusal> {
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
  const unreadable = (message: string): ReadRefusal => ({ kind: 'unreadable', message });
  if (form.kind === 'plain' && form.syntax === 'number') {
    const classified = form.classify(text);
    return classified === undefined
      ? notOk(unreadable(`no data type of this target holds the number ${text}`))
      : valueOfType(support, classified.type, () => classified.value, {}, unreadable);
  }
  return valueOfType(support, dataTypeId(found.key), () => form.parse(text), {}, unreadable);
}

/** Take a value into the receiving type, directly or through the cast that type declares; the receiving type constructs the result under `receivingParams`, the parameters of the position that receives it. */
export function castTypedValue(
  support: DataTypeSupport,
  receivingType: DataTypeId,
  receivingParams: DataTypeParams,
  value: DataTypeValue,
): Result<DataTypeValue, CastRefusal> {
  const refusedByType = (message: string): CastRefusal => ({
    kind: 'refused-by-type',
    receivingType,
    message,
  });
  if (value.type === receivingType) {
    return valueOfType(support, receivingType, () => value.value, receivingParams, refusedByType);
  }
  const declaration = support.lookup.get(receivingType);
  const cast = declaration?.casts[value.type];
  if (cast === undefined) {
    return notOk({
      kind: 'no-cast',
      receivingType,
      receivingParams,
      valueType: value.type,
      casts: Object.keys(declaration?.casts ?? {}),
    });
  }
  const source = support.lookup.get(value.type);
  if (source === undefined) {
    throw new InternalError(
      `A value of "${value.type}" was cast, and this stack does not register it.`,
    );
  }
  let json: JsonValue;
  try {
    json = cast(source.toContract(value));
  } catch (error) {
    if (isInternalError(error)) throw error;
    return notOk({ kind: 'unreadable', message: messageOf(error) });
  }
  return valueOfType(support, receivingType, () => json, receivingParams, refusedByType);
}

/**
 * Reads `written` as a value of `receivingType`: through the authoring entry for its syntax, then into `receivingType` directly or through a cast it declares. A refusal is worded for a diagnostic at the written value. The read every value of a fixed receiving type takes: an attribute argument, a type-constructor argument, and its TypeScript counterpart. ADR 254.
 */
export function readWrittenValueAs(
  support: DataTypeSupport,
  receivingType: DataTypeId,
  written: WrittenScalar,
): Result<DataTypeValue, RefusalDescription> {
  const forms = admittedForms(support, [receivingType]);
  const read = readWrittenValue(support, written);
  if (!read.ok) {
    return notOk(describeRefusal(read.failure, support, { forms, rewrite: undefined }));
  }
  const cast = castTypedValue(support, receivingType, {}, read.value);
  if (cast.ok) return cast;
  const rewrite = exactRewrite(support, { receivingType, receivingParams: {} }, written);
  return notOk(describeRefusal(cast.failure, support, { forms, rewrite }));
}

/**
 * Reads `written` into the codec `ref` names, built with `ref`'s type parameters: the authoring entry for its syntax reads it, the codec's data type takes it directly or through a cast, the data type constructs it under the type parameters, and the codec checks it. Returns the value as the data type stores it. A written list is read element by element into the element types of the data type's list cast, then through the list cast.
 *
 * A refusal is worded for a diagnostic, after `subject` and the element it is about, as in `enum "Ratio" member "Half" at element 2: Expected a number`: syntax no entry reads or a cast refuses is `PSL_INVALID_LITERAL`, a value of a type the data type neither is nor casts from is `PSL_VALUE_TYPE_INCOMPATIBLE`, and a value the data type under the type parameters or the codec refuses is `PSL_VALUE_REFUSED`. ADR 254.
 */
export function readWrittenValueIntoCodec(input: {
  readonly support: DataTypeSupport;
  readonly codecLookup: Pick<CodecLookupWithDescriptors, 'descriptorFor'>;
  readonly ref: CodecRef;
  readonly written: WrittenValue;
  readonly subject: string;
}): Result<JsonValue, RefusalDescription> {
  const { support, ref, written, subject } = input;
  const codec = codecForRef(input.codecLookup, ref);
  if (codec === undefined) {
    throw new InternalError(
      `${subject}: no codec descriptor is registered for "${ref.codecId}", but the value was read for it.`,
    );
  }
  const receivingType = codec.dataType.id;
  const receivingParams = dataTypeParams(codec.dataType, ref.typeParams);
  const refused = (
    elementIndex: number | undefined,
    { code, message }: RefusalDescription,
  ): Result<JsonValue, RefusalDescription> =>
    notOk({
      code,
      message: `${elementIndex === undefined ? subject : `${subject} at element ${elementIndex + 1}`}: ${message}`,
    });
  const stored = (json: JsonValue): Result<JsonValue, RefusalDescription> => {
    try {
      const value = codec.dataType.valueFrom(json, receivingParams);
      codec.fromDataTypeValue(value);
      return ok(codec.dataType.toContract(value));
    } catch (error) {
      if (isInternalError(error)) throw error;
      return refused(undefined, { code: 'PSL_VALUE_REFUSED', message: messageOf(error) });
    }
  };
  const forms = admittedForms(support, [receivingType]);

  if (written.kind === 'list') {
    const listCast = support.lookup.get(receivingType)?.listCast;
    if (listCast === undefined) {
      return refused(undefined, {
        code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
        message: `${describeExpected(forms)}; got a list`,
      });
    }
    const elementGuidance = { forms: admittedForms(support, listCast.of), rewrite: undefined };
    const elements: JsonValue[] = [];
    for (const [index, element] of written.elements.entries()) {
      if (element.kind === 'list') {
        return refused(index, {
          code: 'PSL_INVALID_LITERAL',
          message: 'a list holds values, not other lists',
        });
      }
      const read = readWrittenValue(support, element);
      if (!read.ok) return refused(index, describeRefusal(read.failure, support, elementGuidance));
      if (!listCast.of.includes(read.value.type)) {
        return refused(index, {
          code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
          message: describeRefusedValueType(
            { receivingType, valueType: read.value.type },
            support,
            elementGuidance,
          ),
        });
      }
      elements.push(read.value.value);
    }
    let json: JsonValue;
    try {
      json = listCast.cast(elements);
    } catch (error) {
      if (isInternalError(error)) throw error;
      return refused(undefined, { code: 'PSL_INVALID_LITERAL', message: messageOf(error) });
    }
    return stored(json);
  }

  const read = readWrittenValue(support, written);
  if (!read.ok) {
    return refused(
      undefined,
      describeRefusal(read.failure, support, { forms, rewrite: undefined }),
    );
  }
  const cast = castTypedValue(support, receivingType, receivingParams, read.value);
  if (cast.ok) return stored(cast.value.value);
  const { failure } = cast;
  if (failure.kind === 'refused-by-type') {
    return refused(undefined, { code: 'PSL_VALUE_REFUSED', message: failure.message });
  }
  const rewrite = failure.kind === 'no-cast' ? exactRewrite(support, failure, written) : undefined;
  return refused(undefined, describeRefusal(failure, support, { forms, rewrite }));
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
