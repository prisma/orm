import type { JsonValue } from '@internal/contract/types';

const DECIMAL_TEXT = /^([+-]?)(\d*)(?:\.(\d*))?$/;

/**
 * The key two decimal texts share exactly when they are the same number, for a data type that stores a decimal as text and keeps the scale it was written with, as `numeric` stores `0.5` and `0.50`: leading zeros, trailing fraction zeros and the sign of zero do not count. `NaN` and the infinities keep their own keys.
 */
export function decimalTextEqualityKey(json: JsonValue): string {
  const text = String(json);
  const match = DECIMAL_TEXT.exec(text);
  if (match === null) return text;
  const [, sign = '', whole = '', fraction = ''] = match;
  const digits = whole.replace(/^0+/, '');
  const decimals = fraction.replace(/0+$/, '');
  if (digits === '' && decimals === '') return '0';
  const magnitude = decimals === '' ? digits || '0' : `${digits || '0'}.${decimals}`;
  return sign === '-' ? `-${magnitude}` : magnitude;
}
