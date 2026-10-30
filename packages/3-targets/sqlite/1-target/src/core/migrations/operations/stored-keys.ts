import { type JsonKeyPath, jsonPathText } from '@internal/family-sql/control';
import { quoteIdentifier } from '../../sql-utils';
import { buildTargetDetails } from '../planner-target-details';
import { hasMember, jsonMatches, jsonRewrite, memberPath } from './json-rewrite';
import { type Op, step } from './shared';

function at(keyPath: JsonKeyPath): string {
  return `at path ${JSON.stringify(jsonPathText(keyPath.objects))}`;
}

/** Where in a column a key operation acts, as its label and step descriptions write it. */
export function keyPlace(keyPath: JsonKeyPath, tableName: string, columnName: string): string {
  return `${at(keyPath)} in column "${columnName}" of "${tableName}"`;
}

function noRowWhere(tableName: string, condition: string): string {
  return `SELECT NOT EXISTS (SELECT 1 FROM ${quoteIdentifier(tableName)} WHERE ${condition}) AS result`;
}

function objectsMatch(
  columnName: string,
  keyPath: JsonKeyPath,
  test: (object: string) => string,
): string {
  return jsonMatches(quoteIdentifier(columnName), keyPath.objects, test);
}

export function renameStoredKey(
  tableName: string,
  columnName: string,
  keyPath: JsonKeyPath,
  to: string,
): Op {
  const column = quoteIdentifier(columnName);
  const from = memberPath(keyPath.key);
  const renamed = jsonRewrite(
    column,
    keyPath.objects,
    (object) =>
      `CASE WHEN ${hasMember(object, keyPath.key)} THEN json_set(json_remove(${object}, ${from}), ${memberPath(to)}, json(${object} -> ${from})) ELSE ${object} END`,
  );
  const holdsKey = objectsMatch(columnName, keyPath, (object) => hasMember(object, keyPath.key));
  const place = keyPlace(keyPath, tableName, columnName);
  return {
    id: `renameStoredKey.${tableName}.${columnName}.${keyPath.path.text}`,
    label: `Rename key "${keyPath.key}" to "${to}" ${place}`,
    operationClass: 'widening',
    target: { id: 'sqlite', details: buildTargetDetails('column', columnName, tableName) },
    precheck: [
      step(
        `ensure no object ${place} has both key "${keyPath.key}" and key "${to}"`,
        noRowWhere(
          tableName,
          objectsMatch(
            columnName,
            keyPath,
            (object) => `(${hasMember(object, keyPath.key)} AND ${hasMember(object, to)})`,
          ),
        ),
      ),
    ],
    execute: [
      step(
        `rename key "${keyPath.key}" to "${to}" ${place}`,
        `UPDATE ${quoteIdentifier(tableName)} SET ${column} = ${renamed} WHERE ${holdsKey}`,
      ),
    ],
    postcheck: [
      step(`verify no object ${place} has key "${keyPath.key}"`, noRowWhere(tableName, holdsKey)),
    ],
  };
}

export function removeStoredKey(tableName: string, columnName: string, keyPath: JsonKeyPath): Op {
  const column = quoteIdentifier(columnName);
  const removed = jsonRewrite(
    column,
    keyPath.objects,
    (object) =>
      `CASE WHEN ${hasMember(object, keyPath.key)} THEN json_remove(${object}, ${memberPath(keyPath.key)}) ELSE ${object} END`,
  );
  const holdsKey = objectsMatch(columnName, keyPath, (object) => hasMember(object, keyPath.key));
  const place = keyPlace(keyPath, tableName, columnName);
  return {
    id: `removeStoredKey.${tableName}.${columnName}.${keyPath.path.text}`,
    label: `Remove key "${keyPath.key}" ${place}`,
    operationClass: 'destructive',
    target: { id: 'sqlite', details: buildTargetDetails('column', columnName, tableName) },
    precheck: [],
    execute: [
      step(
        `remove key "${keyPath.key}" ${place}`,
        `UPDATE ${quoteIdentifier(tableName)} SET ${column} = ${removed} WHERE ${holdsKey}`,
      ),
    ],
    postcheck: [
      step(`verify no object ${place} has key "${keyPath.key}"`, noRowWhere(tableName, holdsKey)),
    ],
  };
}

/** `value` is the JSON text of the value the key takes, passed as a parameter. */
export function fillStoredKey(
  tableName: string,
  columnName: string,
  keyPath: JsonKeyPath,
  value: string,
): Op {
  const column = quoteIdentifier(columnName);
  const member = memberPath(keyPath.key);
  const lacks = (object: string) =>
    `(json_type(${object}) = 'object' AND json_type(${object}, ${member}) IS NULL)`;
  const filled = jsonRewrite(
    column,
    keyPath.objects,
    (object) =>
      `CASE WHEN ${lacks(object)} THEN json_insert(${object}, ${member}, json(?1)) ELSE ${object} END`,
  );
  const lacksKey = objectsMatch(columnName, keyPath, lacks);
  const place = keyPlace(keyPath, tableName, columnName);
  return {
    id: `fillStoredKey.${tableName}.${columnName}.${keyPath.path.text}`,
    label: `Fill key "${keyPath.key}" ${place}`,
    operationClass: 'widening',
    target: { id: 'sqlite', details: buildTargetDetails('column', columnName, tableName) },
    precheck: [],
    execute: [
      step(
        `fill key "${keyPath.key}" ${place} in every object that lacks it`,
        `UPDATE ${quoteIdentifier(tableName)} SET ${column} = ${filled} WHERE ${lacksKey}`,
        [value],
      ),
    ],
    postcheck: [
      step(
        `verify every object ${place} has key "${keyPath.key}"`,
        noRowWhere(tableName, lacksKey),
      ),
    ],
  };
}
