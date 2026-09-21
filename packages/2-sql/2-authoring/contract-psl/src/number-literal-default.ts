import type { JsonValue } from '@internal/contract/types';
import type { Codec, CodecLookup } from '@internal/framework-components/codec';
import type { AuthoredColumnDefaultLiteralValue } from '@internal/sql-contract-ts/contract-builder';

/**
 * The default value a number literal gives a column whose codec holds numbers. Returns `undefined`
 * when the codec does not hold numbers, or reads the literal neither as a JSON number nor as
 * decimal text.
 */
export function numberLiteralDefault(
  text: string,
  codecId: string,
  codecLookup: CodecLookup | undefined,
): AuthoredColumnDefaultLiteralValue | undefined {
  const codec = numberHoldingCodec(codecLookup, codecId);
  if (codec === undefined) return undefined;
  const number = Number(text);
  if (tryDecodeJson(codec, number) !== undefined) return number;
  const decoded = tryDecodeJson(codec, canonicalDecimalText(text));
  return decoded !== undefined && isNumberValue(decoded.value) ? decoded.value : undefined;
}

function numberHoldingCodec(
  codecLookup: CodecLookup | undefined,
  codecId: string,
): Codec | undefined {
  const holdsNumbers = codecLookup?.descriptorFor?.(codecId)?.traits.includes('numeric') === true;
  return holdsNumbers ? codecLookup?.get(codecId) : undefined;
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

function isNumberValue(value: unknown): value is string | number | bigint {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint';
}

function tryDecodeJson(codec: Codec, json: JsonValue): { readonly value: unknown } | undefined {
  try {
    return { value: codec.decodeJson(json) };
  } catch {
    return undefined;
  }
}
