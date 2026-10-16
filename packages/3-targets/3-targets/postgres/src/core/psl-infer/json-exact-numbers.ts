type JsonReviver = (key: string, value: unknown, context?: { readonly source?: string }) => unknown;

const DECIMAL_PARTS_PATTERN = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

/** A numeral's value as `<sign><digits>e<exponent>`, with no leading or trailing zero digits. */
function decimalValue(numeral: string): string | undefined {
  const parts = DECIMAL_PARTS_PATTERN.exec(numeral);
  if (parts === null) return undefined;
  const [, sign = '', whole = '', fraction = '', exponent = '0'] = parts;
  const digits = `${whole}${fraction}`.replace(/^0+/, '');
  if (digits === '') return '0';
  const significant = digits.replace(/0+$/, '');
  const shift = Number(exponent) - fraction.length + digits.length - significant.length;
  return `${sign}${significant}e${shift}`;
}

function keepsJsonNumber(value: number, source: string | undefined): boolean {
  if (!Number.isFinite(value) || source === undefined) return false;
  const written = decimalValue(source);
  return written !== undefined && written === decimalValue(String(value));
}

/**
 * Whether every number in the JSON text keeps its value once read into a JavaScript number. Postgres keeps every digit of a json number, and the JSON codecs read one into a JavaScript number, so a document holding `12345678901234567890` or `1e400` would print back as another document. `1.0` reads as `1`, the same value. Text that is not JSON is left to the codec.
 */
export function jsonKeepsEveryNumber(text: string): boolean {
  let exact = true;
  const reviver: JsonReviver = (_key, value, context) => {
    if (typeof value === 'number' && !keepsJsonNumber(value, context?.source)) exact = false;
    return value;
  };
  try {
    JSON.parse(text, reviver);
  } catch {
    return true;
  }
  return exact;
}
