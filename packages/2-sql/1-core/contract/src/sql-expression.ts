import type { JsonValue } from '@internal/contract/types';
import type { DataTypeAuthoringEntry } from '@internal/framework-components/authoring';
import {
  canonicalizeTaggedLiteralBody,
  describeTaggedLiteralFailure,
  printTaggedLiteral,
  resolveTemplateTagEscapes,
  taggedLiteralTextReadsBack,
} from '@internal/framework-components/authoring';
import type { DataType, DataTypeId } from '@internal/framework-components/codec';
import { dataType, dataTypeId } from '@internal/framework-components/codec';
import { runtimeError } from '@internal/framework-components/components';
import { InternalError } from '@internal/utils/internal-error';
import { contractError } from './contract-errors';

export const SQL_EXPRESSION_DATA_TYPE_ID: DataTypeId = dataTypeId('sql/expression');
export const SQL_EXPRESSION_TAG = 'sql';

/** The data type of a SQL expression in the target database's language. It declares no casts. The SQL family registers it. ADR 254. */
export const sqlExpressionDataType: DataType = frozenWithCasts(
  dataType(SQL_EXPRESSION_DATA_TYPE_ID, {}),
);

/** PSL support for `sql/expression`. The SQL family registers it under `SQL_EXPRESSION_DATA_TYPE_ID`. */
export const sqlExpressionAuthoringEntry: DataTypeAuthoringEntry = Object.freeze({
  written: Object.freeze({ kind: 'tag', tag: SQL_EXPRESSION_TAG, parse: (text: string) => text }),
  print: (value: JsonValue) => sqlTextFromCanonical(value),
  documentation:
    "A SQL expression in the target database's language. Prisma passes it to the database unchanged.",
});

function frozenWithCasts(type: DataType): DataType {
  Object.freeze(type.casts);
  return Object.freeze(type);
}

export interface SqlExpressionRegistration {
  readonly dataTypes: readonly DataType[];
  readonly authoring: {
    readonly dataTypes: Readonly<Record<string, DataTypeAuthoringEntry>>;
  };
}

/** The SQL family's registration of `sql/expression`, shaped as the family descriptor's `dataTypes` and `authoring.dataTypes`. */
export const sqlExpressionRegistration: SqlExpressionRegistration = Object.freeze({
  dataTypes: Object.freeze([sqlExpressionDataType]),
  authoring: Object.freeze({
    dataTypes: Object.freeze({ [SQL_EXPRESSION_DATA_TYPE_ID]: sqlExpressionAuthoringEntry }),
  }),
});

/** The SQL text held by the canonical form of a `sql/expression` value. */
export function sqlTextFromCanonical(value: JsonValue): string {
  if (typeof value === 'string') return value;
  throw new InternalError(`A sql/expression value is a string, got ${JSON.stringify(value)}.`);
}

/** The text a `sql` literal holding `text` reads back as, or `undefined` when `text` has a NUL character or is too large. */
export function canonicalSqlText(text: string): string | undefined {
  const canonical = canonicalizeTaggedLiteralBody(text);
  return canonical.ok ? canonical.text : undefined;
}

/**
 * A `sql` literal holding `text`. Throws when the literal would read back as different text; check with `sqlTextsReadBack`
 * first. The result of `canonicalSqlText` always reads back.
 */
export function printSqlExpressionLiteral(text: string): string {
  if (!taggedLiteralTextReadsBack(text)) {
    throw new InternalError(
      `A sql literal cannot hold ${JSON.stringify(text)}: it would read back as different text.`,
    );
  }
  return printTaggedLiteral(SQL_EXPRESSION_TAG, text);
}

/** Whether every present text reads back unchanged when printed as a `sql` literal. */
export function sqlTextsReadBack(texts: readonly (string | undefined)[]): boolean {
  return texts.every((text) => text === undefined || taggedLiteralTextReadsBack(text));
}

function castFromSqlExpression(type: DataType): string | undefined {
  if (Object.hasOwn(type.casts, SQL_EXPRESSION_DATA_TYPE_ID)) return 'a cast';
  if (type.listCast?.of.includes(SQL_EXPRESSION_DATA_TYPE_ID)) return 'a list cast';
  return undefined;
}

/**
 * Throws when a data type declares a cast or a list cast from `sql/expression`. A `sql` literal is
 * SQL the database runs, so a cast would turn it into a value of another type with no diagnostic.
 * ADR 254.
 */
export function assertNothingCastsFromSqlExpression(
  declaredDataTypes: ReadonlyArray<{ readonly type: DataType; readonly contributedBy: string }>,
): void {
  for (const { type, contributedBy } of declaredDataTypes) {
    const declared = castFromSqlExpression(type);
    if (declared === undefined) continue;
    throw runtimeError(
      'CONTRACT.DATA_TYPE_CASTS_FROM_SQL_EXPRESSION',
      `Data type "${type.id}" from "${contributedBy}" declares ${declared} from ${SQL_EXPRESSION_DATA_TYPE_ID}. No data type may cast from ${SQL_EXPRESSION_DATA_TYPE_ID}: a ${SQL_EXPRESSION_TAG} literal is SQL the database runs, not a value of another type.`,
      { dataType: type.id, contributedBy },
    );
  }
}

const SQL_EXPRESSION_MARKER: unique symbol = Symbol.for('@prisma/sql-expression');

/** A value of the data type `sql/expression` in TypeScript. Its text is always canonical. */
export class SqlExpression {
  readonly [SQL_EXPRESSION_MARKER] = true as const;
  readonly text: string;

  /** Canonicalizes `text` as a PSL `sql` literal's text is canonicalized. Throws CONTRACT.SQL_EXPRESSION_INVALID on NUL or oversize text. */
  constructor(text: string) {
    const canonical = canonicalizeTaggedLiteralBody(text);
    if (!canonical.ok) {
      throw contractError(
        'CONTRACT.SQL_EXPRESSION_INVALID',
        describeTaggedLiteralFailure(canonical.reason),
        { meta: { reason: canonical.reason, offset: canonical.offset } },
      );
    }
    this.text = canonical.text;
    Object.freeze(this);
  }
}

export function isSqlExpression(value: unknown): value is SqlExpression {
  return (
    typeof value === 'object' &&
    value !== null &&
    Reflect.get(value, SQL_EXPRESSION_MARKER) === true
  );
}

/** Raw SQL written as a template literal: `` sql`"userId" = auth.uid()` ``. Other `sql` values may be interpolated; each later line of one takes the indentation of the template line it sits on. */
export function sql(
  strings: TemplateStringsArray,
  ...values: readonly SqlExpression[]
): SqlExpression {
  const texts = values.map((value, index) => {
    if (!isSqlExpression(value)) {
      throw contractError(
        'CONTRACT.SQL_EXPRESSION_INTERPOLATION',
        'sql`...` only interpolates other sql`...` values; write any other text inside the template.',
        { meta: { index } },
      );
    }
    return value.text;
  });
  const pieces = strings.raw.map((piece) => resolveTemplateTagEscapes(piece));
  let joined = pieces[0] ?? '';
  let templateLineIndent = indentOfLastLine(joined);
  texts.forEach((value, index) => {
    const piece = pieces[index + 1] ?? '';
    joined += value.replaceAll('\n', `\n${templateLineIndent}`) + piece;
    if (/[\n\r]/.test(piece)) templateLineIndent = indentOfLastLine(piece);
  });
  return new SqlExpression(joined);
}

function indentOfLastLine(templatePiece: string): string {
  const lastLine = templatePiece.slice(
    Math.max(templatePiece.lastIndexOf('\n'), templatePiece.lastIndexOf('\r')) + 1,
  );
  return LEADING_WHITESPACE.exec(lastLine)?.[0] ?? '';
}

const LEADING_WHITESPACE = /^[ \t]*/;

/** Returns `value` when it is a `SqlExpression`; throws for anything else. For callers that JavaScript cannot type-check. */
export function requireSqlExpression(value: unknown, what: string): SqlExpression {
  if (isSqlExpression(value)) return value;
  throw contractError('CONTRACT.ARGUMENT_INVALID', `${what} must be a sql\`...\` value.`, {
    meta: { what },
  });
}
