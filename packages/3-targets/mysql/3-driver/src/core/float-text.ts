const SIGNIFICANT_DIGITS = 6;
const MAX_FIXED_DIGITS = 15;

/** The exact decimal digits of a finite 32-bit float's magnitude, and where the decimal point falls in them. */
function exactDigits(bits: number): { readonly digits: string; readonly pointAt: number } {
  const biasedExponent = (bits >>> 23) & 0xff;
  const fraction = BigInt(bits & 0x7fffff);
  const significand = biasedExponent === 0 ? fraction : fraction | (1n << 23n);
  const binaryExponent = biasedExponent === 0 ? -149 : biasedExponent - 150;
  if (binaryExponent >= 0) {
    const digits = (significand << BigInt(binaryExponent)).toString();
    return { digits, pointAt: digits.length };
  }
  const digits = (significand * 5n ** BigInt(-binaryExponent)).toString();
  return { digits, pointAt: digits.length + binaryExponent };
}

/** `digits` rounded to six significant digits, ties to even, without trailing zeros, and where the decimal point falls in them. */
function roundedDigits(digits: string, pointAt: number): { digits: string; pointAt: number } {
  if (digits.length <= SIGNIFICANT_DIGITS) return { digits: digits.replace(/0+$/, ''), pointAt };
  const kept = digits.slice(0, SIGNIFICANT_DIGITS);
  const first = digits[SIGNIFICANT_DIGITS] ?? '0';
  const tie = first === '5' && !/[1-9]/.test(digits.slice(SIGNIFICANT_DIGITS + 1));
  const roundsUp = first > '5' || (first === '5' && (!tie || Number(kept.at(-1)) % 2 === 1));
  if (!roundsUp) return { digits: kept.replace(/0+$/, ''), pointAt };
  const raised = (BigInt(kept) + 1n).toString();
  return raised.length > SIGNIFICANT_DIGITS
    ? { digits: raised.slice(0, SIGNIFICANT_DIGITS).replace(/0+$/, ''), pointAt: pointAt + 1 }
    : { digits: raised.replace(/0+$/, ''), pointAt };
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
  const exact = exactDigits(bits);
  const { digits, pointAt } = roundedDigits(exact.digits, exact.pointAt);
  return mysqlNotation(negative, digits, pointAt);
}

/**
 * A DOUBLE's text as MySQL writes it over the text protocol: the fewest significant digits that read back as the same double, which JavaScript also prints, in MySQL's notation. Under a prepared statement MySQL sends the double in binary, and this gives it the same text.
 */
export function mysqlDoubleText(value: number): string {
  const negative = value < 0 || Object.is(value, -0);
  const [mantissa = '', exponent = ''] = Math.abs(value).toExponential().split('e');
  return mysqlNotation(negative, mantissa.replace('.', ''), Number(exponent) + 1);
}
