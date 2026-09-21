/**
 * Reading a `@default(...)` literal: a written literal is classified into a literal type, the type
 * is checked against the column's codec by membership, and the codec's `decodeJson` converts the
 * value. No per-type code and no per-codec branch live here.
 *
 * ADR 254.
 */

import type { JsonValue } from '@internal/contract/types';
import {
  type CodecLookup,
  describeDeclarations,
  isCompatible,
  type Literal,
  type LiteralTypeDeclaration,
  type LiteralTypeName,
  materializeCodec,
  readLiteral,
  type WrittenLiteral,
} from '@internal/framework-components/codec';
import type { ContributedPslDiagnosticCode } from '@internal/framework-components/psl-ast';
import type { AuthoredColumnDefaultLiteralValue } from '@internal/sql-contract-ts/contract-builder';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';

/** A `` json`...` `` body that is not a JSON document. */
export const PSL_INVALID_JSON_LITERAL: ContributedPslDiagnosticCode = 'PSL_INVALID_JSON_LITERAL';

/** A literal the column's codec declares it accepts but refuses to decode, and a literal no contract source can write. */
export const PSL_INVALID_DEFAULT_LITERAL: ContributedPslDiagnosticCode =
  'PSL_INVALID_DEFAULT_LITERAL';

/** A literal whose type the column's codec does not accept. */
export const PSL_DEFAULT_LITERAL_TYPE_INCOMPATIBLE: ContributedPslDiagnosticCode =
  'PSL_DEFAULT_LITERAL_TYPE_INCOMPATIBLE';

export interface LiteralDefaultColumn {
  readonly codecId: string;
  readonly typeParams?: Record<string, unknown> | undefined;
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

export type LiteralDefaultResult =
  | { readonly ok: true; readonly value: AuthoredColumnDefaultLiteralValue }
  | { readonly ok: false; readonly code: string; readonly message: string };

/**
 * Why a literal default was refused, in parts, so each contract source words its own diagnostic:
 * PSL says `pg/int4@1 is not compatible with a decimal literal`, the Prisma 7 reader says what a
 * Prisma 7 user needs to hear, and neither restates the other's phrasing.
 */
export type LiteralDefaultRefusal = {
  /** Which element of a list literal the refusal is about; `undefined` when it is about the whole literal. */
  readonly elementIndex: number | undefined;
} & (
  | {
      readonly kind: 'unreadable';
      readonly reason: 'invalid-json' | 'invalid-number';
      readonly message: string;
    }
  | {
      readonly kind: 'incompatible';
      readonly codecId: string;
      readonly literalType: string;
      /** What the codec accepts instead, as {@link describeDeclarations} words it. */
      readonly accepts: string;
    }
  | { readonly kind: 'undecodable'; readonly codecId: string; readonly message: string }
);

export type ReadLiteralDefaultResult =
  | { readonly ok: true; readonly value: AuthoredColumnDefaultLiteralValue }
  | { readonly ok: false; readonly refusal: LiteralDefaultRefusal };

/**
 * The written literal a tagged literal's body is, given the literal type its tag names, or a
 * refusal when the body is not a literal of that type. Only `boolean` can refuse here: every other
 * type reads its own text, and refuses it in {@link readLiteral} if it cannot.
 */
export function writtenLiteralForTagBody(
  literalType: LiteralTypeName,
  text: string,
): WrittenLiteral | { readonly ok: false; readonly message: string } {
  switch (literalType) {
    case 'json':
      return { kind: 'json', text };
    case 'string':
      return { kind: 'string', text };
    case 'boolean':
      if (text === 'true' || text === 'false') return { kind: 'boolean', value: text === 'true' };
      return { ok: false, message: `"${text}" is not a boolean literal.` };
    case 'i8':
    case 'i16':
    case 'i32':
    case 'i64':
    case 'bigint':
    case 'decimal':
    case 'float':
      return { kind: 'number', text };
  }
}

const REFUSAL_CODES = {
  'invalid-json': PSL_INVALID_JSON_LITERAL,
  'invalid-number': PSL_INVALID_DEFAULT_LITERAL,
} as const;

/** Where in a list literal a diagnostic is about, for a message: ` at element 2`. */
function at(elementIndex: number | undefined): string {
  return elementIndex === undefined ? '' : ` at element ${elementIndex + 1}`;
}

const VOWEL = /^[aeiou]/;

/** A literal type in a diagnostic, with its article: `a decimal literal`, `an i64 literal`. */
export function describeLiteralType(literalType: string): string {
  return `${VOWEL.test(literalType) ? 'an' : 'a'} ${literalType} literal`;
}

/** How a literal's type reads in a diagnostic: `bigint`, `string`, or `list` for a list literal. */
function literalTypeName(literal: Literal): string {
  return typeof literal.type === 'string' ? literal.type : 'list';
}

function scalarDeclarations(
  declarations: readonly LiteralTypeDeclaration[],
): readonly LiteralTypeDeclaration[] {
  return declarations.filter((declaration) => typeof declaration === 'string');
}

/**
 * Reads one `@default(...)` literal for a column, refusing in parts so each contract source words
 * its own diagnostic. `isList` selects the check: a list column's elements are each checked and
 * decoded against the element codec's scalar declarations, while a scalar column's literal is
 * checked whole — so a codec declaring `{ list: [...] }` takes a PSL list on a column that is not a
 * list.
 */
export function readLiteralDefault(input: {
  readonly written: WrittenLiteral;
  readonly isList: boolean;
  readonly column: LiteralDefaultColumn;
  readonly codecLookup: CodecLookup | undefined;
  readonly fieldPath: string;
}): ReadLiteralDefaultResult {
  const read = readLiteral(input.written);
  if (!read.ok) {
    return {
      ok: false,
      refusal: {
        kind: 'unreadable',
        reason: read.reason,
        message: read.message,
        elementIndex: read.elementIndex,
      },
    };
  }

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

  const declared = descriptor.literalTypes ?? [];
  const declarations = input.isList ? scalarDeclarations(declared) : declared;
  const incompatible = (
    literalType: string,
    elementIndex: number | undefined,
  ): ReadLiteralDefaultResult => ({
    ok: false,
    refusal: {
      kind: 'incompatible',
      codecId: input.column.codecId,
      literalType,
      accepts: describeDeclarations(declarations),
      elementIndex,
    },
  });

  const typeParams = codecRefTypeParams(input.column.typeParams);
  const codec = materializeCodec(
    descriptor,
    { codecId: input.column.codecId, ...ifDefined('typeParams', typeParams) },
    { name: input.fieldPath },
  );
  const decode = (value: JsonValue, elementIndex: number | undefined): ReadLiteralDefaultResult => {
    try {
      return {
        ok: true,
        value: blindCast<
          AuthoredColumnDefaultLiteralValue,
          'a codec decodes its own JSON form into the application value the contract builder accepts'
        >(codec.decodeJson(value)),
      };
    } catch (error) {
      return {
        ok: false,
        refusal: {
          kind: 'undecodable',
          codecId: input.column.codecId,
          message: error instanceof Error ? error.message : String(error),
          elementIndex,
        },
      };
    }
  };

  if (!input.isList) {
    if (!isCompatible(read.literal, declarations)) {
      return incompatible(literalTypeName(read.literal), undefined);
    }
    return decode(blindCast<JsonValue, 'a literal value is JSON'>(read.literal.value), undefined);
  }

  if (input.written.kind !== 'list') {
    throw new InternalError(
      `Field "${input.fieldPath}": a list column's default was read as a ${input.written.kind} literal rather than a list.`,
    );
  }

  const decoded: AuthoredColumnDefaultLiteralValue[] = [];
  for (const [elementIndex, written] of input.written.elements.entries()) {
    // Each element is read on its own so its own type and position are both in hand; the whole-list
    // read above has already refused anything unreadable.
    const element = readLiteral(written);
    if (!element.ok || typeof element.literal.type !== 'string') {
      throw new InternalError(
        `Field "${input.fieldPath}": element ${elementIndex + 1} read differently on its own than as part of the list literal.`,
      );
    }
    if (!isCompatible(element.literal, declarations)) {
      return incompatible(element.literal.type, elementIndex);
    }
    const result = decode(element.literal.value, elementIndex);
    if (!result.ok) return result;
    decoded.push(result.value);
  }
  return { ok: true, value: decoded };
}

/** {@link readLiteralDefault} worded as a PSL diagnostic's code and message; the caller adds the provenance. */
export function lowerLiteralDefault(input: {
  readonly written: WrittenLiteral;
  readonly isList: boolean;
  readonly column: LiteralDefaultColumn;
  readonly codecLookup: CodecLookup | undefined;
  readonly fieldPath: string;
}): LiteralDefaultResult {
  const read = readLiteralDefault(input);
  if (read.ok) return read;
  const { refusal } = read;
  const where = `Field "${input.fieldPath}"${at(refusal.elementIndex)}`;
  switch (refusal.kind) {
    case 'unreadable':
      return {
        ok: false,
        code: REFUSAL_CODES[refusal.reason],
        message: `${where}: ${refusal.message}`,
      };
    case 'incompatible':
      return {
        ok: false,
        code: PSL_DEFAULT_LITERAL_TYPE_INCOMPATIBLE,
        message: `${where}: ${refusal.codecId} is not compatible with ${describeLiteralType(refusal.literalType)}; it accepts ${refusal.accepts}`,
      };
    case 'undecodable':
      return {
        ok: false,
        code: PSL_INVALID_DEFAULT_LITERAL,
        message: `${where}: ${refusal.message}`,
      };
  }
}
