import type { JsonValue } from '@internal/contract/types';
import type { DataTypeAuthoringEntry } from '@internal/framework-components/authoring';
import { printTaggedLiteral } from '@internal/framework-components/authoring';
import type { DataType, DataTypeId } from '@internal/framework-components/codec';
import { dataType, dataTypeId } from '@internal/framework-components/codec';
import { runtimeError } from '@internal/framework-components/components';
import { InternalError } from '@internal/utils/internal-error';

export const SQL_EXPRESSION_DATA_TYPE_ID: DataTypeId = dataTypeId('sql/expression');
export const SQL_EXPRESSION_TAG = 'sql';

/** The data type of a SQL expression in the target database's language. It declares no casts. The SQL family registers it. ADR 254. */
export const sqlExpressionDataType: DataType = dataType(SQL_EXPRESSION_DATA_TYPE_ID, {});

/** PSL support for `sql/expression`. The SQL family registers it under `SQL_EXPRESSION_DATA_TYPE_ID`. */
export const sqlExpressionAuthoringEntry: DataTypeAuthoringEntry = {
  written: { kind: 'tag', tag: SQL_EXPRESSION_TAG, parse: (text) => text },
  print: (value) => sqlTextFromCanonical(value),
  documentation:
    "A SQL expression in the target database's language. Prisma passes it to the database unchanged.",
};

/** The SQL text held by the canonical form of a `sql/expression` value. */
export function sqlTextFromCanonical(value: JsonValue): string {
  if (typeof value === 'string') return value;
  throw new InternalError(`A sql/expression value is a string, got ${JSON.stringify(value)}.`);
}

/** A `sql` literal holding `text`, as `contract infer` prints it. */
export function printSqlExpressionLiteral(text: string): string {
  return printTaggedLiteral(SQL_EXPRESSION_TAG, text);
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
