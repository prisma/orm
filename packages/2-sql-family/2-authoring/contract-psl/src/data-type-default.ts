/**
 * Reading a `@default(...)` value: a written value is read by the authoring entry for the syntax it
 * is written in, as a value its data type constructs; the column's type takes it directly or through a cast, and constructs what the cast returns;
 * the value is constructed through the column's type with `valueFrom` under the column's parameters,
 * which refuses a value they exclude and writes the spelling they give it; the column's codec, built with the column's type
 * parameters, checks it with `fromDataTypeValue`; and it is stored as the type's `toContract` writes it.
 *
 * No per-type code and no per-codec branch live here. ADR 254.
 */

import type { JsonValue } from '@internal/contract/types';
import {
  admittedForms,
  type CastRefusal,
  castTypedValue,
  type DataTypeSupport,
  describeExpected,
  describeRefusal,
  describeRefusedValueType,
  exactRewrite,
  type ReadRefusal,
  type RefusalGuidance,
  readWrittenValue,
  tagForm,
  type WrittenForm,
  type WrittenScalar,
  type WrittenValue,
} from '@internal/framework-components/authoring';
import type {
  AnyCodecDescriptor,
  CodecLookupWithDescriptors,
  DataTypeId,
  DataTypeParams,
  DataTypeValue,
  TypeLookups,
} from '@internal/framework-components/codec';
import { codecForRef, dataTypeParams } from '@internal/framework-components/codec';
import type { ContributedPslDiagnosticCode, PslSpan } from '@internal/framework-components/psl-ast';
import { SQL_EXPRESSION_TAG } from '@internal/sql-contract/sql-expression';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError, isInternalError } from '@internal/utils/internal-error';

/** A written value the column's type, under the column's parameters, or the column's codec refuses. */
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

/**
 * A value in its stored JSON form that the column refuses: `refused-by-column` when its type, under the column's parameters, refuses it, and `refused-by-codec` when the type holds it as `stored` but the column's codec cannot hold it exactly, as a JavaScript `Date` cannot hold digits below a millisecond. On a list column, `stored` holds every element, and `elementIndex` is the first the codec refuses.
 */
type CodecRefusal =
  | {
      readonly kind: 'refused-by-column';
      readonly codecId: string;
      readonly message: string;
      readonly elementIndex: number | undefined;
    }
  | {
      readonly kind: 'refused-by-codec';
      readonly codecId: string;
      readonly message: string;
      readonly elementIndex: number | undefined;
      readonly stored: JsonValue;
    };

/**
 * Why a default was refused, in parts, so each contract source words its own diagnostic: the cast
 * rule's refusals, plus the refusals only a default has. The column's type refusing a value is
 * reported as the column refusing it.
 */
export type DefaultRefusal = {
  /** Which element of a written list the refusal is about; `undefined` for the whole value. */
  readonly elementIndex: number | undefined;
} & (
  | ReadRefusal
  | Exclude<CastRefusal, { readonly kind: 'refused-by-type' }>
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
  | DistributiveOmit<CodecRefusal, 'elementIndex'>
);

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type ReadDefaultResult =
  | { readonly ok: true; readonly value: JsonValue }
  | {
      readonly ok: false;
      readonly refusal: DefaultRefusal;
      /** The types whose written forms a diagnostic suggests instead. */
      readonly suggestedTypes: readonly DataTypeId[];
    };

type StoredRefusal = CodecRefusal;

type StoredReadResult =
  | { readonly ok: true; readonly value: JsonValue }
  | {
      readonly ok: false;
      readonly refusal: StoredRefusal;
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

/** A refusal worded as a PSL diagnostic's code and message, for a caller that reports it at its own span. */
interface RefusalMessage {
  readonly code: string;
  readonly message: string;
}

type ReadValueResult =
  | { readonly ok: true; readonly value: JsonValue }
  | ({ readonly ok: false } & RefusalMessage);

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
): { readonly ok: true; readonly typed: DataTypeValue } | DefaultFailure {
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
 * The column's codec descriptor, and `read`, which makes a value in its stored JSON form a value of the column's type under the column's parameters, and checks it with the column's codec, built with those parameters.
 */
function storedValueReader(input: {
  readonly column: DefaultColumn;
  readonly lookups: TypeLookups<CodecLookupWithDescriptors>;
  readonly fieldPath: string;
}): {
  readonly descriptor: AnyCodecDescriptor;
  readonly params: DataTypeParams;
  readonly read: (value: JsonValue, elementIndex: number | undefined) => StoredReadResult;
} {
  const descriptor = input.lookups.codecLookup.descriptorFor(input.column.codecId);
  const codec = codecForRef(input.lookups.codecLookup, {
    codecId: input.column.codecId,
    ...ifDefined('typeParams', codecRefTypeParams(input.column.typeParams)),
  });
  if (codec === undefined || descriptor === undefined) {
    throw new InternalError(
      `Field "${input.fieldPath}": no codec descriptor is registered for "${input.column.codecId}", but the column was resolved from one.`,
    );
  }
  const suggestedTypes = [descriptor.dataType];
  const params = dataTypeParams(codec.dataType, input.column.typeParams);
  const read = (written: JsonValue, elementIndex: number | undefined): StoredReadResult => {
    let value: ReturnType<typeof codec.dataType.valueFrom>;
    try {
      value = codec.dataType.valueFrom(written, params);
    } catch (error) {
      if (isInternalError(error)) throw error;
      return {
        ok: false,
        refusal: {
          kind: 'refused-by-column',
          codecId: input.column.codecId,
          message: messageOf(error),
          elementIndex,
        },
        suggestedTypes,
      };
    }
    const stored = codec.dataType.toContract(value);
    try {
      codec.fromDataTypeValue(value);
    } catch (error) {
      if (isInternalError(error)) throw error;
      return {
        ok: false,
        refusal: {
          kind: 'refused-by-codec',
          codecId: input.column.codecId,
          message: messageOf(error),
          elementIndex,
          stored,
        },
        suggestedTypes,
      };
    }
    return { ok: true, value: stored };
  };
  return { descriptor, params, read };
}

/**
 * Reads a value already in its stored JSON form, such as one member of a JSON document default, as a value of the column's type checked by the column's codec. Worded as {@link lowerDataTypeDefault} words the same refusals.
 */
export function readStoredValue(input: {
  readonly value: JsonValue;
  readonly column: DefaultColumn;
  readonly lookups: TypeLookups<CodecLookupWithDescriptors>;
  readonly fieldPath: string;
}): ReadValueResult {
  const reading = storedValueReader(input).read(input.value, undefined);
  return reading.ok
    ? reading
    : { ok: false, ...storedRefusalMessage(reading.refusal, `Field "${input.fieldPath}"`) };
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
  readonly codecLookup: CodecLookupWithDescriptors;
  readonly dataTypes: DataTypeSupport;
  readonly fieldPath: string;
}): ReadDefaultResult {
  const {
    descriptor,
    params,
    read: readStored,
  } = storedValueReader({
    column: input.column,
    lookups: { codecLookup: input.codecLookup, dataTypeLookup: input.dataTypes.lookup },
    fieldPath: input.fieldPath,
  });
  const columnType = descriptor.dataType;
  const suggestedTypes = [columnType];

  const readOne = (written: WrittenScalar, elementIndex: number | undefined): ReadDefaultResult => {
    const read = readOneValue(input.dataTypes, written, elementIndex, suggestedTypes);
    if (!read.ok) return read;
    const cast = castTypedValue(input.dataTypes, columnType, params, read.typed);
    if (!cast.ok) {
      const { failure } = cast;
      return failure.kind === 'refused-by-type'
        ? refused(
            {
              kind: 'refused-by-column',
              codecId: input.column.codecId,
              message: failure.message,
              elementIndex,
            },
            suggestedTypes,
          )
        : refused({ ...failure, elementIndex }, suggestedTypes);
    }
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
    let codecRefusal: Extract<DefaultRefusal, { kind: 'refused-by-codec' }> | undefined;
    for (const [elementIndex, written] of input.written.elements.entries()) {
      if (written.kind === 'list') return nestedList(elementIndex, suggestedTypes);
      const element = readOne(written, elementIndex);
      if (!element.ok && element.refusal.kind === 'refused-by-codec') {
        codecRefusal ??= element.refusal;
        elements.push(element.refusal.stored);
        continue;
      }
      if (!element.ok) {
        return codecRefusal === undefined
          ? element
          : refused(
              {
                kind: 'refused-by-column',
                codecId: codecRefusal.codecId,
                message: codecRefusal.message,
                elementIndex: codecRefusal.elementIndex,
              },
              suggestedTypes,
            );
      }
      elements.push(element.value);
    }
    return codecRefusal === undefined
      ? { ok: true, value: elements }
      : refused({ ...codecRefusal, stored: elements }, suggestedTypes);
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
function location(subject: string, elementIndex: number | undefined): string {
  return elementIndex === undefined ? subject : `${subject} at element ${elementIndex + 1}`;
}

/**
 * What may be written where every one of `types` is received, each form once: `a number`. A column
 * whose type nothing writes still takes a `sql` literal, which `@default` stores as a SQL expression.
 */
function formsOf(dataTypes: DataTypeSupport, types: readonly DataTypeId[]): readonly WrittenForm[] {
  const forms = admittedForms(dataTypes, types);
  return forms.length === 0 ? [tagForm(SQL_EXPRESSION_TAG)] : forms;
}

/** The exact rewrite of the written value a `no-cast` refusal is about, before list elements are renumbered to the source list. */
function rewriteOf(
  refusal: DefaultRefusal,
  written: WrittenValue,
  dataTypes: DataTypeSupport,
): string | undefined {
  if (refusal.kind !== 'no-cast') return undefined;
  const refused =
    refusal.elementIndex === undefined || written.kind !== 'list'
      ? written
      : written.elements[refusal.elementIndex];
  return refused === undefined || refused.kind === 'list'
    ? undefined
    : exactRewrite(dataTypes, refusal, refused);
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
  readonly codecLookup: CodecLookupWithDescriptors;
  readonly dataTypes: DataTypeSupport;
  /** How a refusal names what the default is written on, as in `Field "Post.slug"`. */
  readonly subject: string;
  /** For a written list that leaves out the source list's `null` elements: the source index of each written element. */
  readonly sourceElementIndexes: readonly number[] | undefined;
}): DefaultDiagnosticResult {
  const read = readDataTypeDefault({ ...input, fieldPath: input.subject });
  if (read.ok) return read;
  const refusal = atSourceElement(read.refusal, input.sourceElementIndexes);
  return {
    ok: false,
    ...refusalMessage(
      refusal,
      input.subject,
      input.dataTypes,
      guidanceFor(read, input.written, input.dataTypes),
    ),
    span: refusalSpan(refusal, input.spans, input.subject),
  };
}

/** What a refusal of `written` tells the author to write instead. */
function guidanceFor(
  failure: DefaultFailure,
  written: WrittenValue,
  dataTypes: DataTypeSupport,
): RefusalGuidance {
  return {
    forms: formsOf(dataTypes, failure.suggestedTypes),
    rewrite: rewriteOf(failure.refusal, written, dataTypes),
  };
}

function atSourceElement(
  refusal: DefaultRefusal,
  sourceElementIndexes: readonly number[] | undefined,
): DefaultRefusal {
  if (refusal.elementIndex === undefined) return refusal;
  const elementIndex = sourceElementIndexes?.[refusal.elementIndex];
  return elementIndex === undefined ? refusal : { ...refusal, elementIndex };
}

function codecRefusalMessage(refusal: CodecRefusal, subject: string): RefusalMessage {
  return {
    code: PSL_INVALID_DEFAULT_LITERAL,
    message: `${location(subject, refusal.elementIndex)}: ${refusal.message}`,
  };
}

function storedRefusalMessage(refusal: StoredRefusal, subject: string): RefusalMessage {
  return codecRefusalMessage(refusal, subject);
}

/** A refusal worded as a PSL diagnostic's code and message; `guidance` says what to write instead. */
function refusalMessage(
  refusal: DefaultRefusal,
  subject: string,
  dataTypes: DataTypeSupport,
  guidance: RefusalGuidance,
): RefusalMessage {
  const where = location(subject, refusal.elementIndex);
  switch (refusal.kind) {
    case 'not-a-list':
      return {
        code: PSL_DEFAULT_LIST_EXPECTED,
        message: `${where}: this column holds a list, so its default is a list literal, as in [1, 2]`,
      };
    case 'refused-by-column':
    case 'refused-by-codec':
      return codecRefusalMessage(refusal, subject);
    case 'no-list-cast':
      return {
        code: PSL_VALUE_TYPE_INCOMPATIBLE,
        message: `${where}: ${describeExpected(guidance.forms)}; got a list`,
      };
    case 'no-element-cast':
      return {
        code: PSL_VALUE_TYPE_INCOMPATIBLE,
        message: `${where}: ${describeRefusedValueType(refusal, dataTypes, guidance)}`,
      };
    default: {
      const { code, message } = describeRefusal(refusal, dataTypes, guidance);
      return { code, message: `${where}: ${message}` };
    }
  }
}

function refusalSpan(refusal: DefaultRefusal, spans: DefaultSpans, subject: string): PslSpan {
  switch (refusal.kind) {
    case 'not-a-list':
    case 'refused-by-column':
    case 'refused-by-codec':
      return spans.attribute;
    default:
      return writtenValueSpan(spans, refusal.elementIndex, subject);
  }
}

function writtenValueSpan(
  spans: DefaultSpans,
  elementIndex: number | undefined,
  subject: string,
): PslSpan {
  if (elementIndex === undefined) return spans.value;
  const span = spans.elements[elementIndex];
  if (span === undefined) {
    throw new InternalError(
      `${subject}: a refused @default list element ${elementIndex + 1} has no written span.`,
    );
  }
  return span;
}
