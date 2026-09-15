import { type ColumnDefault, isColumnDefault } from '@internal/contract/types';
import type { PslPrinterOptions } from '@internal/family-sql/psl-infer';
import type {
  PslAttribute,
  PslAttributeArgument,
  PslFieldAttribute,
  PslSpan,
} from '@internal/framework-components/psl-ast';

export const SYNTHETIC_SPAN: PslSpan = {
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 0, line: 1, column: 1 },
};

export function buildSimpleConstraintFieldAttribute(
  name: 'id' | 'unique',
  constraintName: string | undefined,
): PslFieldAttribute {
  if (constraintName === undefined) {
    return buildAttribute('field', name, []);
  }
  return buildAttribute('field', name, [namedArg('map', `"${escapePslString(constraintName)}"`)]);
}

export function parseDefaultAttributeString(attributeText: string): PslFieldAttribute {
  // Strip leading "@default(" and trailing ")" — `mapDefault` always returns one
  // top-level positional expression.
  const inner = attributeText.replace(/^@default\(/, '').replace(/\)$/, '');
  return buildAttribute('field', 'default', [positionalArg(inner)]);
}

export function buildMapAttribute(
  target: 'model' | 'field' | 'enum',
  mapName: string,
): PslAttribute {
  return buildAttribute(target, 'map', [positionalArg(`"${escapePslString(mapName)}"`)]);
}

export function buildAttribute(
  target: PslAttribute['target'],
  name: string,
  args: readonly PslAttributeArgument[],
): PslAttribute {
  return {
    kind: 'attribute',
    target,
    name,
    args,
    span: SYNTHETIC_SPAN,
  };
}

export function positionalArg(value: string): PslAttributeArgument {
  return { kind: 'positional', value, span: SYNTHETIC_SPAN };
}

export function namedArg(name: string, value: string): PslAttributeArgument {
  return { kind: 'named', name, value, span: SYNTHETIC_SPAN };
}

export function escapePslString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/**
 * Prints one default value as the PSL literal its field's codec accepts at `contract emit`, or
 * returns `undefined` when that codec accepts no PSL literal for the value.
 */
export type PslDefaultValueFormat = (value: unknown) => string | undefined;

const INTEGER_TEXT = /^-?\d+$/;
const SPECIAL_VALUE_TEXT = /^(?:NaN|-?Infinity)$/;
const DECIMAL_TEXT = /^(?:-?\d+(?:\.\d+)?|NaN|-?Infinity)$/;

/** PSL has no exponent syntax, so the decimal point moves to where the exponent puts it. */
function plainNumeral(value: number): string {
  const [coefficient = '', exponent] = String(value).split('e');
  if (exponent === undefined) return coefficient;
  const sign = coefficient.startsWith('-') ? '-' : '';
  const [whole = '', fraction = ''] = coefficient.slice(sign.length).split('.');
  const digits = `${whole}${fraction}`;
  const point = whole.length + Number(exponent);
  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${'0'.repeat(point - digits.length)}`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

export const formatPslValue: PslDefaultValueFormat = (value) => {
  if (typeof value === 'string') return `"${escapePslString(value)}"`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
};

const formatNumber: PslDefaultValueFormat = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? plainNumeral(value) : undefined;

/** PSL has no number for `NaN` or `Infinity`; the float codecs pass their quoted text through. */
const formatFloat: PslDefaultValueFormat = (value) =>
  typeof value === 'string' && SPECIAL_VALUE_TEXT.test(value) ? `"${value}"` : formatNumber(value);

/**
 * `pg/int8@1` reads a PSL number from the text written, so every digit of an `int8` survives. A
 * PSL string is not a `bigint`. A JavaScript number past the safe integer range is already rounded.
 */
const formatInteger: PslDefaultValueFormat = (value) => {
  if (typeof value === 'string') return INTEGER_TEXT.test(value) ? value : undefined;
  return typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : undefined;
};

/**
 * `pg/numeric@1` stores decimal text, `NaN` or `Infinity`, and reads a PSL string as that text. A
 * PSL number would also keep every digit, but has no spelling for `NaN` or `Infinity`.
 */
const formatDecimalText: PslDefaultValueFormat = (value) => {
  const text = typeof value === 'number' && Number.isFinite(value) ? plainNumeral(value) : value;
  return typeof text === 'string' && DECIMAL_TEXT.test(text) ? `"${text}"` : undefined;
};

/**
 * The codecs of `Date`, `Time`, `Timestamp` and `Timestamptz` encode Temporal values, which no PSL
 * literal is. A JSON codec reads a PSL string as a JSON string, not as JSON text, so a JSON default
 * keeps its raw expression.
 */
const noLiteral: PslDefaultValueFormat = () => undefined;

const DEFAULT_VALUE_FORMATS: ReadonlyMap<string, PslDefaultValueFormat> = new Map([
  ['Int', formatNumber],
  ['SmallInt', formatNumber],
  ['Float', formatFloat],
  ['Real', formatFloat],
  ['BigInt', formatInteger],
  ['Numeric', formatDecimalText],
  ['Date', noLiteral],
  ['Time', noLiteral],
  ['Timestamp', noLiteral],
  ['Timestamptz', noLiteral],
  ['Json', noLiteral],
  ['Jsonb', noLiteral],
]);

/** The default value format for a field of a PSL type the Postgres type map resolves. */
export function pslDefaultValueFormat(typeName: string): PslDefaultValueFormat {
  return DEFAULT_VALUE_FORMATS.get(typeName) ?? formatPslValue;
}

/**
 * Formats a resolved list default as PSL literal-list syntax (`[1, 2]`, `["a"]`, `[]`), or returns
 * `undefined` when any element has no literal, such as `null` or a value `format` refuses.
 */
export function formatPslListLiteralValue(
  elements: readonly unknown[],
  format: PslDefaultValueFormat,
): string | undefined {
  const parts: string[] = [];
  for (const element of elements) {
    const part = format(element);
    if (part === undefined) return undefined;
    parts.push(part);
  }
  return `[${parts.join(', ')}]`;
}

/**
 * Resolves a `SqlColumnIR.default` value into a normalized {@link ColumnDefault}.
 *
 * `SqlSchemaIR` types the column default as `string` (a raw database default
 * expression). Some legacy fixtures and tests still pass already-normalized
 * `ColumnDefault` objects in the same slot, so we accept either shape
 * defensively at runtime.
 */
export function parseColumnDefault(
  value: unknown,
  nativeType: string | undefined,
  rawDefaultParser: PslPrinterOptions['parseRawDefault'],
): ColumnDefault | undefined {
  if (typeof value === 'string') {
    return rawDefaultParser ? rawDefaultParser(value, nativeType) : undefined;
  }
  return isColumnDefault(value) ? value : undefined;
}
