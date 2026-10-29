const SIGNIFICANT_DIGITS = 6;
const MAX_FIXED_DIGITS = 15;

/** The exact decimal digits of `significand` × 2^`binaryExponent`, and where the decimal point falls in them. */
function exactDigits(
  significand: bigint,
  binaryExponent: number,
): { readonly digits: string; readonly pointAt: number } {
  if (binaryExponent >= 0) {
    const digits = (significand << BigInt(binaryExponent)).toString();
    return { digits, pointAt: digits.length };
  }
  const digits = (significand * 5n ** BigInt(-binaryExponent)).toString();
  return { digits, pointAt: digits.length + binaryExponent };
}

/** The exact decimal digits of a finite, non-zero 32-bit float's magnitude, and where the decimal point falls in them. */
function exactFloatDigits(bits: number): { readonly digits: string; readonly pointAt: number } {
  const biasedExponent = (bits >>> 23) & 0xff;
  const fraction = BigInt(bits & 0x7fffff);
  return biasedExponent === 0
    ? exactDigits(fraction, -149)
    : exactDigits(fraction | (1n << 23n), biasedExponent - 150);
}

/** The exact decimal digits of a finite, non-zero double's magnitude, and where the decimal point falls in them. */
function exactDoubleDigits(value: number): { readonly digits: string; readonly pointAt: number } {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  const biasedExponent = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & ((1n << 52n) - 1n);
  return biasedExponent === 0
    ? exactDigits(fraction, -1074)
    : exactDigits(fraction | (1n << 52n), biasedExponent - 1075);
}

/** `digits`, with the decimal point at `pointAt`, rounded to their first `kept` digits, ties to even, and where the decimal point then falls. Rounding to no digits at all gives zero. */
function roundedTo(
  digits: string,
  pointAt: number,
  kept: number,
): { digits: string; pointAt: number } {
  if (digits.length <= kept) return { digits, pointAt };
  if (kept < 0) return { digits: '0', pointAt: 1 };
  const head = digits.slice(0, kept);
  const first = digits[kept] ?? '0';
  const tie = first === '5' && !/[1-9]/.test(digits.slice(kept + 1));
  const roundsUp = first > '5' || (first === '5' && (!tie || Number(head.at(-1) ?? '0') % 2 === 1));
  if (!roundsUp) return head === '' ? { digits: '0', pointAt: 1 } : { digits: head, pointAt };
  const raised = (BigInt(`0${head}`) + 1n).toString();
  return { digits: raised, pointAt: raised.length > kept ? pointAt + 1 : pointAt };
}

function withoutTrailingZeros(digits: string): string {
  return digits.replace(/0+$/, '');
}

/** The fewest significant digits that read back as the double `magnitude`, which JavaScript also prints, and where the decimal point falls in them. */
function shortestDigits(magnitude: number): { readonly digits: string; readonly pointAt: number } {
  const [mantissa = '', exponent = ''] = magnitude.toExponential().split('e');
  return { digits: mantissa.replace('.', ''), pointAt: Number(exponent) + 1 };
}

function fixed(digits: string, pointAt: number): string {
  if (pointAt <= 0) return `0.${'0'.repeat(-pointAt)}${digits}`;
  if (pointAt < digits.length) return `${digits.slice(0, pointAt)}.${digits.slice(pointAt)}`;
  return digits.padEnd(pointAt, '0');
}

function scientific(digits: string, pointAt: number): string {
  const fraction = digits.slice(1);
  return `${digits[0]}${fraction === '' ? '' : `.${fraction}`}e${pointAt - 1}`;
}

/** Significant `digits` with the decimal point at `pointAt` in MySQL's notation: fixed unless that needs more than 14 zeros after the point, or more than 15 digits before it with none after it. */
function mysqlNotation(negative: boolean, digits: string, pointAt: number): string {
  const isFixed =
    pointAt > -MAX_FIXED_DIGITS && (pointAt <= MAX_FIXED_DIGITS || digits.length > pointAt);
  return `${negative ? '-' : ''}${isFixed ? fixed(digits, pointAt) : scientific(digits, pointAt)}`;
}

/**
 * A FLOAT's text as MySQL writes it over the text protocol: six significant digits, rounded half to even, without trailing zeros, in MySQL's notation. Under a prepared statement MySQL sends the 32-bit float in binary, and this gives it the same text.
 */
export function mysqlFloatText(value: number): string {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value);
  const bits = view.getUint32(0);
  const negative = bits >>> 31 === 1;
  if ((bits & 0x7fffffff) === 0) return mysqlNotation(negative, '0', 1);
  const exact = exactFloatDigits(bits);
  const { digits, pointAt } = roundedTo(exact.digits, exact.pointAt, SIGNIFICANT_DIGITS);
  return mysqlNotation(negative, withoutTrailingZeros(digits), pointAt);
}

/**
 * A DOUBLE's text as MySQL writes it over the text protocol: the fewest significant digits that read back as the same double, which JavaScript also prints, in MySQL's notation. Under a prepared statement MySQL sends the double in binary, and this gives it the same text.
 */
export function mysqlDoubleText(value: number): string {
  const negative = value < 0 || Object.is(value, -0);
  const { digits, pointAt } = shortestDigits(Math.abs(value));
  return mysqlNotation(negative, digits, pointAt);
}

function digitsToDecimals(
  magnitude: number,
  decimals: number,
): { digits: string; pointAt: number } {
  const shortest = shortestDigits(magnitude);
  if (shortest.digits.length - shortest.pointAt <= decimals) return shortest;
  const exact = exactDoubleDigits(magnitude);
  return roundedTo(exact.digits, exact.pointAt, exact.pointAt + decimals);
}

/**
 * A FLOAT or DOUBLE column declared with `decimals`, such as `DOUBLE(10,2)`, as MySQL writes it over the text protocol, a FLOAT's value read as a double: the fewest significant digits that read back as the same double, padded with zeros to `decimals` digits after the point when they fit, and otherwise the exact value rounded to `decimals` digits after the point, ties to even, in fixed notation. Negative zero, which a computed column such as `-price` can hold, keeps its sign.
 */
export function mysqlFixedDecimalsText(value: number, decimals: number): string {
  const { digits, pointAt } = digitsToDecimals(Math.abs(value), decimals);
  const whole = pointAt > 0 ? digits.slice(0, pointAt).padEnd(pointAt, '0') : '0';
  const fraction = `${'0'.repeat(Math.max(-pointAt, 0))}${digits.slice(Math.max(pointAt, 0))}`
    .padEnd(decimals, '0')
    .slice(0, decimals);
  return `${value < 0 || Object.is(value, -0) ? '-' : ''}${whole}${decimals === 0 ? '' : `.${fraction}`}`;
}
