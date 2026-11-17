const DECIMAL_TEXT = /^-?\d+(?:\.\d+)?$/;
const DECIMAL_TEXT_WITH_EXPONENT = /^(-?)(\d+)(?:\.(\d+))?(?:E([+-]\d+))?$/;

/** Whether `text` is a decimal numeral without an exponent: an optional minus sign, digits, and an optional fraction, as in `-12.50`. */
export function isDecimalText(text: string): boolean {
  return DECIMAL_TEXT.test(text);
}

/** Decimal text without the leading zeros of its whole part; the sign of zero and trailing zeros stay, as in `-0.10` for `-00.10`. */
export function decimalTextWithoutLeadingZeros(text: string): string {
  return text.replace(/^(-?)0+(?=\d)/, '$1');
}

/** Decimal text without a minus sign on zero, as in `0.00` for `-0.00`. */
export function decimalTextWithoutSignOfZero(text: string): string {
  return /^-[0.]+$/.test(text) ? text.slice(1) : text;
}

/** Decimal text in the form a database prints it: no leading zeros and no minus sign on zero. Trailing zeros stay, because they are the scale the value was written with. */
export function printedDecimalText(text: string): string {
  return decimalTextWithoutSignOfZero(decimalTextWithoutLeadingZeros(text));
}

/**
 * Decimal text that may carry an exponent, such as `1E+3` or `1.23E-5`, written without one: the point moves to where the exponent puts it, trailing zeros stay, and the sign of zero goes. `NaN`, `Infinity` and `-Infinity` are returned as they are. Returns `undefined` for any other text.
 */
export function decimalTextWithoutExponent(text: string): string | undefined {
  if (text === 'NaN' || text === 'Infinity' || text === '-Infinity') return text;
  const match = DECIMAL_TEXT_WITH_EXPONENT.exec(text);
  if (match === null) return undefined;
  const [, sign = '', whole = '', fraction = '', exponent = '0'] = match;
  const digits = `${whole}${fraction}`;
  const point = whole.length + Number(exponent);
  let integerPart: string;
  let fractionPart: string;
  if (point <= 0) {
    integerPart = '0';
    fractionPart = `${'0'.repeat(-point)}${digits}`;
  } else if (point >= digits.length) {
    integerPart = `${digits}${'0'.repeat(point - digits.length)}`;
    fractionPart = '';
  } else {
    integerPart = digits.slice(0, point);
    fractionPart = digits.slice(point);
  }
  const trimmedInteger = integerPart.replace(/^0+(?=\d)/, '');
  const unsigned = fractionPart === '' ? trimmedInteger : `${trimmedInteger}.${fractionPart}`;
  return /^[0.]+$/.test(unsigned) ? unsigned : `${sign}${unsigned}`;
}
