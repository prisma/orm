/**
 * Reading a `@default(...)` value: a written value is read by the authoring entry for the syntax it
 * is written in, which gives it a data type; the column's type takes it directly or through a cast;
 * and the column's codec validates the canonical form before it is stored.
 *
 * No per-type code and no per-codec branch live here. ADR 254.
 */

import type { JsonValue } from '@internal/contract/types';
import type {
  AuthoringDataTypeEntry,
  DataTypeAuthoringEntry,
} from '@internal/framework-components/authoring';
import { isDataTypeLoweringEntry } from '@internal/framework-components/authoring';
import type { CodecLookup, DataTypeId, DataTypeLookup } from '@internal/framework-components/codec';
import { materializeCodec } from '@internal/framework-components/codec';
import type { ContributedPslDiagnosticCode } from '@internal/framework-components/psl-ast';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { isStructuredError } from '@internal/utils/structured-error';

/** A `` json`...` `` body that is not a JSON document. */
export const PSL_INVALID_JSON_LITERAL: ContributedPslDiagnosticCode = 'PSL_INVALID_JSON_LITERAL';

/** A written value the entry, a cast, or the column's codec refuses. */
export const PSL_INVALID_DEFAULT_LITERAL: ContributedPslDiagnosticCode =
  'PSL_INVALID_DEFAULT_LITERAL';

/** A written value whose data type the column's type neither is nor casts from. */
export const PSL_DEFAULT_TYPE_INCOMPATIBLE: ContributedPslDiagnosticCode =
  'PSL_DEFAULT_TYPE_INCOMPATIBLE';

/** The code the JSON reader raises, so the PSL diagnostic for a bad document is its own. */
const INVALID_JSON_CODE = 'CONTRACT.INVALID_JSON_LITERAL';

/** One written value, in the syntax a contract source wrote it in. */
export type WrittenValue =
  | { readonly kind: 'tag'; readonly tag: string; readonly body: string }
  | { readonly kind: 'string'; readonly text: string }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'number'; readonly text: string }
  | { readonly kind: 'list'; readonly elements: readonly WrittenValue[] };

/** The assembled data types of a stack and the PSL support for them. */
export interface DataTypeSupport {
  readonly entries: Readonly<Record<string, AuthoringDataTypeEntry>>;
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
  | { readonly kind: 'unreadable'; readonly json: boolean; readonly message: string }
  | { readonly kind: 'unknown-tag'; readonly tag: string; readonly known: readonly string[] }
  | { readonly kind: 'unwritable'; readonly syntax: string }
  | { readonly kind: 'not-a-list' }
  | {
      readonly kind: 'no-cast';
      readonly columnType: string;
      readonly valueType: string;
      readonly casts: readonly string[];
    }
  | { readonly kind: 'undecodable'; readonly codecId: string; readonly message: string }
);

export type ReadDefaultResult =
  | { readonly ok: true; readonly value: JsonValue }
  | { readonly ok: false; readonly refusal: DefaultRefusal };

export type LowerDefaultResult =
  | { readonly ok: true; readonly value: JsonValue }
  | { readonly ok: false; readonly code: string; readonly message: string };

/** The value entries of a stack, by data type id. */
function valueEntries(
  support: DataTypeSupport,
): ReadonlyArray<readonly [string, DataTypeAuthoringEntry]> {
  return Object.entries(support.entries).flatMap(([key, entry]) =>
    isDataTypeLoweringEntry(entry) ? [] : [[key, entry] as const],
  );
}

/** The entry a tag names, or `undefined` when no pack registered that tag. */
export function entryForTag(
  support: DataTypeSupport,
  tag: string,
): { readonly key: string; readonly entry: DataTypeAuthoringEntry } | undefined {
  for (const [key, entry] of valueEntries(support)) {
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
  for (const [key, entry] of valueEntries(support)) {
    if (entry.written.kind === 'plain' && entry.written.syntax === syntax) return { key, entry };
  }
  return undefined;
}

/** The text an entry reads: a tag's body, a string's value, or the word a boolean is written as. */
function plainText(written: Exclude<WrittenValue, { kind: 'list' }>): string {
  switch (written.kind) {
    case 'tag':
      return written.body;
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

function isJsonRefusal(error: unknown): boolean {
  return isStructuredError(error) && error.code === INVALID_JSON_CODE;
}

/** Read one written value through the entry for its syntax. */
function readValue(
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
        json: false,
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
        type: blindCast<DataTypeId, 'an entry key is the id of the type it reads'>(found.key),
        value: form.parse(text),
      },
    };
  } catch (error) {
    return refuse({ kind: 'unreadable', json: isJsonRefusal(error), message: messageOf(error) });
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
    return {
      ok: false,
      refusal: {
        kind: 'unreadable',
        json: isJsonRefusal(error),
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
  readonly codecLookup: CodecLookup | undefined;
  readonly support: DataTypeSupport;
  readonly fieldPath: string;
}): ReadDefaultResult {
  const descriptorFor = input.codecLookup?.descriptorFor;
  if (descriptorFor === undefined) {
    throw new InternalError(
      `Field "${input.fieldPath}": the codec lookup resolving column codecs exposes no descriptorFor, but the column was resolved from a codec descriptor.`,
    );
  }
  const descriptor = descriptorFor(input.column.codecId);
  if (descriptor === undefined) {
    throw new InternalError(
      `Field "${input.fieldPath}": no codec descriptor is registered for "${input.column.codecId}", but the column was resolved from one.`,
    );
  }
  const columnType = descriptor.dataType;

  const codec = materializeCodec(
    descriptor,
    {
      codecId: input.column.codecId,
      ...ifDefined('typeParams', codecRefTypeParams(input.column.typeParams)),
    },
    { name: input.fieldPath },
  );
  const validate = (value: JsonValue, elementIndex: number | undefined): ReadDefaultResult => {
    try {
      codec.decodeJson(value);
      return { ok: true, value };
    } catch (error) {
      return {
        ok: false,
        refusal: {
          kind: 'undecodable',
          codecId: input.column.codecId,
          message: messageOf(error),
          elementIndex,
        },
      };
    }
  };

  const readOne = (
    written: Exclude<WrittenValue, { kind: 'list' }>,
    elementIndex: number | undefined,
  ): ReadDefaultResult => {
    const read = readValue(input.support, written, elementIndex);
    if (!read.ok) return read;
    const cast = castInto(input.support, columnType, read.typed, elementIndex);
    if (!cast.ok) return cast;
    return validate(cast.value, elementIndex);
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
            json: false,
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

  return readListIntoScalar({ ...input, written: input.written, columnType, validate });
}

/** A written list on a column that is not a list: the column's type takes it through its list cast. */
function readListIntoScalar(input: {
  readonly written: Extract<WrittenValue, { kind: 'list' }>;
  readonly support: DataTypeSupport;
  readonly columnType: DataTypeId;
  readonly validate: (value: JsonValue, elementIndex: number | undefined) => ReadDefaultResult;
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
          json: false,
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
    return input.validate(listCast.cast(elements), undefined);
  } catch (error) {
    return {
      ok: false,
      refusal: {
        kind: 'unreadable',
        json: isJsonRefusal(error),
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
  readonly codecLookup: CodecLookup | undefined;
  readonly support: DataTypeSupport;
  readonly fieldPath: string;
}): LowerDefaultResult {
  const read = readDataTypeDefault(input);
  if (read.ok) return read;
  const { refusal } = read;
  const where = `Field "${input.fieldPath}"${at(refusal.elementIndex)}`;
  switch (refusal.kind) {
    case 'unreadable':
      return {
        ok: false,
        code: refusal.json ? PSL_INVALID_JSON_LITERAL : PSL_INVALID_DEFAULT_LITERAL,
        message: `${where}: ${refusal.message}`,
      };
    case 'unknown-tag':
      return {
        ok: false,
        code: 'PSL_UNKNOWN_DEFAULT_LITERAL_TAG',
        message: `Unknown literal tag "${refusal.tag}". Known tags: ${refusal.known.join(', ')}.`,
      };
    case 'unwritable':
      return {
        ok: false,
        code: PSL_DEFAULT_TYPE_INCOMPATIBLE,
        message: `${where}: this target has no data type for a ${refusal.syntax} value`,
      };
    case 'not-a-list':
      return {
        ok: false,
        code: PSL_DEFAULT_TYPE_INCOMPATIBLE,
        message: `${where}: this column holds a list, so its default is a list literal, as in [1, 2]`,
      };
    case 'no-cast':
      return {
        ok: false,
        code: PSL_DEFAULT_TYPE_INCOMPATIBLE,
        message: `${where}: ${refusal.columnType} has no cast from ${refusal.valueType}; ${describeCasts(refusal.casts)}`,
      };
    case 'undecodable':
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
