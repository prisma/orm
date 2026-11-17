import {
  asNamespaceId,
  type Contract,
  type ContractField,
  type ContractValueObject,
  type EntityCoordinate,
  valueObjectAt,
  valueObjectsWithCoordinates,
} from '@internal/contract/types';
import {
  type ResolvedMigrationStatement,
  type ResolvedValueObjectFieldRenameStatement,
  type ValueObjectFieldCoordinate,
  valueObjectFieldStatementText,
} from '@internal/framework-components/control';
import { reachesAny, referenceKey } from '@internal/sql-contract/check-expressions';
import type { SqlStorage } from '@internal/sql-contract/types';
import { invariant } from '@internal/utils/assertions';
import { notOk, ok, type Result } from '@internal/utils/result';
import { handWrittenMigrationAdvice } from './hand-written-migration';
import { type JsonPathStep, jsonPathText } from './json-path';
import type { SchemaTables } from './schema-tables';
import { isSqlModelStorage, tableControlPolicy } from './statement-planning';
import type { SqlPlannerConflict } from './types';

/**
 * One column's rewrite of one key of a value object field: the key at `path` is renamed to `to`,
 * or, when `to` is absent, removed. The column and the path to the objects are named as the
 * destination contract names them; the path ends at the key the origin contract names.
 */
export interface StoredKeyRewrite {
  /** The value object field whose key is rewritten, as the origin contract names it. */
  readonly valueObjectField: ValueObjectFieldCoordinate;
  readonly namespaceId: string;
  readonly table: string;
  readonly column: string;
  /** The RFC 9535 path from the column's value to the key. */
  readonly path: string;
  readonly to: string | undefined;
  /** The rename statement the rewrite carries out, if any. */
  readonly statement: ResolvedValueObjectFieldRenameStatement | undefined;
}

export type ValueObjectRef = EntityCoordinate<'storage', 'valueObject'>;

export interface StoredColumn {
  readonly namespaceId: string;
  readonly table: string;
  readonly column: string;
  readonly field: ContractField;
}

/** What a column holds of a value object: the paths to each of its objects, or why there is no list of them. */
export type Reach =
  | { readonly kind: 'paths'; readonly paths: readonly (readonly JsonPathStep[])[] }
  | { readonly kind: 'containsItself'; readonly valueObject: string }
  | { readonly kind: 'union' | 'dictionary' };

const WILDCARD: JsonPathStep = { kind: 'wildcard' };

function isMany(many: ContractField['many']): boolean {
  return many !== undefined && many !== false;
}

function requiredValueObject(
  storage: Contract<SqlStorage>['storage'],
  reference: ValueObjectRef,
): ContractValueObject {
  const valueObject = valueObjectAt(storage, reference);
  invariant(
    valueObject !== undefined,
    `value object "${reference.entityName}" in namespace "${reference.namespaceId}" is not in storage; the contract validators refuse a reference to a missing value object`,
  );
  return valueObject;
}

function nestedReferences(valueObject: ContractValueObject): readonly ValueObjectRef[] {
  return Object.values(valueObject.fields).flatMap(({ type }) =>
    type.kind === 'valueObject' ? [type] : [],
  );
}

function containsItself(storage: Contract<SqlStorage>['storage'], from: ValueObjectRef): boolean {
  const own = new Set([referenceKey(from)]);
  return nestedReferences(requiredValueObject(storage, from)).some((nested) =>
    reachesAny(storage, nested, own),
  );
}

/** The paths from `steps` to each object of `target` inside an object of `from`. */
function pathsWithin(
  storage: Contract<SqlStorage>['storage'],
  from: ValueObjectRef,
  steps: readonly JsonPathStep[],
  target: ValueObjectRef,
): Reach {
  const targets = new Set([referenceKey(target)]);
  if (containsItself(storage, from)) {
    return reachesAny(storage, from, targets)
      ? { kind: 'containsItself', valueObject: from.entityName }
      : { kind: 'paths', paths: [] };
  }
  const paths: (readonly JsonPathStep[])[] =
    referenceKey(from) === referenceKey(target) ? [steps] : [];
  for (const [name, field] of Object.entries(requiredValueObject(storage, from).fields)) {
    if (field.type.kind !== 'valueObject') continue;
    const nested = pathsWithin(
      storage,
      field.type,
      [...steps, { kind: 'member', name }, ...(isMany(field.many) ? [WILDCARD] : [])],
      target,
    );
    if (nested.kind !== 'paths') return nested;
    paths.push(...nested.paths);
  }
  return { kind: 'paths', paths };
}

function reachOf(
  storage: Contract<SqlStorage>['storage'],
  field: ContractField,
  target: ValueObjectRef,
): Reach {
  const targets = new Set([referenceKey(target)]);
  const { type } = field;
  if (type.kind === 'union') {
    return type.members.some(
      (member) => member.kind === 'valueObject' && reachesAny(storage, member, targets),
    )
      ? { kind: 'union' }
      : { kind: 'paths', paths: [] };
  }
  if (type.kind !== 'valueObject') return { kind: 'paths', paths: [] };
  if (field.dict === true) {
    return reachesAny(storage, type, targets)
      ? { kind: 'dictionary' }
      : { kind: 'paths', paths: [] };
  }
  return pathsWithin(storage, type, isMany(field.many) ? [WILDCARD] : [], target);
}

/** The columns of the destination, in managed tables the working schema has, that hold a model field. */
function storedColumns(
  contract: Contract<SqlStorage>,
  tables: SchemaTables,
): readonly StoredColumn[] {
  const found = new Map<string, StoredColumn>();
  for (const namespace of Object.values(contract.domain.namespaces)) {
    for (const model of Object.values(namespace.models)) {
      const { storage } = model;
      if (!isSqlModelStorage(storage)) continue;
      const location = { namespaceId: storage.namespaceId, table: storage.table };
      if (tableControlPolicy(contract, location) !== 'managed') continue;
      for (const [fieldName, field] of Object.entries(model.fields)) {
        const column = storage.fields[fieldName]?.column;
        if (column === undefined) continue;
        if (!tables.hasColumn(storage.namespaceId, storage.table, column)) continue;
        found.set(JSON.stringify([storage.namespaceId, storage.table, column]), {
          ...location,
          column,
          field,
        });
      }
    }
  }
  return [...found.values()];
}

/** A place a value object is stored: a column, and the steps from its value to each object. */
export interface ValueObjectPlace {
  readonly namespaceId: string;
  readonly table: string;
  readonly column: string;
  readonly steps: readonly JsonPathStep[];
}

/** A column that holds a value object where the plan cannot list its paths, and why. */
export interface UnlistedValueObjectPlace {
  readonly column: StoredColumn;
  readonly reach: Exclude<Reach, { readonly kind: 'paths' }>;
}

/**
 * Finds every place the destination stores a value object: each column of the working schema, in a
 * managed table, whose field holds it, at every path to its objects, nested or in lists. The paths
 * are written with the destination's names. A column whose paths cannot be listed, because it holds
 * the value object through a value object that contains itself, a union or a dictionary, is the
 * failure.
 */
export function valueObjectPlaces(
  contract: Contract<SqlStorage>,
  tables: SchemaTables,
): (target: ValueObjectRef) => Result<readonly ValueObjectPlace[], UnlistedValueObjectPlace> {
  const columns = storedColumns(contract, tables);
  return (target) => {
    const places: ValueObjectPlace[] = [];
    for (const column of columns) {
      const reach = reachOf(contract.storage, column.field, target);
      if (reach.kind !== 'paths') return notOk({ column, reach });
      for (const steps of reach.paths) {
        places.push({
          namespaceId: column.namespaceId,
          table: column.table,
          column: column.column,
          steps,
        });
      }
    }
    return ok(places);
  };
}

/** What changes for one field of a value object of the origin: its key `from` becomes `to`, or, with no `to`, is removed. */
interface FieldChange {
  readonly valueObjectField: ValueObjectFieldCoordinate;
  readonly target: ValueObjectRef;
  readonly from: string;
  readonly to: string | undefined;
  readonly statement: ResolvedValueObjectFieldRenameStatement | undefined;
}

function fieldChanges(
  fromContract: Contract<SqlStorage>,
  contract: Contract<SqlStorage>,
  statements: readonly ResolvedMigrationStatement[],
): readonly FieldChange[] {
  const renamedNamespaces = new Map<string, string>();
  const renames: ResolvedValueObjectFieldRenameStatement[] = [];
  for (const statement of statements) {
    if (statement.kind !== 'rename') continue;
    if (statement.entity === 'namespace') renamedNamespaces.set(statement.from, statement.to);
    if (statement.entity === 'valueObjectField') renames.push(statement);
  }
  const changes: FieldChange[] = [];
  for (const { coordinate, valueObject } of valueObjectsWithCoordinates(fromContract.storage)) {
    const target: ValueObjectRef = {
      ...coordinate,
      namespaceId: renamedNamespaces.get(coordinate.namespaceId) ?? coordinate.namespaceId,
    };
    const destination = valueObjectAt(contract.storage, target);
    if (destination === undefined) continue;
    for (const from of Object.keys(valueObject.fields)) {
      const valueObjectField = {
        namespaceId: asNamespaceId(coordinate.namespaceId),
        valueObject: coordinate.entityName,
        field: from,
      };
      const statement = renames.find(
        (rename) =>
          rename.from.namespaceId === valueObjectField.namespaceId &&
          rename.from.valueObject === valueObjectField.valueObject &&
          rename.from.field === from,
      );
      if (statement !== undefined) {
        changes.push({ valueObjectField, target, from, to: statement.to.field, statement });
      } else if (!Object.hasOwn(destination.fields, from)) {
        changes.push({ valueObjectField, target, from, to: undefined, statement: undefined });
      }
    }
  }
  return changes;
}

function columnText(column: StoredColumn): string {
  return `column "${column.column}" of "${column.table}"`;
}

function refused(
  change: FieldChange,
  fromContract: Contract<SqlStorage>,
  contract: Contract<SqlStorage>,
  column: StoredColumn,
  reason: string,
  why: string,
): SqlPlannerConflict {
  const from = valueObjectFieldStatementText(fromContract, change.valueObjectField);
  if (change.statement === undefined) {
    return {
      kind: 'unsupportedOperation',
      summary: `Cannot remove value object field "${from}": ${reason}`,
      why: `${why} ${handWrittenMigrationAdvice(`the JSON of ${columnText(column)}`)}`,
    };
  }
  return {
    kind: 'statementRefused',
    summary: `Cannot rename value object field "${from}" to "${valueObjectFieldStatementText(contract, change.statement.to)}": ${reason}`,
    why: `${why} ${handWrittenMigrationAdvice(`the JSON of ${columnText(column)}`)}`,
    refusedStatement: change.statement,
  };
}

function reachRefusal(
  reach: Exclude<Reach, { readonly kind: 'paths' }>,
  column: StoredColumn,
  change: FieldChange,
  contracts: {
    readonly fromContract: Contract<SqlStorage>;
    readonly contract: Contract<SqlStorage>;
  },
): SqlPlannerConflict {
  if (reach.kind === 'containsItself') {
    return refused(
      change,
      contracts.fromContract,
      contracts.contract,
      column,
      `${columnText(column)} holds it inside value object "${reach.valueObject}", which contains itself, so the JSON can hold it at any depth`,
      'The plan rewrites a key at every path from a column to its value object, and a value object that contains itself has no last path.',
    );
  }
  return refused(
    change,
    contracts.fromContract,
    contracts.contract,
    column,
    `${columnText(column)} holds a ${reach.kind} of value objects`,
    'The plan rewrites a key only in a column that holds a value object or a list of them.',
  );
}

/**
 * The key rewrites of value object fields a plan makes. A value object of the origin is compared,
 * field by field, with the value object of the same name in the destination: a rename statement
 * renames a field's key, and a field the destination lacks that no statement renames is removed,
 * which the plan asks about. Each rewrite acts on every column of the working schema whose field
 * holds the value object, at every path to its objects, nested or in lists. The paths are written
 * with the destination's names, so an outer rename runs before an inner one: the rewrites come out
 * ordered by the depth of their paths. A path through a value object that contains itself, or a
 * column that holds a union or a dictionary of value objects, is refused. With no origin contract,
 * nothing is known to have changed.
 */
export function planValueObjectFieldRewrites(input: {
  readonly statements: readonly ResolvedMigrationStatement[];
  readonly fromContract: Contract<SqlStorage> | null;
  readonly contract: Contract<SqlStorage>;
  readonly tables: SchemaTables;
}): Result<readonly StoredKeyRewrite[], SqlPlannerConflict> {
  const { fromContract, contract } = input;
  if (fromContract === null) return ok([]);
  const changes = fieldChanges(fromContract, contract, input.statements);
  if (changes.length === 0) return ok([]);
  const placesOf = valueObjectPlaces(contract, input.tables);
  const rewrites: { readonly rewrite: StoredKeyRewrite; readonly depth: number }[] = [];
  for (const change of changes) {
    const places = placesOf(change.target);
    if (!places.ok) {
      const { reach, column } = places.failure;
      return notOk(reachRefusal(reach, column, change, { fromContract, contract }));
    }
    for (const { steps, ...place } of places.value) {
      rewrites.push({
        depth: steps.length,
        rewrite: {
          valueObjectField: change.valueObjectField,
          ...place,
          path: jsonPathText([...steps, { kind: 'member', name: change.from }]),
          to: change.to,
          statement: change.statement,
        },
      });
    }
  }
  return ok(
    [...rewrites].sort((left, right) => left.depth - right.depth).map(({ rewrite }) => rewrite),
  );
}
