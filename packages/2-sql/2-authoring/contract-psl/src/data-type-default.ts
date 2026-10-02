/**
 * Reading a `@default(...)` value: a written value is read by the authoring entry for the syntax it
 * is written in, which gives it a data type; the column's type takes it directly or through a cast;
 * and the column's codec, built with the column's type parameters, reads the canonical form with
 * `decodeJson`, which refuses a value the column would not store, before it is stored.
 *
 * No per-type code and no per-codec branch live here. ADR 254.
 */

import type { JsonValue } from '@internal/contract/types';
import {
  type CastRefusal,
  castTypedValue,
  type DataTypeSupport,
  describeAdmittedForms,
  describeRefusal,
  NO_WRITTEN_FORM,
  type ReadRefusal,
  readWrittenValue,
  type TypedValue,
  type WrittenScalar,
  type WrittenValue,
} from '@internal/framework-components/authoring';
import type {
  AnyCodecDescriptor,
  CodecLookupWithDescriptors,
  DataTypeId,
} from '@internal/framework-components/codec';
import { codecForRef } from '@internal/framework-components/codec';
import type { ContributedPslDiagnosticCode, PslSpan } from '@internal/framework-components/psl-ast';
import { SQL_EXPRESSION_TAG } from '@internal/sql-contract/sql-expression';
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

export interface DefaultColumn {
  readonly codecId: string;
  readonly typeParams?: Record<string, unknown> | undefined;
}

/** A value in its stored JSON form that the column's codec refuses. */
type CodecRefusal = {
  readonly kind: 'refused-by-codec';
  readonly codecId: string;
  readonly message: string;
  readonly elementIndex: number | undefined;
};

/**
 * Why a default was refused, in parts, so each contract source words its own diagnostic: the cast
 * rule's refusals, plus the refusals only a default has.
 */
export type DefaultRefusal = {
  /** Which element of a written list the refusal is about; `undefined` for the whole value. */
  readonly elementIndex: number | undefined;
} & (
  | ReadRefusal
  | CastRefusal
  | { readonly kind: 'not-a-list' }
  | {
      readonly kind: 'no-list-cast';
      readonly receivingType: DataTypeId;
      readonly casts: readonly string[];
    }
  | {
      readonly kind: 'no-element-cast';
      readonly receivingType: DataTypeId;
      readonly valueType: DataTypeId;
      /** The element types the receiving type's list cast takes. */
      readonly elementTypes: readonly DataTypeId[];
    }
  | Omit<CodecRefusal, 'elementIndex'>
);

export type ReadDefaultResult =
  | { readonly ok: true; readonly value: JsonValue }
  | {
      readonly ok: false;
      readonly refusal: DefaultRefusal;
      /** The types whose written forms a diagnostic suggests instead. */
      readonly suggestedTypes: readonly DataTypeId[];
    };

type StoredReadResult =
  | { readonly ok: true; readonly value: JsonValue }
  | {
      readonly ok: false;
      readonly refusal: CodecRefusal;
      readonly suggestedTypes: readonly DataTypeId[];
    };

type DefaultFailure = Extract<ReadDefaultResult, { readonly ok: false }>;

/** Where the parts of a written default are: the `@default` attribute, the written value, and each element of a written list. */
export interface DefaultSpans {
  readonly attribute: PslSpan;
  readonly value: PslSpan;
  readonly elements: readonly PslSpan[];
}

export type DefaultDiagnosticResult =
  | { readonly ok: true; readonly value: JsonValue }
  | {
      readonly ok: false;
      readonly code: string;
      readonly message: string;
      readonly span: PslSpan;
    };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function refused(refusal: DefaultRefusal, suggestedTypes: readonly DataTypeId[]): DefaultFailure {
  return { ok: false, refusal, suggestedTypes };
}

function readOneValue(
  dataTypes: DataTypeSupport,
  written: WrittenScalar,
  elementIndex: number | undefined,
  suggestedTypes: readonly DataTypeId[],
): { readonly ok: true; readonly typed: TypedValue } | DefaultFailure {
  const read = readWrittenValue(dataTypes, written);
  return read.ok
    ? { ok: true, typed: read.value }
    : refused({ ...read.failure, elementIndex }, suggestedTypes);
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
 * The column's codec descriptor, and `read`, which reads a value in its stored JSON form with the column's codec, built with the column's type parameters.
 */
function storedValueReader(input: {
  readonly column: DefaultColumn;
  readonly codecLookup: CodecLookupWithDescriptors | undefined;
  readonly fieldPath: string;
}): {
  readonly descriptor: AnyCodecDescriptor;
  readonly read: (value: JsonValue, elementIndex: number | undefined) => StoredReadResult;
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
  const suggestedTypes = [descriptor.dataType];
  const read = (value: JsonValue, elementIndex: number | undefined): StoredReadResult => {
    try {
      codec.decodeJson(value);
      return { ok: true, value };
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
        suggestedTypes,
      };
    }
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
  readonly fieldPath: string;
}):
  | { readonly ok: true; readonly value: JsonValue }
  | { readonly ok: false; readonly code: string; readonly message: string } {
  const reading = storedValueReader(input).read(input.value, undefined);
  return reading.ok
    ? reading
    : { ok: false, ...codecRefusalMessage(reading.refusal, input.fieldPath) };
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
  readonly dataTypes: DataTypeSupport;
  readonly fieldPath: string;
}): ReadDefaultResult {
  const { descriptor, read: readStored } = storedValueReader(input);
  const columnType = descriptor.dataType;
  const suggestedTypes = [columnType];

  const readOne = (written: WrittenScalar, elementIndex: number | undefined): ReadDefaultResult => {
    const read = readOneValue(input.dataTypes, written, elementIndex, suggestedTypes);
    if (!read.ok) return read;
    const cast = castTypedValue(input.dataTypes, columnType, read.typed);
    if (!cast.ok) return refused({ ...cast.failure, elementIndex }, suggestedTypes);
    return readStored(cast.value.value, elementIndex);
  };

  if (input.written.kind !== 'list') {
    if (input.isList) {
      return refused({ kind: 'not-a-list', elementIndex: undefined }, suggestedTypes);
    }
    return readOne(input.written, undefined);
  }

  if (input.isList) {
    const elements: JsonValue[] = [];
    for (const [elementIndex, written] of input.written.elements.entries()) {
      if (written.kind === 'list') return nestedList(elementIndex, suggestedTypes);
      const element = readOne(written, elementIndex);
      if (!element.ok) return element;
      elements.push(element.value);
    }
    return { ok: true, value: elements };
  }

  return readListIntoScalar({ ...input, written: input.written, columnType, readStored });
}

function nestedList(elementIndex: number, suggestedTypes: readonly DataTypeId[]): DefaultFailure {
  return refused(
    { kind: 'unreadable', message: 'a list holds values, not other lists', elementIndex },
    suggestedTypes,
  );
}

/** A written list on a column that is not a list: the column's type takes it through its list cast. */
function readListIntoScalar(input: {
  readonly written: Extract<WrittenValue, { kind: 'list' }>;
  readonly dataTypes: DataTypeSupport;
  readonly columnType: DataTypeId;
  readonly readStored: (value: JsonValue, elementIndex: number | undefined) => ReadDefaultResult;
}): ReadDefaultResult {
  const declaration = input.dataTypes.lookup.get(input.columnType);
  const listCast = declaration?.listCast;
  if (listCast === undefined) {
    return refused(
      {
        kind: 'no-list-cast',
        receivingType: input.columnType,
        casts: Object.keys(declaration?.casts ?? {}),
        elementIndex: undefined,
      },
      [input.columnType],
    );
  }

  const elements: JsonValue[] = [];
  for (const [elementIndex, written] of input.written.elements.entries()) {
    if (written.kind === 'list') return nestedList(elementIndex, listCast.of);
    const read = readOneValue(input.dataTypes, written, elementIndex, listCast.of);
    if (!read.ok) return read;
    if (!listCast.of.includes(read.typed.type)) {
      return refused(
        {
          kind: 'no-element-cast',
          receivingType: input.columnType,
          valueType: read.typed.type,
          elementTypes: listCast.of,
          elementIndex,
        },
        listCast.of,
      );
    }
    elements.push(read.typed.value);
  }

  try {
    return input.readStored(listCast.cast(elements), undefined);
  } catch (error) {
    if (isInternalError(error)) throw error;
    return refused({ kind: 'unreadable', message: messageOf(error), elementIndex: undefined }, [
      input.columnType,
    ]);
  }
}

/** Where a diagnostic is about, for a message: `Field "N.count" at element 2`. */
function location(fieldPath: string, elementIndex: number | undefined): string {
  return elementIndex === undefined
    ? `Field "${fieldPath}"`
    : `Field "${fieldPath}" at element ${elementIndex + 1}`;
}

/**
 * What may be written where every one of `types` is received, for a message: `a number`. A column
 * whose type nothing writes still takes a `sql` literal, which `@default` stores as a SQL expression.
 */
function formsOf(dataTypes: DataTypeSupport, types: readonly DataTypeId[]): string {
  const forms = [...new Set(types.map((type) => describeAdmittedForms(dataTypes, type)))].filter(
    (form) => form !== NO_WRITTEN_FORM,
  );
  return forms.length === 0 ? `${SQL_EXPRESSION_TAG}\`...\`` : forms.join(' or ');
}

/**
 * {@link readDataTypeDefault} worded as a PSL diagnostic's code, message and span: a cast-rule
 * refusal at the written value, or the element of a written list it is about; a refusal only
 * defaults have at the `@default` attribute.
 */
export function lowerDataTypeDefault(input: {
  readonly written: WrittenValue;
  readonly spans: DefaultSpans;
  readonly isList: boolean;
  readonly column: DefaultColumn;
  readonly codecLookup: CodecLookupWithDescriptors | undefined;
  readonly dataTypes: DataTypeSupport;
  readonly fieldPath: string;
  /** For a written list that leaves out the source list's `null` elements: the source index of each written element. */
  readonly sourceElementIndexes: readonly number[] | undefined;
}): DefaultDiagnosticResult {
  const read = readDataTypeDefault(input);
  return read.ok
    ? read
    : refusalDiagnostic(
        atSourceElement(read.refusal, input.sourceElementIndexes),
        input.fieldPath,
        formsOf(input.dataTypes, read.suggestedTypes),
        input.spans,
      );
}

function atSourceElement(
  refusal: DefaultRefusal,
  sourceElementIndexes: readonly number[] | undefined,
): DefaultRefusal {
  if (refusal.elementIndex === undefined) return refusal;
  const elementIndex = sourceElementIndexes?.[refusal.elementIndex];
  return elementIndex === undefined ? refusal : { ...refusal, elementIndex };
}

type DefaultDiagnostic = Extract<DefaultDiagnosticResult, { readonly ok: false }>;

function codecRefusalMessage(
  refusal: CodecRefusal,
  fieldPath: string,
): { readonly code: string; readonly message: string } {
  return {
    code: PSL_INVALID_DEFAULT_LITERAL,
    message: `${location(fieldPath, refusal.elementIndex)}: ${refusal.message}`,
  };
}

/** A refusal worded as a PSL diagnostic's code, message and span; `forms` says what to write instead. */
function refusalDiagnostic(
  refusal: DefaultRefusal,
  fieldPath: string,
  forms: string,
  spans: DefaultSpans,
): DefaultDiagnostic {
  const where = location(fieldPath, refusal.elementIndex);
  const atWrittenValue = writtenValueSpan(spans, refusal.elementIndex, fieldPath);
  switch (refusal.kind) {
    case 'not-a-list':
      return {
        ok: false,
        code: PSL_DEFAULT_LIST_EXPECTED,
        message: `${where}: this column holds a list, so its default is a list literal, as in [1, 2]`,
        span: spans.attribute,
      };
    case 'refused-by-codec':
      return { ok: false, ...codecRefusalMessage(refusal, fieldPath), span: spans.attribute };
    case 'no-list-cast':
      return {
        ok: false,
        code: PSL_VALUE_TYPE_INCOMPATIBLE,
        message: `${where}: ${refusal.receivingType} has no cast from a list; write ${forms}`,
        span: atWrittenValue,
      };
    case 'no-element-cast':
      return {
        ok: false,
        code: PSL_VALUE_TYPE_INCOMPATIBLE,
        message: `${where}: ${refusal.receivingType} has no cast from a list holding ${refusal.valueType}; write ${forms}`,
        span: atWrittenValue,
      };
    default: {
      const { code, message } = describeRefusal(refusal, forms);
      return { ok: false, code, message: `${where}: ${message}`, span: atWrittenValue };
    }
  }
}

function writtenValueSpan(
  spans: DefaultSpans,
  elementIndex: number | undefined,
  fieldPath: string,
): PslSpan {
  if (elementIndex === undefined) return spans.value;
  const span = spans.elements[elementIndex];
  if (span === undefined) {
    throw new InternalError(
      `Field "${fieldPath}": a refused @default list element ${elementIndex + 1} has no written span.`,
    );
  }
  return span;
}
