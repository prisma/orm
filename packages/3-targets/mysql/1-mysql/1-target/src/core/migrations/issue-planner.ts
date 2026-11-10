import type {
  MigrationOperationPolicy,
  SqlPlannerConflict,
  SqlPlannerConflictLocation,
} from '@internal/family-sql/control';
import type { SchemaDiffIssue } from '@internal/framework-components/control';
import { issueOutcome, orderIssuesByDependencies } from '@internal/framework-components/control';
import type { DdlColumn } from '@internal/sql-relational-core/ast';
import {
  RelationalSchemaNodeKind,
  type SqlColumnIR,
  type SqlForeignKeyIR,
  type SqlIndexIR,
  type SqlSchemaIR,
  type SqlSchemaIRNode,
  type SqlTableIR,
  type SqlUniqueIR,
  sqlColumnTypesEqual,
} from '@internal/sql-schema-ir/types';
import { blindCast } from '@internal/utils/casts';
import { notOk, ok, type Result } from '@internal/utils/result';
import { CONTROL_TABLE_NAMES } from '../control-tables';
import {
  columnDefaultOf,
  ddlColumnFromNode,
  tableConstraintsFromNode,
  uniqueName,
} from './column-ddl';
import {
  AddColumnCall,
  AddForeignKeyCall,
  AddUniqueCall,
  CreateIndexCall,
  CreateTableCall,
  DropColumnCall,
  DropForeignKeyCall,
  DropIndexCall,
  DropTableCall,
  DropUniqueCall,
  foreignKeySpecOf,
  type MysqlOpFactoryCall,
} from './op-factory-call';

/**
 * Drops each issue under a missing or extra node: the call for a table or column accounts for everything beneath it.
 */
export function coalesceSubtreeIssues(
  issues: readonly SchemaDiffIssue[],
): readonly SchemaDiffIssue[] {
  const collapsing = issues
    .filter((issue) => {
      const outcome = issueOutcome(issue);
      return outcome === 'not-found' || outcome === 'not-expected';
    })
    .map((issue) => issue.path);
  return issues.filter(
    (issue) =>
      !collapsing.some(
        (ancestor) =>
          issue.path.length > ancestor.length &&
          ancestor.every((segment, index) => issue.path[index] === segment),
      ),
  );
}

export function issueNode(issue: SchemaDiffIssue): SqlSchemaIRNode | undefined {
  const node = issue.expected ?? issue.actual;
  return node === undefined
    ? undefined
    : blindCast<
        SqlSchemaIRNode,
        'every node in a SQL schema diff tree is a SqlSchemaIRNode; nodeKind is its required discriminant'
      >(node);
}

function expectedNode<T>(issue: SchemaDiffIssue): T {
  return blindCast<T, 'a not-found or not-equal issue carries the expected node of its kind'>(
    issue.expected,
  );
}

function actualNode<T>(issue: SchemaDiffIssue): T {
  return blindCast<T, 'a not-expected or not-equal issue carries the actual node of its kind'>(
    issue.actual,
  );
}

function location(table: string | undefined, column?: string): SqlPlannerConflictLocation {
  return {
    entityKind: 'table',
    ...(table === undefined ? {} : { entityName: table }),
    ...(column === undefined ? {} : { column }),
  };
}

function placeOf(issue: SchemaDiffIssue, at: SqlPlannerConflictLocation | undefined): string {
  if (at?.entityName === undefined) return issue.path.slice(1).join('.');
  return at.column === undefined ? at.entityName : `${at.entityName}.${at.column}`;
}

/** The conflict for a change the MySQL planner does not plan yet. */
export function notYetSupported(
  kind: SqlPlannerConflict['kind'],
  change: string,
  issue: SchemaDiffIssue,
  conflictLocation?: SqlPlannerConflictLocation,
): SqlPlannerConflict {
  return {
    kind,
    summary: `${change} is not yet supported on MySQL (${placeOf(issue, conflictLocation)})`,
    why: 'The MySQL planner creates and drops tables, columns, indexes, unique constraints and foreign keys; it does not change a column, a default, a primary key or a CHECK constraint yet. Use `migration new` to write this change by hand.',
    ...(conflictLocation === undefined ? {} : { location: conflictLocation }),
  };
}

function createTableCalls(table: SqlTableIR): MysqlOpFactoryCall[] {
  return [
    new CreateTableCall(
      table.name,
      Object.values(table.columns).map(ddlColumnFromNode),
      tableConstraintsFromNode(table),
    ),
    ...table.indexes.flatMap((index) =>
      index.columns === undefined
        ? []
        : [new CreateIndexCall(table.name, index.name, index.columns, index.unique)],
    ),
    ...table.foreignKeys.map(
      (fk) => new AddForeignKeyCall(table.name, foreignKeySpecOf(fk, table.name)),
    ),
  ];
}

type Mapped = Result<readonly MysqlOpFactoryCall[], SqlPlannerConflict>;

function mapTableIssue(issue: SchemaDiffIssue): Mapped {
  switch (issueOutcome(issue)) {
    case 'not-found': {
      const table = expectedNode<SqlTableIR>(issue);
      const expression = table.indexes.find((index) => index.columns === undefined);
      return expression === undefined
        ? ok(createTableCalls(table))
        : notOk(
            notYetSupported(
              'indexIncompatible',
              'An expression index',
              issue,
              location(table.name),
            ),
          );
    }
    case 'not-expected': {
      const table = actualNode<SqlTableIR>(issue);
      return ok(CONTROL_TABLE_NAMES.has(table.name) ? [] : [new DropTableCall(table.name)]);
    }
    default:
      return notOk(notYetSupported('unsupportedOperation', 'Changing a table', issue));
  }
}

function mapColumnIssue(issue: SchemaDiffIssue, table: string): Mapped {
  switch (issueOutcome(issue)) {
    case 'not-found': {
      const column = expectedNode<SqlColumnIR>(issue);
      const columnDefault = columnDefaultOf(column);
      const hasValue =
        column.nullable ||
        (columnDefault !== undefined &&
          !(columnDefault.kind === 'function' && columnDefault.expression === 'autoincrement()'));
      return hasValue
        ? ok([new AddColumnCall(table, ddlColumnFromNode(column))])
        : notOk(
            notYetSupported(
              'nullabilityConflict',
              'Adding a required column without a default',
              issue,
              location(table, column.name),
            ),
          );
    }
    case 'not-expected':
      return ok([new DropColumnCall(table, actualNode<SqlColumnIR>(issue).name)]);
    default: {
      const expected = expectedNode<SqlColumnIR>(issue);
      const typesEqual = sqlColumnTypesEqual(expected, actualNode<SqlColumnIR>(issue));
      return notOk(
        notYetSupported(
          typesEqual ? 'nullabilityConflict' : 'typeMismatch',
          typesEqual ? "Changing a column's nullability" : "Changing a column's type",
          issue,
          location(table, expected.name),
        ),
      );
    }
  }
}

function mapIndexIssue(issue: SchemaDiffIssue, table: string): Mapped {
  switch (issueOutcome(issue)) {
    case 'not-found': {
      const index = expectedNode<SqlIndexIR>(issue);
      return index.columns === undefined
        ? notOk(notYetSupported('indexIncompatible', 'An expression index', issue, location(table)))
        : ok([new CreateIndexCall(table, index.name, index.columns, index.unique)]);
    }
    case 'not-expected':
      return ok([new DropIndexCall(table, actualNode<SqlIndexIR>(issue).name)]);
    default:
      return notOk(
        notYetSupported('indexIncompatible', 'Changing an index', issue, location(table)),
      );
  }
}

function mapUniqueIssue(issue: SchemaDiffIssue, table: string): Mapped {
  switch (issueOutcome(issue)) {
    case 'not-found': {
      const unique = expectedNode<SqlUniqueIR>(issue);
      return ok([new AddUniqueCall(table, uniqueName(table, unique), unique.columns)]);
    }
    case 'not-expected':
      return ok([new DropUniqueCall(table, uniqueName(table, actualNode<SqlUniqueIR>(issue)))]);
    default:
      return notOk(
        notYetSupported(
          'indexIncompatible',
          'Changing a unique constraint',
          issue,
          location(table),
        ),
      );
  }
}

function mapForeignKeyIssue(issue: SchemaDiffIssue, table: string): Mapped {
  switch (issueOutcome(issue)) {
    case 'not-found':
      return ok([
        new AddForeignKeyCall(table, foreignKeySpecOf(expectedNode<SqlForeignKeyIR>(issue), table)),
      ]);
    case 'not-expected':
      return ok([
        new DropForeignKeyCall(
          table,
          foreignKeySpecOf(actualNode<SqlForeignKeyIR>(issue), table).name,
        ),
      ]);
    default:
      return notOk(
        notYetSupported('foreignKeyConflict', 'Changing a foreign key', issue, location(table)),
      );
  }
}

export function mapIssueToCalls(issue: SchemaDiffIssue): Mapped {
  const node = issueNode(issue);
  const table = issue.path[1];
  if (node === undefined) {
    return notOk(notYetSupported('unsupportedOperation', 'A change with no node', issue));
  }
  if (node.nodeKind === RelationalSchemaNodeKind.table) return mapTableIssue(issue);
  if (table === undefined) {
    return notOk(notYetSupported('unsupportedOperation', `A ${node.nodeKind} change`, issue));
  }
  switch (node.nodeKind) {
    case RelationalSchemaNodeKind.column:
      return mapColumnIssue(issue, table);
    case RelationalSchemaNodeKind.index:
      return mapIndexIssue(issue, table);
    case RelationalSchemaNodeKind.unique:
      return mapUniqueIssue(issue, table);
    case RelationalSchemaNodeKind.foreignKey:
      return mapForeignKeyIssue(issue, table);
    case RelationalSchemaNodeKind.columnDefault:
      return notOk(
        notYetSupported(
          'unsupportedOperation',
          "Changing a column's default",
          issue,
          location(table),
        ),
      );
    case RelationalSchemaNodeKind.primaryKey:
      return notOk(
        notYetSupported('indexIncompatible', 'Changing a primary key', issue, location(table)),
      );
    case RelationalSchemaNodeKind.check:
      return notOk(
        notYetSupported('unsupportedOperation', 'A CHECK constraint', issue, location(table)),
      );
    default:
      return notOk(notYetSupported('unsupportedOperation', `A ${node.nodeKind} change`, issue));
  }
}

/**
 * The order calls run in: foreign keys are dropped before the tables, columns and indexes they use, and added after every table, column and index they need exists. The index InnoDB made for a dropped key is dropped right after the key, before any key is added, so a new key on the same columns makes its own.
 */
const CALL_ORDER: readonly MysqlOpFactoryCall['factoryName'][] = [
  'dropForeignKey',
  'createTable',
  'addColumn',
  'addUnique',
  'createIndex',
  'addForeignKey',
  'dropUnique',
  'dropIndex',
  'dropColumn',
  'dropTable',
  'rawSql',
];

function locationOfCall(call: MysqlOpFactoryCall): SqlPlannerConflictLocation | undefined {
  return 'tableName' in call
    ? {
        entityKind: 'table',
        entityName: call.tableName,
        ...('columnName' in call ? { column: call.columnName } : {}),
        ...('indexName' in call ? { index: call.indexName } : {}),
      }
    : undefined;
}

export function conflictForDisallowedCall(
  call: MysqlOpFactoryCall,
  allowed: readonly string[],
): SqlPlannerConflict {
  const callLocation = locationOfCall(call);
  return {
    kind:
      call instanceof CreateIndexCall || call instanceof DropIndexCall
        ? 'indexIncompatible'
        : 'missingButNonAdditive',
    summary: `Operation "${call.label}" requires class "${call.operationClass}", but policy allows only: ${allowed.join(', ')}`,
    why: 'Use `migration new` to author a custom migration for this change.',
    refusedOperationClass: call.operationClass,
    ...(callLocation === undefined ? {} : { location: callLocation }),
  };
}

const MAX_IDENTIFIER_CHARACTERS = 64;

/** The names a call gives new objects, each with where the conflict that refuses it points. */
function namesGiven(
  call: MysqlOpFactoryCall,
): readonly { readonly name: string; readonly at: SqlPlannerConflictLocation }[] {
  if (call instanceof CreateTableCall) {
    return [
      { name: call.tableName, at: location(call.tableName) },
      ...call.columns.map((column) => ({
        name: column.name,
        at: location(call.tableName, column.name),
      })),
      ...call.constraints.flatMap((constraint) =>
        constraint.name === undefined
          ? []
          : [
              {
                name: constraint.name,
                at: { ...location(call.tableName), constraint: constraint.name },
              },
            ],
      ),
    ];
  }
  if (call instanceof AddColumnCall) {
    return [{ name: call.column.name, at: location(call.tableName, call.column.name) }];
  }
  if (call instanceof CreateIndexCall) {
    return [{ name: call.indexName, at: { ...location(call.tableName), index: call.indexName } }];
  }
  if (call instanceof AddUniqueCall) {
    return [
      {
        name: call.constraintName,
        at: { ...location(call.tableName), constraint: call.constraintName },
      },
    ];
  }
  if (call instanceof AddForeignKeyCall) {
    return [
      {
        name: call.foreignKey.name,
        at: { ...location(call.tableName), constraint: call.foreignKey.name },
      },
    ];
  }
  return [];
}

function placeText(at: SqlPlannerConflictLocation): string {
  return at.column === undefined ? `${at.entityName}` : `${at.entityName}.${at.column}`;
}

/** MySQL refuses a name longer than 64 characters only when the statement runs, after the statements before it committed, so the planner refuses it first. */
function longNameConflicts(call: MysqlOpFactoryCall): readonly SqlPlannerConflict[] {
  return namesGiven(call)
    .filter(({ name }) => Array.from(name).length > MAX_IDENTIFIER_CHARACTERS)
    .map(({ name, at }) => ({
      kind: 'unsupportedOperation',
      summary: `The name ${name} is longer than the ${MAX_IDENTIFIER_CHARACTERS} characters MySQL allows (${placeText(at)})`,
      why: `MySQL refuses a table, column, index or constraint name longer than ${MAX_IDENTIFIER_CHARACTERS} characters. Give it a shorter name in the contract.`,
      location: at,
    }));
}

function isAutoincrement(column: DdlColumn): boolean {
  return (
    column.default?.kind === 'function' && column.default.expression.text === 'autoincrement()'
  );
}

/** MySQL refuses a table whose `AUTO_INCREMENT` column does not lead a key, so the planner refuses it first. */
function autoincrementKeyConflicts(call: MysqlOpFactoryCall): readonly SqlPlannerConflict[] {
  if (!(call instanceof CreateTableCall)) return [];
  const keyLeaders = new Set(
    call.constraints.flatMap((constraint) =>
      constraint.kind === 'primary-key' || constraint.kind === 'unique'
        ? constraint.columns.slice(0, 1)
        : [],
    ),
  );
  return call.columns
    .filter(
      (column) => isAutoincrement(column) && !column.primaryKey && !keyLeaders.has(column.name),
    )
    .map((column) => ({
      kind: 'unsupportedOperation',
      summary: `An autoincrement column that is not the first column of the primary key or a unique constraint is not supported on MySQL (${call.tableName}.${column.name})`,
      why: 'MySQL requires an AUTO_INCREMENT column to be the first column of a key, and refuses the table otherwise.',
      location: location(call.tableName, column.name),
    }));
}

type ColumnList = readonly string[];

/** Whether an index on `indexColumns` can serve a foreign key on `keyColumns`: InnoDB needs the key's columns first, in order. */
function servesKey(indexColumns: ColumnList, keyColumns: ColumnList): boolean {
  return (
    keyColumns.length <= indexColumns.length &&
    keyColumns.every((column, position) => indexColumns[position] === column)
  );
}

function indexColumnLists(table: SqlTableIR, leaving: string | undefined): readonly ColumnList[] {
  return [
    ...(table.primaryKey === undefined ? [] : [table.primaryKey.columns]),
    ...table.uniques.flatMap((unique) =>
      uniqueName(table.name, unique) === leaving ? [] : [unique.columns],
    ),
    ...table.indexes.flatMap((index) =>
      index.name === leaving || index.columns === undefined ? [] : [index.columns],
    ),
  ];
}

function isKeyServed(table: SqlTableIR, keyColumns: ColumnList, leaving?: string): boolean {
  return indexColumnLists(table, leaving).some((columns) => servesKey(columns, keyColumns));
}

interface DroppedIndex {
  readonly call: MysqlOpFactoryCall & { readonly tableName: string };
  readonly indexName: string;
  readonly columns: ColumnList;
}

/**
 * When a foreign key is dropped and no other index served it, InnoDB made an index of its own, with the key's name, and keeps it after the key is gone. Introspection leaves that index out while the key exists, so it is dropped with the key unless the destination keeps an index of that name.
 */
function innoDbIndexDrops(
  calls: readonly MysqlOpFactoryCall[],
  expected: SqlSchemaIR,
  actual: SqlSchemaIR,
): readonly DroppedIndex[] {
  return calls.flatMap((call) => {
    if (!(call instanceof DropForeignKeyCall)) return [];
    const before = actual.tables[call.tableName];
    const after = expected.tables[call.tableName];
    const key = before?.foreignKeys.find(
      (fk) => foreignKeySpecOf(fk, call.tableName).name === call.constraintName,
    );
    if (before === undefined || after === undefined || key === undefined) return [];
    if (isKeyServed(before, key.columns)) return [];
    if (after.indexes.some((index) => index.name === call.constraintName)) return [];
    return [
      {
        call: new DropIndexCall(call.tableName, call.constraintName),
        indexName: call.constraintName,
        columns: key.columns,
      },
    ];
  });
}

function droppedIndexes(
  calls: readonly MysqlOpFactoryCall[],
  actual: SqlSchemaIR,
): readonly DroppedIndex[] {
  return calls.flatMap((call): readonly DroppedIndex[] => {
    const table = 'tableName' in call ? actual.tables[call.tableName] : undefined;
    if (table === undefined) return [];
    if (call instanceof DropIndexCall) {
      const index = table.indexes.find(({ name }) => name === call.indexName);
      return index?.columns === undefined
        ? []
        : [{ call, indexName: call.indexName, columns: index.columns }];
    }
    if (call instanceof DropUniqueCall) {
      const unique = table.uniques.find(
        (candidate) => uniqueName(table.name, candidate) === call.constraintName,
      );
      return unique === undefined
        ? []
        : [{ call, indexName: call.constraintName, columns: unique.columns }];
    }
    return [];
  });
}

/**
 * A dropped index that one of `protectedKeys` uses, when no index the destination keeps can take over: MySQL refuses that drop.
 */
function conflictForIndexAKeyUses(
  dropped: DroppedIndex,
  expected: SqlSchemaIR,
  protectedKeys: (tableName: string, fk: SqlForeignKeyIR) => boolean,
): SqlPlannerConflict | undefined {
  const tableName = dropped.call.tableName;
  const table = expected.tables[tableName];
  const key = table?.foreignKeys.find(
    (fk) =>
      protectedKeys(tableName, fk) &&
      servesKey(dropped.columns, fk.columns) &&
      !isKeyServed(table, fk.columns, dropped.indexName),
  );
  if (key === undefined) return undefined;
  return {
    kind: 'indexIncompatible',
    summary: `Dropping index ${dropped.indexName}, which foreign key ${foreignKeySpecOf(key, tableName).name} uses, is not yet supported on MySQL (${tableName})`,
    why: "MySQL refuses to drop an index a foreign key uses. Keep an index whose first columns are the foreign key's columns, or use `migration new` to drop the foreign key, drop the index and add the foreign key again.",
    location: { entityKind: 'table', entityName: tableName, index: dropped.indexName },
  };
}

/** The calls that turn `actual` into `expected` for `issues`, in the order they run, or the conflicts that stop the plan. */
export function planIssues(input: {
  readonly issues: readonly SchemaDiffIssue[];
  readonly expected: SqlSchemaIR;
  readonly actual: SqlSchemaIR;
  readonly policy: MigrationOperationPolicy;
}): Result<readonly MysqlOpFactoryCall[], readonly SqlPlannerConflict[]> {
  const calls: MysqlOpFactoryCall[] = [];
  const conflicts: SqlPlannerConflict[] = [];
  const allowed = input.policy.allowedOperationClasses;
  for (const issue of orderIssuesByDependencies(input.issues)) {
    const mapped = mapIssueToCalls(issue);
    if (!mapped.ok) {
      conflicts.push(mapped.failure);
      continue;
    }
    for (const call of mapped.value) {
      conflicts.push(...longNameConflicts(call), ...autoincrementKeyConflicts(call));
      if (allowed.includes(call.operationClass)) calls.push(call);
      else conflicts.push(conflictForDisallowedCall(call, allowed));
    }
  }
  const droppedKeys = new Set(
    calls.flatMap((call) =>
      call instanceof DropForeignKeyCall ? [`${call.tableName}.${call.constraintName}`] : [],
    ),
  );
  const isKeptKey = (tableName: string, fk: SqlForeignKeyIR) =>
    !droppedKeys.has(`${tableName}.${foreignKeySpecOf(fk, tableName).name}`);
  for (const dropped of droppedIndexes(calls, input.actual)) {
    const conflict = conflictForIndexAKeyUses(dropped, input.expected, () => true);
    if (conflict !== undefined) conflicts.push(conflict);
  }
  const innoDbIndexes = innoDbIndexDrops(calls, input.expected, input.actual);
  for (const dropped of innoDbIndexes) {
    const conflict = conflictForIndexAKeyUses(dropped, input.expected, isKeptKey);
    if (conflict !== undefined) conflicts.push(conflict);
    if (!allowed.includes(dropped.call.operationClass)) {
      conflicts.push(conflictForDisallowedCall(dropped.call, allowed));
    }
  }
  if (conflicts.length > 0) return notOk(conflicts);
  const inOrder = (factoryName: MysqlOpFactoryCall['factoryName']) =>
    calls.filter((call) => call.factoryName === factoryName);
  return ok([
    ...inOrder('dropForeignKey'),
    ...innoDbIndexes.map(({ call }) => call),
    ...CALL_ORDER.filter((factoryName) => factoryName !== 'dropForeignKey').flatMap(inOrder),
  ]);
}
