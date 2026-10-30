import {
  type JsonPath,
  type JsonPathStep,
  parseJsonPath,
  type RowsHoldingValueMark,
  rowsHoldingValueMeta,
} from '@internal/family-sql/control';
import { InternalError } from '@internal/utils/internal-error';
import { quoteIdentifier } from '../../sql-utils';
import { buildTargetDetails } from '../planner-target-details';
import { jsonMatches, jsonRewrite, memberPath, rewrittenList, someElement } from './json-rewrite';
import { type Op, step } from './shared';
import { columnTakesNullOrValueAbsentCheck } from './structure-checks';

/** A stored value as operation ids, labels and step descriptions write it. */
export function storedValueText(value: string | number): string {
  return JSON.stringify(value);
}

function idText(value: string | number): string {
  return String(value);
}

function valueAbsentCheck(tableName: string, columnName: string, value: string | number) {
  return step(
    `verify no row of "${tableName}" holds value ${storedValueText(value)} in column "${columnName}"`,
    `SELECT NOT EXISTS (SELECT 1 FROM ${quoteIdentifier(tableName)} WHERE ${quoteIdentifier(columnName)} = ?1) AS result`,
    [value],
  );
}

export function replaceStoredValue(
  tableName: string,
  columnName: string,
  from: string | number,
  to: string | number,
): Op {
  const column = quoteIdentifier(columnName);
  return {
    id: `replaceStoredValue.${tableName}.${columnName}.${idText(from)}`,
    label: `Replace value ${storedValueText(from)} with ${storedValueText(to)} in column "${columnName}" of "${tableName}"`,
    operationClass: 'widening',
    target: { id: 'sqlite', details: buildTargetDetails('column', columnName, tableName) },
    precheck: [],
    execute: [
      step(
        `replace value ${storedValueText(from)} with ${storedValueText(to)} in column "${columnName}"`,
        `UPDATE ${quoteIdentifier(tableName)} SET ${column} = ?2 WHERE ${column} = ?1`,
        [from, to],
      ),
    ],
    postcheck: [valueAbsentCheck(tableName, columnName, from)],
  };
}

export function removeStoredValue(
  tableName: string,
  columnName: string,
  value: string | number,
  mark: Pick<RowsHoldingValueMark, 'enumValue' | 'value' | 'codecRef'> | undefined,
): Op {
  const column = quoteIdentifier(columnName);
  const takesNull = `ensure column "${columnName}" of "${tableName}" takes NULL, or no row holds ${storedValueText(value)} in it`;
  return {
    id: `removeStoredValue.${tableName}.${columnName}.${idText(value)}`,
    label: `Remove value ${storedValueText(value)} from column "${columnName}" of "${tableName}"`,
    operationClass: 'destructive',
    target: { id: 'sqlite', details: buildTargetDetails('column', columnName, tableName) },
    precheck: [
      {
        ...columnTakesNullOrValueAbsentCheck(tableName, columnName, value, takesNull),
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
        `UPDATE ${quoteIdentifier(tableName)} SET ${column} = NULL WHERE ${column} = ?1`,
        [value],
      ),
    ],
    postcheck: [valueAbsentCheck(tableName, columnName, value)],
  };
}

export function deleteRows(tableName: string, columnName: string, value: string | number): Op {
  return {
    id: `deleteRows.${tableName}.${columnName}.${idText(value)}`,
    label: `Delete the rows of "${tableName}" that hold value ${storedValueText(value)} in column "${columnName}"`,
    operationClass: 'destructive',
    target: { id: 'sqlite', details: buildTargetDetails('column', columnName, tableName) },
    precheck: [],
    execute: [
      step(
        `delete the rows of "${tableName}" that hold value ${storedValueText(value)} in column "${columnName}"`,
        `DELETE FROM ${quoteIdentifier(tableName)} WHERE ${quoteIdentifier(columnName)} = ?1`,
        [value],
      ),
    ],
    postcheck: [valueAbsentCheck(tableName, columnName, value)],
  };
}

function pathParts(path: JsonPath): {
  readonly reach: readonly JsonPathStep[];
  readonly last: JsonPathStep;
} {
  const last = path.steps.at(-1);
  if (last === undefined) throw new InternalError('A stored value path ends at a selector');
  return { reach: path.steps.slice(0, -1), last };
}

/** Whether the JSON text `value` is the JSON form of `stored`, bound as parameter `param`. */
function isStoredValue(value: string, stored: string | number, param: string): string {
  const types = typeof stored === 'string' ? `= 'text'` : `IN ('integer', 'real')`;
  return `(json_type(${value}) ${types} AND (${value} ->> '$') = ${param})`;
}

function memberHolds(object: string, name: string, stored: string | number, param: string): string {
  return `(json_type(${object}) = 'object' AND ${isStoredValue(`(${object} -> ${memberPath(name)})`, stored, param)})`;
}

/** Whether the JSON text of `column` holds `stored`, bound as parameter `param`, at the end of `path`. */
function holdsAtPath(
  column: string,
  path: JsonPath,
  stored: string | number,
  param: string,
): string {
  const { reach, last } = pathParts(path);
  return jsonMatches(column, reach, (value, depth) =>
    last.kind === 'member'
      ? memberHolds(value, last.name, stored, param)
      : `(json_type(${value}) = 'array' AND ${someElement(value, depth, (element) => isStoredValue(element, stored, param))})`,
  );
}

/** The JSON text that sets the value at the end of `path` that equals `?1` to `replacement`, or removes it from a list when `replacement` is undefined. */
function rewriteAtPath(
  column: string,
  path: JsonPath,
  stored: string | number,
  replacement: string | undefined,
): string {
  const { reach, last } = pathParts(path);
  if (last.kind === 'member') {
    return jsonRewrite(
      column,
      reach,
      (object) =>
        `CASE WHEN ${memberHolds(object, last.name, stored, '?1')} THEN json_set(${object}, ${memberPath(last.name)}, ${replacement ?? "json('null')"}) ELSE ${object} END`,
    );
  }
  return jsonRewrite(column, reach, (list, depth) => {
    const rewritten =
      replacement === undefined
        ? rewrittenList(
            list,
            depth,
            (element) => element,
            (element) => `NOT ${isStoredValue(element, stored, '?1')}`,
          )
        : rewrittenList(
            list,
            depth,
            (element) =>
              `CASE WHEN ${isStoredValue(element, stored, '?1')} THEN json_quote(${replacement}) ELSE ${element} END`,
          );
    return `CASE WHEN json_type(${list}) = 'array' THEN ${rewritten} ELSE ${list} END`;
  });
}

function atPath(path: JsonPath, tableName: string, columnName: string): string {
  return `at path ${JSON.stringify(path.text)} in column "${columnName}" of "${tableName}"`;
}

function valueAbsentAtPathCheck(
  tableName: string,
  columnName: string,
  value: string | number,
  path: JsonPath,
) {
  return step(
    `verify no row holds value ${storedValueText(value)} ${atPath(path, tableName, columnName)}`,
    `SELECT NOT EXISTS (SELECT 1 FROM ${quoteIdentifier(tableName)} WHERE ${holdsAtPath(quoteIdentifier(columnName), path, value, '?1')}) AS result`,
    [value],
  );
}

/** The condition and parameters that find the rows of a column that hold a stored value, at `path` inside its JSON when it is given. */
export function holdingStoredValue(
  columnName: string,
  storedValue: string | number,
  path: string | undefined,
): { readonly condition: string; readonly params: readonly unknown[] } {
  const column = quoteIdentifier(columnName);
  if (path === undefined) return { condition: `${column} = ?1`, params: [storedValue] };
  const parsed = parseJsonPath(path);
  if (!parsed.ok) throw new InternalError(`A stored value path is a JSON path: ${parsed.failure}`);
  return { condition: holdsAtPath(column, parsed.value, storedValue, '?1'), params: [storedValue] };
}

export function replaceStoredValueAtPath(
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
    target: { id: 'sqlite', details: buildTargetDetails('column', columnName, tableName) },
    precheck: [],
    execute: [
      step(
        `replace value ${storedValueText(from)} with ${storedValueText(to)} ${place}`,
        `UPDATE ${quoteIdentifier(tableName)} SET ${column} = ${rewriteAtPath(column, path, from, '?2')} WHERE ${holdsAtPath(column, path, from, '?1')}`,
        [from, to],
      ),
    ],
    postcheck: [valueAbsentAtPathCheck(tableName, columnName, from, path)],
  };
}

/**
 * Removes a stored value inside JSON: takes it out of a list when `path` ends at `[*]`, else sets
 * the member to JSON `null`. When the member takes no null, the check fails while a row holds the
 * value.
 */
export function removeStoredValueAtPath(
  tableName: string,
  columnName: string,
  value: string | number,
  path: JsonPath,
  nullable: boolean,
  mark: Pick<RowsHoldingValueMark, 'enumValue' | 'value' | 'codecRef'> | undefined,
): Op {
  const column = quoteIdentifier(columnName);
  const place = atPath(path, tableName, columnName);
  const holds = holdsAtPath(column, path, value, '?1');
  const required = pathParts(path).last.kind === 'member' && !nullable;
  return {
    id: `removeStoredValue.${tableName}.${columnName}.${path.text}.${idText(value)}`,
    label: `Remove value ${storedValueText(value)} ${place}`,
    operationClass: 'destructive',
    target: { id: 'sqlite', details: buildTargetDetails('column', columnName, tableName) },
    precheck: required
      ? [
          {
            ...step(
              `ensure no row holds ${storedValueText(value)} ${place}, a member that takes no null`,
              `SELECT NOT EXISTS (SELECT 1 FROM ${quoteIdentifier(tableName)} WHERE ${holds}) AS result`,
              [value],
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
        `UPDATE ${quoteIdentifier(tableName)} SET ${column} = ${rewriteAtPath(column, path, value, undefined)} WHERE ${holds}`,
        [value],
      ),
    ],
    postcheck: [valueAbsentAtPathCheck(tableName, columnName, value, path)],
  };
}
