/**
 * Writing a stored value back as the literal a contract source wrote. The inverse of
 * {@link readLiteral}: a codec's declarations are tried in order and the first type that accepts
 * the value produces the literal's source text.
 *
 * ADR 254.
 */

import type { JsonValue } from '@internal/contract/types';
import {
  classifyNumberText,
  type LiteralTypeDeclaration,
  type LiteralTypeName,
} from './literal-types';

/**
 * One literal as source text. `text` is the complete literal, including the tag and its fence when
 * the type is written as a tagged literal; `tag` names that type so a caller can tell the two apart
 * without re-parsing.
 */
export interface WrittenLiteralText {
  readonly text: string;
  readonly tag?: LiteralTypeName;
}

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

/** A string as PSL source writes it, with the escapes its string decoder resolves. */
export function escapePslString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/** The text of a number-shaped value as a contract source would have written it. */
function numeralText(value: JsonValue): string | undefined {
  if (typeof value === 'number') return plainNumeral(value);
  return typeof value === 'string' ? value : undefined;
}

function writeNumber(value: JsonValue, type: LiteralTypeName): string | undefined {
  const text = numeralText(value);
  if (text === undefined) return undefined;
  const literal = classifyNumberText(text);
  if (literal === undefined || literal.type !== type) return undefined;
  return String(literal.value);
}

/**
 * A json body inside a backtick fence, which resolves `` \` `` and `\\` and nothing else — so a
 * `\n` in the JSON text survives as the two characters JSON wrote. A quote fence would resolve the
 * full PSL string escapes and change what the body reads back as, so it is never used.
 */
function writeJsonTag(value: JsonValue): WrittenLiteralText {
  const body = JSON.stringify(value).replace(/\\/g, '\\\\').replace(/`/g, '\\`');
  return { text: `json\`${body}\``, tag: 'json' };
}

function writeScalar(value: JsonValue, type: LiteralTypeName): WrittenLiteralText | undefined {
  switch (type) {
    case 'string':
      return typeof value === 'string' ? { text: `"${escapePslString(value)}"` } : undefined;
    case 'boolean':
      return typeof value === 'boolean' ? { text: String(value) } : undefined;
    case 'json':
      return writeJsonTag(value);
    case 'i8':
    case 'i16':
    case 'i32':
    case 'i64':
    case 'bigint':
    case 'decimal':
    case 'float': {
      const text = writeNumber(value, type);
      return text === undefined ? undefined : { text };
    }
  }
}

function writeList(
  value: JsonValue,
  elementTypes: readonly LiteralTypeName[],
): WrittenLiteralText | undefined {
  if (!Array.isArray(value)) return undefined;
  const parts: string[] = [];
  for (const element of value) {
    const written = firstWritten(element, elementTypes);
    if (written === undefined) return undefined;
    parts.push(written.text);
  }
  return { text: `[${parts.join(', ')}]` };
}

function firstWritten(
  value: JsonValue,
  types: readonly LiteralTypeName[],
): WrittenLiteralText | undefined {
  for (const type of types) {
    const written = writeScalar(value, type);
    if (written !== undefined) return written;
  }
  return undefined;
}

/**
 * The literal source text for a stored value, taking the first of `declarations` that accepts it,
 * or `undefined` when none does.
 */
export function writeLiteral(
  value: JsonValue,
  declarations: readonly LiteralTypeDeclaration[],
): WrittenLiteralText | undefined {
  for (const declaration of declarations) {
    const written =
      typeof declaration === 'string'
        ? writeScalar(value, declaration)
        : writeList(value, declaration.list);
    if (written !== undefined) return written;
  }
  return undefined;
}
