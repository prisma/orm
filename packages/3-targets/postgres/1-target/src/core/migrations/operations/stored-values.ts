import type { JsonValue } from '@internal/contract/types';
import {
  type JsonPath,
  type JsonPathStep,
  parseJsonPath,
  type RowsHoldingValueMark,
  rowsHoldingValueMeta,
} from '@internal/family-sql/control';
import { InternalError } from '@internal/utils/internal-error';
import { postgresCreateNamespace } from '../../postgres-schema';
import { quoteIdentifier } from '../../sql-utils';
import { qualifyTableName } from '../planner-sql-checks';
import {
  jsonPathMatches,
  jsonRewrite,
  keyLiteral,
  memberEqualsFilter,
  rewrittenList,
} from './json-rewrite';
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

function pathParts(path: JsonPath): {
  readonly reach: readonly JsonPathStep[];
  readonly last: JsonPathStep;
} {
  const last = path.steps.at(-1);
  if (last === undefined) throw new InternalError('A stored value path ends at a selector');
  return { reach: path.steps.slice(0, -1), last };
}

/** Whether `column` holds the JSON value of parameter `param` at the end of `path`. */
function holdsAtPath(column: string, path: JsonPath, param: string): string {
  const { reach, last } = pathParts(path);
  return last.kind === 'member'
    ? jsonPathMatches(column, reach, 'object', memberEqualsFilter(last.name), `${param}::jsonb`)
    : jsonPathMatches(column, reach, 'array', 'exists(@[*] ? (@ == $v))', `${param}::jsonb`);
}

/** The `jsonb` expression that sets the value at the end of `path` that equals `$1` to `replacement`, or removes it from a list when `replacement` is undefined. */
function rewriteAtPath(column: string, path: JsonPath, replacement: string | undefined): string {
  const { reach, last } = pathParts(path);
  if (last.kind === 'member') {
    const key = keyLiteral(last.name);
    return jsonRewrite(
      column,
      reach,
      (object) =>
        `CASE WHEN jsonb_typeof(${object}) = 'object' AND ${object} -> ${key} = $1::jsonb THEN jsonb_set(${object}, ARRAY[${key}], ${replacement ?? "'null'::jsonb"}) ELSE ${object} END`,
    );
  }
  return jsonRewrite(column, reach, (list, depth) => {
    const rewritten =
      replacement === undefined
        ? rewrittenList(
            list,
            depth,
            (element) => element,
            (element) => `${element} <> $1::jsonb`,
          )
        : rewrittenList(
            list,
            depth,
            (element) => `CASE WHEN ${element} = $1::jsonb THEN ${replacement} ELSE ${element} END`,
          );
    return `CASE WHEN jsonb_typeof(${list}) = 'array' THEN ${rewritten} ELSE ${list} END`;
  });
}

function atPath(path: JsonPath, tableName: string, columnName: string): string {
  return `at path ${JSON.stringify(path.text)} in column "${columnName}" of "${tableName}"`;
}

function valueAbsentAtPathCheck(
  schemaName: string,
  tableName: string,
  columnName: string,
  value: JsonValue,
  path: JsonPath,
) {
  return step(
    `verify no row holds value ${JSON.stringify(value)} ${atPath(path, tableName, columnName)}`,
    `SELECT NOT EXISTS (SELECT 1 FROM ${qualifyTableName(schemaName, tableName)} WHERE ${holdsAtPath(quoteIdentifier(columnName), path, '$1')}) AS result`,
    [JSON.stringify(value)],
  );
}

/** The condition and parameters that find the rows of a column that hold a stored value, at `path` inside its JSON when it is given. */
export function holdingStoredValue(
  columnName: string,
  storedValue: string | number,
  path: string | undefined,
): { readonly condition: string; readonly params: readonly unknown[] } {
  const column = quoteIdentifier(columnName);
  if (path === undefined) return { condition: `${column} = $1`, params: [storedValue] };
  const parsed = parseJsonPath(path);
  if (!parsed.ok) throw new InternalError(`A stored value path is a JSON path: ${parsed.failure}`);
  return {
    condition: holdsAtPath(column, parsed.value, '$1'),
    params: [JSON.stringify(storedValue)],
  };
}

export function replaceStoredValueAtPath(
  schemaName: string,
  tableName: string,
  columnName: string,
  from: string | number,
  to: string | number,
  path: JsonPath,
): Op {
  const column = quoteIdentifier(columnName);
  const place = atPath(path, tableName, columnName);
  return {
    id: `replaceStoredValue.${tableName}.${columnName}.${path.text}.${idText(from)}`,
    label: `Replace value ${storedValueText(from)} with ${storedValueText(to)} ${place}`,
    operationClass: 'widening',
    target: targetDetails('column', columnName, schemaName, tableName),
    precheck: [],
    execute: [
      step(
        `replace value ${storedValueText(from)} with ${storedValueText(to)} ${place}`,
        `UPDATE ${qualifyTableName(schemaName, tableName)} SET ${column} = ${rewriteAtPath(column, path, '$2::jsonb')} WHERE ${holdsAtPath(column, path, '$1')}`,
        [JSON.stringify(from), JSON.stringify(to)],
      ),
    ],
    postcheck: [valueAbsentAtPathCheck(schemaName, tableName, columnName, from, path)],
  };
}

/**
 * Removes a stored value inside JSON: takes it out of a list when `path` ends at `[*]`, else sets
 * the member to JSON `null`. When the member takes no null, the check fails while a row holds the
 * value.
 */
export function removeStoredValueAtPath(
  schemaName: string,
  tableName: string,
  columnName: string,
  value: string | number,
  path: JsonPath,
  nullable: boolean,
  mark: Pick<RowsHoldingValueMark, 'enumValue' | 'value' | 'codecRef'> | undefined,
): Op {
  const column = quoteIdentifier(columnName);
  const qualified = qualifyTableName(schemaName, tableName);
  const place = atPath(path, tableName, columnName);
  const holds = holdsAtPath(column, path, '$1');
  const required = pathParts(path).last.kind === 'member' && !nullable;
  return {
    id: `removeStoredValue.${tableName}.${columnName}.${path.text}.${idText(value)}`,
    label: `Remove value ${storedValueText(value)} ${place}`,
    operationClass: 'destructive',
    target: targetDetails('column', columnName, schemaName, tableName),
    precheck: required
      ? [
          {
            ...step(
              `ensure no row holds ${storedValueText(value)} ${place}, a member that takes no null`,
              `SELECT NOT EXISTS (SELECT 1 FROM ${qualified} WHERE ${holds}) AS result`,
              [JSON.stringify(value)],
            ),
            ...(mark === undefined
              ? {}
              : {
                  meta: rowsHoldingValueMeta({
                    ...mark,
                    table: tableName,
                    column: columnName,
                    storedValue: value,
                    path: path.text,
                  }),
                }),
          },
        ]
      : [],
    execute: [
      step(
        `remove value ${storedValueText(value)} ${place}`,
        `UPDATE ${qualified} SET ${column} = ${rewriteAtPath(column, path, undefined)} WHERE ${holds}`,
        [JSON.stringify(value)],
      ),
    ],
    postcheck: [valueAbsentAtPathCheck(schemaName, tableName, columnName, value, path)],
  };
}
