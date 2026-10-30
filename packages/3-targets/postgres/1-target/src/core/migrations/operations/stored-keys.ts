import { type JsonKeyPath, jsonPathText } from '@internal/family-sql/control';
import { quoteIdentifier } from '../../sql-utils';
import { qualifyTableName } from '../planner-sql-checks';
import { hasMemberFilter, jsonPathMatches, jsonRewrite, keyLiteral } from './json-rewrite';
import { type Op, step, targetDetails } from './shared';

function at(keyPath: JsonKeyPath): string {
  return `at path ${JSON.stringify(jsonPathText(keyPath.objects))}`;
}

/** Where in a column a key operation acts, as its label and step descriptions write it. */
export function keyPlace(keyPath: JsonKeyPath, tableName: string, columnName: string): string {
  return `${at(keyPath)} in column "${columnName}" of "${tableName}"`;
}

function noRowWhere(schemaName: string, tableName: string, condition: string): string {
  return `SELECT NOT EXISTS (SELECT 1 FROM ${qualifyTableName(schemaName, tableName)} WHERE ${condition}) AS result`;
}

function where(columnName: string, keyPath: JsonKeyPath, filter: string): string {
  return jsonPathMatches(quoteIdentifier(columnName), keyPath.objects, 'object', filter);
}

export function renameStoredKey(
  schemaName: string,
  tableName: string,
  columnName: string,
  keyPath: JsonKeyPath,
  to: string,
): Op {
  const column = quoteIdentifier(columnName);
  const from = keyLiteral(keyPath.key);
  const renamed = jsonRewrite(
    column,
    keyPath.objects,
    (object) =>
      `CASE WHEN jsonb_typeof(${object}) = 'object' AND ${object} ? ${from} THEN (${object} - ${from}) || jsonb_build_object(${keyLiteral(to)}, ${object} -> ${from}) ELSE ${object} END`,
  );
  const holdsKey = where(columnName, keyPath, hasMemberFilter(keyPath.key));
  const place = keyPlace(keyPath, tableName, columnName);
  return {
    id: `renameStoredKey.${tableName}.${columnName}.${keyPath.path.text}`,
    label: `Rename key "${keyPath.key}" to "${to}" ${place}`,
    operationClass: 'widening',
    target: targetDetails('column', columnName, schemaName, tableName),
    precheck: [
      step(
        `ensure no object ${place} has both key "${keyPath.key}" and key "${to}"`,
        noRowWhere(
          schemaName,
          tableName,
          where(columnName, keyPath, `${hasMemberFilter(keyPath.key)} && ${hasMemberFilter(to)}`),
        ),
      ),
    ],
    execute: [
      step(
        `rename key "${keyPath.key}" to "${to}" ${place}`,
        `UPDATE ${qualifyTableName(schemaName, tableName)} SET ${column} = ${renamed} WHERE ${holdsKey}`,
      ),
    ],
    postcheck: [
      step(
        `verify no object ${place} has key "${keyPath.key}"`,
        noRowWhere(schemaName, tableName, holdsKey),
      ),
    ],
  };
}

export function removeStoredKey(
  schemaName: string,
  tableName: string,
  columnName: string,
  keyPath: JsonKeyPath,
): Op {
  const column = quoteIdentifier(columnName);
  const key = keyLiteral(keyPath.key);
  const removed = jsonRewrite(
    column,
    keyPath.objects,
    (object) =>
      `CASE WHEN jsonb_typeof(${object}) = 'object' THEN ${object} - ${key} ELSE ${object} END`,
  );
  const holdsKey = where(columnName, keyPath, hasMemberFilter(keyPath.key));
  const place = keyPlace(keyPath, tableName, columnName);
  return {
    id: `removeStoredKey.${tableName}.${columnName}.${keyPath.path.text}`,
    label: `Remove key "${keyPath.key}" ${place}`,
    operationClass: 'destructive',
    target: targetDetails('column', columnName, schemaName, tableName),
    precheck: [],
    execute: [
      step(
        `remove key "${keyPath.key}" ${place}`,
        `UPDATE ${qualifyTableName(schemaName, tableName)} SET ${column} = ${removed} WHERE ${holdsKey}`,
      ),
    ],
    postcheck: [
      step(
        `verify no object ${place} has key "${keyPath.key}"`,
        noRowWhere(schemaName, tableName, holdsKey),
      ),
    ],
  };
}

/** `value` is the JSON text of the value the key takes, passed as a parameter. */
export function fillStoredKey(
  schemaName: string,
  tableName: string,
  columnName: string,
  keyPath: JsonKeyPath,
  value: string,
): Op {
  const column = quoteIdentifier(columnName);
  const key = keyLiteral(keyPath.key);
  const filled = jsonRewrite(
    column,
    keyPath.objects,
    (object) =>
      `CASE WHEN jsonb_typeof(${object}) = 'object' AND NOT ${object} ? ${key} THEN ${object} || jsonb_build_object(${key}, $1::jsonb) ELSE ${object} END`,
  );
  const lacksKey = where(columnName, keyPath, `!(${hasMemberFilter(keyPath.key)})`);
  const place = keyPlace(keyPath, tableName, columnName);
  return {
    id: `fillStoredKey.${tableName}.${columnName}.${keyPath.path.text}`,
    label: `Fill key "${keyPath.key}" ${place}`,
    operationClass: 'widening',
    target: targetDetails('column', columnName, schemaName, tableName),
    precheck: [],
    execute: [
      step(
        `fill key "${keyPath.key}" ${place} in every object that lacks it`,
        `UPDATE ${qualifyTableName(schemaName, tableName)} SET ${column} = ${filled} WHERE ${lacksKey}`,
        [value],
      ),
    ],
    postcheck: [
      step(
        `verify every object ${place} has key "${keyPath.key}"`,
        noRowWhere(schemaName, tableName, lacksKey),
      ),
    ],
  };
}
