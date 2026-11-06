/**
 * A number as a contract source writes it: no exponent, because no schema language has that syntax,
 * so the decimal point moves to where the exponent puts it. A non-finite number is its own word.
 */
export function numeralText(value: number): string {
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
