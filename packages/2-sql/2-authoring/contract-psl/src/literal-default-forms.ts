import type { ColumnDefaultLiteralValue } from '@internal/contract/types';
import type { ExpressionAst } from '@internal/psl-parser/syntax';
import { ArrayLiteralAst, NumberLiteralExprAst } from '@internal/psl-parser/syntax';
import { blindCast } from '@internal/utils/casts';
import { notOk, ok, type Result } from '@internal/utils/result';

/**
 * Codecs whose literal `@default` value takes a different form from the PSL
 * token that spells it: an integer literal on a bigint-valued codec is the
 * exact integer, and a string literal on a JSON codec is JSON text. Codec
 * descriptors expose no such discriminator (their traits are equality, order,
 * boolean, numeric, and textual), so the codecs are named here. The Postgres
 * printer keeps the inverse lists in
 * `packages/3-targets/3-targets/postgres/src/core/psl-print/print-defaults.ts`;
 * its `print-defaults.test.ts` asserts the two agree.
 */
const BIGINT_LITERAL_CODEC_IDS: ReadonlySet<string> = new Set([
  'pg/int8@1',
  'pg/unboundedint@1',
  'sqlite/bigint@1',
]);
const JSON_LITERAL_CODEC_IDS: ReadonlySet<string> = new Set([
  'pg/json@1',
  'pg/jsonb@1',
  'sqlite/json@1',
]);

export type LiteralDefaultForm = 'bigint' | 'json';

export function literalDefaultForm(codecId: string): LiteralDefaultForm | undefined {
  if (BIGINT_LITERAL_CODEC_IDS.has(codecId)) return 'bigint';
  if (JSON_LITERAL_CODEC_IDS.has(codecId)) return 'json';
  return undefined;
}

/**
 * Builds the bigint from the number token's source text, never through a JS
 * `number`, which rounds past 2^53. A token that is not a plain integer is
 * left as parsed for the codec to judge.
 */
export function bigintLiteralFromToken(
  expression: ExpressionAst | undefined,
  parsed: ColumnDefaultLiteralValue,
): ColumnDefaultLiteralValue {
  const text =
    expression === undefined
      ? undefined
      : NumberLiteralExprAst.cast(expression.syntax)?.token()?.text;
  if (text === undefined || !/^-?\d+$/.test(text)) return parsed;
  return blindCast<
    ColumnDefaultLiteralValue,
    'the bigint codecs encode a bigint to JSON as decimal text'
  >(BigInt(text));
}

export function jsonLiteralFromText(text: string): Result<ColumnDefaultLiteralValue, string> {
  try {
    return ok(
      blindCast<ColumnDefaultLiteralValue, 'JSON.parse yields a JSON value'>(JSON.parse(text)),
    );
  } catch (error) {
    return notOk(error instanceof Error ? error.message : String(error));
  }
}

export function listElementExpressions(
  expression: ExpressionAst | undefined,
): readonly ExpressionAst[] | undefined {
  if (expression === undefined) return undefined;
  const array = ArrayLiteralAst.cast(expression.syntax);
  return array === undefined ? undefined : [...array.elements()];
}
