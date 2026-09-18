/**
 * Literal types for column defaults: the vocabulary a contract source classifies a written default
 * into, and a codec descriptor declares through `literalTypes`.
 *
 * A written number's type comes from its own size and precision, never from the column it is
 * written on: `42` is an `i8` everywhere, `100000000000000099` an `i64`, `1.50` a `decimal`. The
 * compatibility check is then a lookup by name, and a value too large for a column is reported as
 * an incompatibility before anything is decoded.
 *
 * ADR 254.
 */

import type { JsonValue } from '@internal/contract/types';

export type LiteralTypeName =
  | 'string'
  | 'boolean'
  | 'i8'
  | 'i16'
  | 'i32'
  | 'i64'
  | 'bigint'
  | 'decimal'
  | 'float'
  | 'json';

/** What a codec accepts: a type by name, or a list whose elements are any of the named types. */
export type LiteralTypeDeclaration =
  | LiteralTypeName
  | { readonly list: readonly LiteralTypeName[] };

/** A literal whose type is a single name: everything a `list` element can be. */
export type ScalarLiteral = { readonly type: LiteralTypeName; readonly value: JsonValue };

/**
 * A classified literal. A list literal's `type.list` holds the types of its elements in first-seen
 * order, so an empty list has an empty list of element types and is compatible with every list
 * declaration.
 */
export type Literal =
  | ScalarLiteral
  | {
      readonly type: { readonly list: readonly LiteralTypeName[] };
      readonly value: readonly JsonValue[];
    };

/** A literal as a contract source wrote it, with the source's own escapes already resolved. */
export type WrittenLiteral =
  | { readonly kind: 'string'; readonly text: string }
  | { readonly kind: 'number'; readonly text: string }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'json'; readonly text: string }
  | { readonly kind: 'list'; readonly elements: readonly WrittenLiteral[] };

export interface LiteralRefusal {
  readonly ok: false;
  readonly reason: 'invalid-json' | 'invalid-number';
  readonly message: string;
  /** Which element of a list literal was refused; `undefined` when the literal is not a list. */
  readonly elementIndex: number | undefined;
}

export type ReadLiteralResult = { readonly ok: true; readonly literal: Literal } | LiteralRefusal;

const INTEGER_TEXT = /^-?\d+$/;
const DECIMAL_TEXT = /^-?\d+\.\d+$/;
const FLOAT_WORDS: ReadonlySet<string> = new Set(['NaN', 'Infinity', '-Infinity']);

/**
 * Whether `text` is a whole number or a decimal as a contract source writes one. A codec whose
 * stored shape differs from a literal type's uses this to recognise the text a `decimal`, `i64` or
 * `bigint` literal default carries, instead of restating the accepted syntax.
 */
export function isNumeralText(text: string): boolean {
  return INTEGER_TEXT.test(text) || DECIMAL_TEXT.test(text);
}

/** Whether `text` is one of the three words a `float` literal is written as. */
export function isNonFiniteText(text: string): boolean {
  return FLOAT_WORDS.has(text);
}

const INTEGER_LIMITS = [
  { name: 'i8', min: -128n, max: 127n },
  { name: 'i16', min: -32768n, max: 32767n },
  { name: 'i32', min: -2147483648n, max: 2147483647n },
  { name: 'i64', min: -9223372036854775808n, max: 9223372036854775807n },
] as const satisfies readonly { name: LiteralTypeName; min: bigint; max: bigint }[];

/** The integer types whose value is an exact JSON number; `i64` and `bigint` carry digit text. */
const NUMBER_VALUED_INTEGERS: ReadonlySet<LiteralTypeName> = new Set(['i8', 'i16', 'i32']);

const INTEGER_CHAIN = [...INTEGER_LIMITS.map(({ name }) => name), 'bigint'] as const;

/**
 * The chain of integer literal types from `i8` up to and including `name`, so a codec descriptor
 * naming `i8` to `i64` does not spell the chain out.
 */
export function integerLiteralTypesUpTo(
  name: (typeof INTEGER_CHAIN)[number],
): readonly LiteralTypeName[] {
  return INTEGER_CHAIN.slice(0, INTEGER_CHAIN.indexOf(name) + 1);
}

const DECIMAL_NUMERAL = /^(-?)0*(\d+)(\.\d+)?$/;

/**
 * Leading zeros and the sign of zero never change a decimal. Trailing zeros are kept, because a
 * column without a scale keeps them.
 */
function canonicalDecimalText(text: string): string {
  const numeral = DECIMAL_NUMERAL.exec(text);
  if (numeral === null) return text;
  const [, sign = '', whole = '', fraction = ''] = numeral;
  const digits = `${whole}${fraction}`;
  return /^[0.]+$/.test(digits) ? digits : `${sign}${digits}`;
}

/** The literal type of a number written as `text`, or `undefined` when PSL cannot write it. */
export function classifyNumberText(text: string): ScalarLiteral | undefined {
  if (FLOAT_WORDS.has(text)) return { type: 'float', value: text };
  if (DECIMAL_TEXT.test(text)) return { type: 'decimal', value: canonicalDecimalText(text) };
  if (!INTEGER_TEXT.test(text)) return undefined;
  const digits = BigInt(text);
  const limit = INTEGER_LIMITS.find(({ min, max }) => digits >= min && digits <= max);
  const name: LiteralTypeName = limit?.name ?? 'bigint';
  return {
    type: name,
    value: NUMBER_VALUED_INTEGERS.has(name) ? Number(digits) : digits.toString(),
  };
}

type ReadScalarResult = { readonly ok: true; readonly literal: ScalarLiteral } | LiteralRefusal;

export function readLiteral(written: WrittenLiteral): ReadLiteralResult {
  return written.kind === 'list' ? readList(written.elements) : readScalar(written);
}

function readScalar(written: Exclude<WrittenLiteral, { kind: 'list' }>): ReadScalarResult {
  switch (written.kind) {
    case 'string':
      return { ok: true, literal: { type: 'string', value: written.text } };
    case 'boolean':
      return { ok: true, literal: { type: 'boolean', value: written.value } };
    case 'number': {
      const literal = classifyNumberText(written.text);
      return literal === undefined
        ? {
            ok: false,
            reason: 'invalid-number',
            message: `"${written.text}" is not a number literal.`,
            elementIndex: undefined,
          }
        : { ok: true, literal };
    }
    case 'json':
      return readJson(written.text);
  }
}

function readJson(text: string): ReadScalarResult {
  try {
    return { ok: true, literal: { type: 'json', value: JSON.parse(text) } };
  } catch (error) {
    return {
      ok: false,
      reason: 'invalid-json',
      message: error instanceof Error ? error.message : String(error),
      elementIndex: undefined,
    };
  }
}

function readList(elements: readonly WrittenLiteral[]): ReadLiteralResult {
  const types: LiteralTypeName[] = [];
  const values: JsonValue[] = [];
  for (const [elementIndex, element] of elements.entries()) {
    if (element.kind === 'list') {
      return {
        ok: false,
        reason: 'invalid-number',
        message: 'A list literal cannot contain another list.',
        elementIndex,
      };
    }
    const read = readScalar(element);
    if (!read.ok) return { ...read, elementIndex };
    if (!types.includes(read.literal.type)) types.push(read.literal.type);
    values.push(read.literal.value);
  }
  return { ok: true, literal: { type: { list: types }, value: values } };
}

/** Whether a codec declaring `declarations` accepts `literal`. */
export function isCompatible(
  literal: Literal,
  declarations: readonly LiteralTypeDeclaration[],
): boolean {
  const literalType = literal.type;
  if (typeof literalType === 'string') {
    return declarations.includes(literalType);
  }
  return declarations.some(
    (declaration) =>
      typeof declaration !== 'string' &&
      literalType.list.every((element) => declaration.list.includes(element)),
  );
}

/** What a codec accepts, for a diagnostic: `i8, i16, i32 literals`, `a list of i8 literals`. */
export function describeDeclarations(declarations: readonly LiteralTypeDeclaration[]): string {
  const scalars = declarations.filter((declaration) => typeof declaration === 'string');
  const lists = declarations.filter((declaration) => typeof declaration !== 'string');
  const parts = [
    ...(scalars.length > 0 ? [`${scalars.join(', ')} literals`] : []),
    ...lists.map((declaration) => `a list of ${declaration.list.join(', ')} literals`),
  ];
  return parts.length === 0 ? 'no literal defaults' : parts.join(' and ');
}
