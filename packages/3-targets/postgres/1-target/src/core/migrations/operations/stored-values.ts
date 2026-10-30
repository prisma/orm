import { type RowsHoldingValueMark, rowsHoldingValueMeta } from '@internal/family-sql/control';
import { postgresCreateNamespace } from '../../postgres-schema';
import { quoteIdentifier } from '../../sql-utils';
import { qualifyTableName } from '../planner-sql-checks';
import { type Op, step, targetDetails } from './shared';

/** A stored value as operation ids, labels and step descriptions write it. */
export function storedValueText(value: string | number): string {
  return JSON.stringify(value);
}

function idText(value: string | number): string {
  return String(value);
}

function holdingValue(column: string, many: boolean): string {
  return many ? `$1 = ANY(${column})` : `${column} = $1`;
}

function valueAbsentCheck(
  schemaName: string,
  tableName: string,
  columnName: string,
  value: string | number,
  many: boolean,
) {
  const column = quoteIdentifier(columnName);
  return step(
    many
      ? `verify no list in column "${columnName}" of "${tableName}" holds value ${storedValueText(value)}`
      : `verify no row of "${tableName}" holds value ${storedValueText(value)} in column "${columnName}"`,
    `SELECT NOT EXISTS (SELECT 1 FROM ${qualifyTableName(schemaName, tableName)} WHERE ${holdingValue(column, many)}) AS result`,
    [value],
  );
}

export function replaceStoredValue(
  schemaName: string,
  tableName: string,
  columnName: string,
  from: string | number,
  to: string | number,
  many: boolean,
): Op {
  const column = quoteIdentifier(columnName);
  const replaced = many ? `array_replace(${column}, $1, $2)` : '$2';
  return {
    id: `replaceStoredValue.${tableName}.${columnName}.${idText(from)}`,
    label: `Replace value ${storedValueText(from)} with ${storedValueText(to)} in column "${columnName}" of "${tableName}"`,
    operationClass: 'widening',
    target: targetDetails('column', columnName, schemaName, tableName),
    precheck: [],
    execute: [
      step(
        `replace value ${storedValueText(from)} with ${storedValueText(to)} in column "${columnName}"`,
        `UPDATE ${qualifyTableName(schemaName, tableName)} SET ${column} = ${replaced} WHERE ${holdingValue(column, many)}`,
        [from, to],
      ),
    ],
    postcheck: [valueAbsentCheck(schemaName, tableName, columnName, from, many)],
  };
}

export function removeStoredValue(
  schemaName: string,
  tableName: string,
  columnName: string,
  value: string | number,
  many: boolean,
  mark: Pick<RowsHoldingValueMark, 'enumValue' | 'value' | 'codecRef'> | undefined,
): Op {
  const column = quoteIdentifier(columnName);
  const qualified = qualifyTableName(schemaName, tableName);
  const removed = many ? `array_remove(${column}, $1)` : 'NULL';
  const takesNull = `ensure column "${columnName}" of "${tableName}" takes NULL, or no row holds ${storedValueText(value)} in it`;
  return {
    id: `removeStoredValue.${tableName}.${columnName}.${idText(value)}`,
    label: `Remove value ${storedValueText(value)} from column "${columnName}" of "${tableName}"`,
    operationClass: 'destructive',
    target: targetDetails('column', columnName, schemaName, tableName),
    precheck: many
      ? []
      : [
          {
            ...step(
              takesNull,
              `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = ${schemaSqlExpression(schemaName)} AND table_name = $2 AND column_name = $3 AND is_nullable = 'YES') OR NOT EXISTS (SELECT 1 FROM ${qualified} WHERE ${column} = $1) AS result`,
              [value, tableName, columnName],
            ),
            ...(mark === undefined
              ? {}
              : {
                  meta: rowsHoldingValueMeta({
                    ...mark,
                    table: tableName,
                    column: columnName,
                    storedValue: value,
                  }),
                }),
          },
        ],
    execute: [
      step(
        `remove value ${storedValueText(value)} from column "${columnName}"`,
        `UPDATE ${qualified} SET ${column} = ${removed} WHERE ${holdingValue(column, many)}`,
        [value],
      ),
    ],
    postcheck: [valueAbsentCheck(schemaName, tableName, columnName, value, many)],
  };
}

export function deleteRows(
  schemaName: string,
  tableName: string,
  columnName: string,
  value: string | number,
): Op {
  return {
    id: `deleteRows.${tableName}.${columnName}.${idText(value)}`,
    label: `Delete the rows of "${tableName}" that hold value ${storedValueText(value)} in column "${columnName}"`,
    operationClass: 'destructive',
    target: targetDetails('column', columnName, schemaName, tableName),
    precheck: [],
    execute: [
      step(
        `delete the rows of "${tableName}" that hold value ${storedValueText(value)} in column "${columnName}"`,
        `DELETE FROM ${qualifyTableName(schemaName, tableName)} WHERE ${quoteIdentifier(columnName)} = $1`,
        [value],
      ),
    ],
    postcheck: [valueAbsentCheck(schemaName, tableName, columnName, value, false)],
  };
}

function schemaSqlExpression(schemaName: string): string {
  return postgresCreateNamespace({ id: schemaName, entries: { table: {} } }).schemaSqlExpression();
}
