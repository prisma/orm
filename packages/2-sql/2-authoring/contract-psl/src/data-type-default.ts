/**
 * Reading a `@default(...)` value: a written value is read by the authoring entry for the syntax it
 * is written in, which gives it a data type; the column's type takes it directly or through a cast;
 * the column's codec, built with the column's type parameters, reads it with `decodeJson`, which
 * refuses a value the column would not store; and it is stored in the canonical form of the
 * column's values, which `canonicalFormOf` gives.
 *
 * No per-type code and no per-codec branch live here. ADR 254.
 */

import type { JsonValue } from '@internal/contract/types';
import type { DataTypeAuthoringEntry } from '@internal/framework-components/authoring';
import { authoringEntryType } from '@internal/framework-components/authoring';
import type {
  AnyCodecDescriptor,
  CodecLookupWithDescriptors,
  DataTypeId,
  DataTypeLookup,
} from '@internal/framework-components/codec';
import {
  canonicalFormOf,
  codecForRef,
  type ToCanonicalForm,
} from '@internal/framework-components/codec';
import type { ContributedPslDiagnosticCode } from '@internal/framework-components/psl-ast';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError, isInternalError } from '@internal/utils/internal-error';

/** A written value the column's codec refuses. */
export const PSL_INVALID_DEFAULT_LITERAL: ContributedPslDiagnosticCode =
  'PSL_INVALID_DEFAULT_LITERAL';

/** A written value whose data type the receiving type neither is nor casts from. */
export const PSL_VALUE_TYPE_INCOMPATIBLE: ContributedPslDiagnosticCode =
  'PSL_VALUE_TYPE_INCOMPATIBLE';

/** A single value written as the default of a column that holds a list. */
export const PSL_DEFAULT_LIST_EXPECTED: ContributedPslDiagnosticCode = 'PSL_DEFAULT_LIST_EXPECTED';

/** One written value, in the syntax a contract source wrote it in. */
export type WrittenValue =
  | { readonly kind: 'tag'; readonly tag: string; readonly text: string }
  | { readonly kind: 'string'; readonly text: string }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'number'; readonly text: string }
  | { readonly kind: 'list'; readonly elements: readonly WrittenValue[] };

/** The assembled data types of a stack and the PSL support for them. */
export interface DataTypeSupport {
  readonly entries: Readonly<Record<string, DataTypeAuthoringEntry>>;
  readonly lookup: DataTypeLookup;
}

export interface DefaultColumn {
  readonly codecId: string;
  readonly typeParams?: Record<string, unknown> | undefined;
}

/** A value of a known data type: what an authoring entry reads written text into. */
interface TypedValue {
  readonly type: DataTypeId;
  readonly value: JsonValue;
}

/**
 * Why a default was refused, in parts, so each contract source words its own diagnostic: PSL says
 * `pg/int4 has no cast from pg/int8`, and the reader for the earlier schema language says what its
 * own users need to hear.
 */
export type DefaultRefusal = {
  /** Which element of a written list the refusal is about; `undefined` for the whole value. */
  readonly elementIndex: number | undefined;
} & (
  | { readonly kind: 'unreadable'; readonly message: string }
  | { readonly kind: 'unknown-tag'; readonly tag: string; readonly known: readonly string[] }
  | { readonly kind: 'unwritable'; readonly syntax: string }
  | { readonly kind: 'not-a-list' }
  | {
      readonly kind: 'no-cast';
      readonly columnType: string;
      readonly valueType: string;
      readonly casts: readonly string[];
    }
  | { readonly kind: 'refused-by-codec'; readonly codecId: string; readonly message: string }
);

export type ReadDefaultResult =
  | { readonly ok: true; readonly value: JsonValue }
  | { readonly ok: false; readonly refusal: DefaultRefusal };

export type DefaultDiagnosticResult =
  | { readonly ok: true; readonly value: JsonValue }
  | { readonly ok: false; readonly code: string; readonly message: string };

/** The entry a tag names, or `undefined` when no pack registered that tag. */
export function entryForTag(
  support: DataTypeSupport,
  tag: string,
): { readonly key: string; readonly entry: DataTypeAuthoringEntry } | undefined {
  for (const [key, entry] of Object.entries(support.entries)) {
    if (entry.written.kind === 'tag' && entry.written.tag === tag) return { key, entry };
  }
  return undefined;
}

/** Every tag a stack registers, in the order the entries were merged, for a diagnostic. */
export function knownTags(support: DataTypeSupport): readonly string[] {
  return Object.values(support.entries).flatMap((entry) =>
    entry.written.kind === 'tag' ? [entry.written.tag] : [],
  );
}

function entryForPlain(
  support: DataTypeSupport,
  syntax: 'string' | 'boolean' | 'number',
): { readonly key: string; readonly entry: DataTypeAuthoringEntry } | undefined {
  for (const [key, entry] of Object.entries(support.entries)) {
    if (entry.written.kind === 'plain' && entry.written.syntax === syntax) return { key, entry };
  }
  return undefined;
}

/** The text an entry reads: a tag's text, a string's value, or the word a boolean is written as. */
function plainText(written: Exclude<WrittenValue, { kind: 'list' }>): string {
  switch (written.kind) {
    case 'tag':
      return written.text;
    case 'string':
      return written.text;
    case 'boolean':
      return String(written.value);
    case 'number':
      return written.text;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Read one written value through the entry for its syntax. */
export function readValue(
  support: DataTypeSupport,
  written: Exclude<WrittenValue, { kind: 'list' }>,
  elementIndex: number | undefined,
):
  | { readonly ok: true; readonly typed: TypedValue }
  | { readonly ok: false; readonly refusal: DefaultRefusal } {
  type RefusalBody = DefaultRefusal extends infer R
    ? R extends { readonly elementIndex: number | undefined }
      ? Omit<R, 'elementIndex'>
      : never
    : never;
  const refuse = (refusal: RefusalBody) => ({
    ok: false as const,
    refusal: blindCast<DefaultRefusal, 'every refusal kind carries the same element index'>({
      ...refusal,
      elementIndex,
    }),
  });

  const found =
    written.kind === 'tag'
      ? entryForTag(support, written.tag)
      : entryForPlain(support, written.kind);
  if (found === undefined) {
    return written.kind === 'tag'
      ? refuse({ kind: 'unknown-tag', tag: written.tag, known: knownTags(support) })
      : refuse({ kind: 'unwritable', syntax: written.kind });
  }

  const form = found.entry.written;
  if (form.kind === 'plain' && form.syntax === 'number') {
    const text = plainText(written);
    const classified = form.classify(text);
    if (classified === undefined) {
      return refuse({
        kind: 'unreadable',
        message: `no data type of this target holds the number ${text}`,
      });
    }
    return { ok: true, typed: classified };
  }

  const text = plainText(written);
  try {
    return {
      ok: true,
      typed: {
        type: blindCast<DataTypeId, 'an entry reads its key’s type, or the type its tag names'>(
          authoringEntryType(found.key, found.entry),
        ),
        value: form.parse(text),
      },
    };
  } catch (error) {
    if (isInternalError(error)) throw error;
    return refuse({ kind: 'unreadable', message: messageOf(error) });
  }
}

/** Convert a value of one data type into the form another stores, when that type takes it. */
function castInto(
  support: DataTypeSupport,
  columnType: DataTypeId,
  typed: TypedValue,
  elementIndex: number | undefined,
): ReadDefaultResult {
  if (typed.type === columnType) return { ok: true, value: typed.value };
  const declaration = support.lookup.get(columnType);
  const cast = declaration?.casts[typed.type];
  if (cast === undefined) {
    return {
      ok: false,
      refusal: {
        kind: 'no-cast',
        columnType,
        valueType: typed.type,
        casts: Object.keys(declaration?.casts ?? {}),
        elementIndex,
      },
    };
  }
  try {
    return { ok: true, value: cast(typed.value) };
  } catch (error) {
    if (isInternalError(error)) throw error;
    return {
      ok: false,
      refusal: {
        kind: 'unreadable',
        message: messageOf(error),
        elementIndex,
      },
    };
  }
}

/** The column's `typeParams` as the codec reference carries them, so `vector(3)` checks its length. */
function codecRefTypeParams(
  typeParams: Record<string, unknown> | undefined,
): JsonValue | undefined {
  return typeParams === undefined
    ? undefined
    : blindCast<JsonValue, 'typeParams are read from PSL and validated by the codec paramsSchema'>(
        typeParams,
      );
}

/** A value in the canonical form of the column's values, when they have one. */
function inCanonicalForm(
  toCanonicalForm: ToCanonicalForm | undefined,
  value: JsonValue,
  elementIndex: number | undefined,
): ReadDefaultResult {
  if (toCanonicalForm === undefined) return { ok: true, value };
  try {
    return { ok: true, value: toCanonicalForm(value) };
  } catch (error) {
    if (isInternalError(error)) throw error;
    return { ok: false, refusal: { kind: 'unreadable', message: messageOf(error), elementIndex } };
  }
}

/**
 * The column's codec descriptor, and `read`, which reads a value in its stored JSON form with the column's codec, built with the column's type parameters, and gives it the canonical form of the column's values.
 */
function storedValueReader(input: {
  readonly column: DefaultColumn;
  readonly codecLookup: CodecLookupWithDescriptors | undefined;
  readonly dataTypeLookup: DataTypeLookup;
  readonly fieldPath: string;
}): {
  readonly descriptor: AnyCodecDescriptor;
  readonly read: (value: JsonValue, elementIndex: number | undefined) => ReadDefaultResult;
} {
  if (input.codecLookup === undefined) {
    throw new InternalError(
      `Field "${input.fieldPath}": no codec lookup was given, but the column was resolved from a codec descriptor.`,
    );
  }
  const descriptor = input.codecLookup.descriptorFor(input.column.codecId);
  const codec = codecForRef(input.codecLookup, {
    codecId: input.column.codecId,
    ...ifDefined('typeParams', codecRefTypeParams(input.column.typeParams)),
  });
  if (codec === undefined || descriptor === undefined) {
    throw new InternalError(
      `Field "${input.fieldPath}": no codec descriptor is registered for "${input.column.codecId}", but the column was resolved from one.`,
    );
  }
  const toCanonicalForm = canonicalFormOf(descriptor, input.dataTypeLookup);
  const read = (written: JsonValue, elementIndex: number | undefined): ReadDefaultResult => {
    try {
      codec.decodeJson(written);
    } catch (error) {
      if (isInternalError(error)) throw error;
      return {
        ok: false,
        refusal: {
          kind: 'refused-by-codec',
          codecId: input.column.codecId,
          message: messageOf(error),
          elementIndex,
        },
      };
    }
    return inCanonicalForm(toCanonicalForm, written, elementIndex);
  };
  return { descriptor, read };
}

/**
 * Reads a value already in its stored JSON form, such as one member of a JSON document default, with the column's codec. Worded as {@link lowerDataTypeDefault} words a codec refusal.
 */
export function readStoredValue(input: {
  readonly value: JsonValue;
  readonly column: DefaultColumn;
  readonly codecLookup: CodecLookupWithDescriptors | undefined;
  readonly dataTypeLookup: DataTypeLookup;
  readonly fieldPath: string;
}): DefaultDiagnosticResult {
  const reading = storedValueReader(input).read(input.value, undefined);
  return reading.ok ? reading : refusalDiagnostic(reading.refusal, `Field "${input.fieldPath}"`);
}

/**
 * Read one `@default(...)` value for a column, refusing in parts so each contract source words its
 * own diagnostic. `isList` selects the check: a list column's elements are each read and cast
 * against the element codec's data type, while a scalar column takes a written list only through
 * its type's list cast — which is how `pgvector.Vector(3) @default([0.1, 0.2])` is read.
 */
export function readDataTypeDefault(input: {
  readonly written: WrittenValue;
  readonly isList: boolean;
  readonly column: DefaultColumn;
  readonly codecLookup: CodecLookupWithDescriptors | undefined;
  readonly support: DataTypeSupport;
  readonly fieldPath: string;
}): ReadDefaultResult {
  const { descriptor, read: readStored } = storedValueReader({
    ...input,
    dataTypeLookup: input.support.lookup,
  });
  const columnType = descriptor.dataType;

  const readOne = (
    written: Exclude<WrittenValue, { kind: 'list' }>,
    elementIndex: number | undefined,
  ): ReadDefaultResult => {
    const read = readValue(input.support, written, elementIndex);
    if (!read.ok) return read;
    const cast = castInto(input.support, columnType, read.typed, elementIndex);
    if (!cast.ok) return cast;
    return readStored(cast.value, elementIndex);
  };

  if (input.written.kind !== 'list') {
    if (input.isList) {
      return { ok: false, refusal: { kind: 'not-a-list', elementIndex: undefined } };
    }
    return readOne(input.written, undefined);
  }

  if (input.isList) {
    const elements: JsonValue[] = [];
    for (const [elementIndex, written] of input.written.elements.entries()) {
      if (written.kind === 'list') {
        return {
          ok: false,
          refusal: {
            kind: 'unreadable',
            message: 'a list holds values, not other lists',
            elementIndex,
          },
        };
      }
      const element = readOne(written, elementIndex);
      if (!element.ok) return element;
      elements.push(element.value);
    }
    return { ok: true, value: elements };
  }

  return readListIntoScalar({ ...input, written: input.written, columnType, readStored });
}

/** A written list on a column that is not a list: the column's type takes it through its list cast. */
function readListIntoScalar(input: {
  readonly written: Extract<WrittenValue, { kind: 'list' }>;
  readonly support: DataTypeSupport;
  readonly columnType: DataTypeId;
  readonly readStored: (value: JsonValue, elementIndex: number | undefined) => ReadDefaultResult;
}): ReadDefaultResult {
  const listCast = input.support.lookup.get(input.columnType)?.listCast;
  if (listCast === undefined) {
    return {
      ok: false,
      refusal: {
        kind: 'no-cast',
        columnType: input.columnType,
        valueType: 'a list',
        casts: Object.keys(input.support.lookup.get(input.columnType)?.casts ?? {}),
        elementIndex: undefined,
      },
    };
  }

  const elements: JsonValue[] = [];
  for (const [elementIndex, written] of input.written.elements.entries()) {
    if (written.kind === 'list') {
      return {
        ok: false,
        refusal: {
          kind: 'unreadable',
          message: 'a list holds values, not other lists',
          elementIndex,
        },
      };
    }
    const read = readValue(input.support, written, elementIndex);
    if (!read.ok) return read;
    if (!listCast.of.includes(read.typed.type)) {
      return {
        ok: false,
        refusal: {
          kind: 'no-cast',
          columnType: input.columnType,
          valueType: read.typed.type,
          casts: [...listCast.of],
          elementIndex,
        },
      };
    }
    elements.push(read.typed.value);
  }

  try {
    return input.readStored(listCast.cast(elements), undefined);
  } catch (error) {
    if (isInternalError(error)) throw error;
    return {
      ok: false,
      refusal: {
        kind: 'unreadable',
        message: messageOf(error),
        elementIndex: undefined,
      },
    };
  }
}

/** Where in a written list a diagnostic is about, for a message: ` at element 2`. */
function at(elementIndex: number | undefined): string {
  return elementIndex === undefined ? '' : ` at element ${elementIndex + 1}`;
}

/** {@link readDataTypeDefault} worded as a PSL diagnostic's code and message. */
export function lowerDataTypeDefault(input: {
  readonly written: WrittenValue;
  readonly isList: boolean;
  readonly column: DefaultColumn;
  readonly codecLookup: CodecLookupWithDescriptors | undefined;
  readonly support: DataTypeSupport;
  readonly fieldPath: string;
}): DefaultDiagnosticResult {
  const read = readDataTypeDefault(input);
  return read.ok ? read : refusalDiagnostic(read.refusal, `Field "${input.fieldPath}"`);
}

/**
 * Reads one number literal written in a contract source outside a default, such as an enum member's value, from its source text for a codec, as {@link lowerDataTypeDefault} reads a default: the number's entry gives it a data type, the codec's data type takes it directly or through a cast, and the codec checks it. A refusal is worded for `subject`.
 */
export function readWrittenNumberForCodec(input: {
  readonly text: string;
  readonly codecId: string;
  readonly codecLookup: CodecLookupWithDescriptors | undefined;
  readonly support: DataTypeSupport;
  readonly subject: string;
}): DefaultDiagnosticResult {
  const read = readDataTypeDefault({
    written: { kind: 'number', text: input.text },
    isList: false,
    column: { codecId: input.codecId },
    codecLookup: input.codecLookup,
    support: input.support,
    fieldPath: input.subject,
  });
  return read.ok ? read : refusalDiagnostic(read.refusal, input.subject);
}

/** A refusal worded as a PSL diagnostic's code and message. */
function refusalDiagnostic(
  refusal: DefaultRefusal,
  subject: string,
): Extract<DefaultDiagnosticResult, { readonly ok: false }> {
  const where = `${subject}${at(refusal.elementIndex)}`;
  switch (refusal.kind) {
    case 'unreadable':
      return {
        ok: false,
        code: 'PSL_INVALID_LITERAL',
        message: `${where}: ${refusal.message}`,
      };
    case 'unknown-tag':
      return {
        ok: false,
        code: 'PSL_UNKNOWN_LITERAL_TAG',
        message: `Unknown literal tag "${refusal.tag}". Known tags: ${refusal.known.join(', ')}.`,
      };
    case 'unwritable':
      return {
        ok: false,
        code: PSL_VALUE_TYPE_INCOMPATIBLE,
        message: `${where}: this target has no data type for a ${refusal.syntax} value`,
      };
    case 'not-a-list':
      return {
        ok: false,
        code: PSL_DEFAULT_LIST_EXPECTED,
        message: `${where}: this column holds a list, so its default is a list literal, as in [1, 2]`,
      };
    case 'no-cast':
      return {
        ok: false,
        code: PSL_VALUE_TYPE_INCOMPATIBLE,
        message: `${where}: ${refusal.columnType} has no cast from ${refusal.valueType}; ${describeCasts(refusal.casts)}`,
      };
    case 'refused-by-codec':
      return {
        ok: false,
        code: PSL_INVALID_DEFAULT_LITERAL,
        message: `${where}: ${refusal.message}`,
      };
  }
}

function describeCasts(casts: readonly string[]): string {
  return casts.length === 0 ? 'it casts from nothing' : `it casts from ${casts.join(', ')}`;
}
