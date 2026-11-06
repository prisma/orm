import {
  freezeNode,
  hydrateNamespaceEntities,
  UNBOUND_NAMESPACE_ID,
} from '@internal/framework-components/ir';
import { tableEntityKind } from '@internal/sql-contract/entity-kinds';
import {
  SqlNamespaceBase,
  type SqlNamespaceEntries,
  type SqlNamespaceInput,
  type StorageTable,
} from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';
import { MYSQL_ENUM_CODEC_ID } from './codec-ids';
import { mysqlDatetime, mysqlTime, mysqlTimestamp } from './data-types';
import { mysqlError } from './errors';
import { quoteIdentifier } from './sql-utils';

const MYSQL_NAMESPACE_KIND = 'mysql-namespace' as const;

/**
 * The MySQL database a connection uses, as the contract's one namespace. Tables are addressed unqualified, so the contract runs against whichever database the connection names.
 */
export class MysqlDatabase extends SqlNamespaceBase {
  declare readonly kind: string;

  readonly id: string;
  readonly entries: SqlNamespaceEntries;

  constructor(input: SqlNamespaceInput) {
    super();
    this.id = input.id;
    const dispatched = hydrateNamespaceEntities(
      input.entries,
      new Map([['table', tableEntityKind]]),
      'carry',
    );
    this.entries = Object.freeze(
      blindCast<
        SqlNamespaceEntries,
        'the table-only descriptor map hydrates table entries to StorageTable and carries every other kind as it is, which SqlNamespaceEntries describes'
      >(dispatched),
    );
    Object.defineProperty(this, 'kind', {
      value: MYSQL_NAMESPACE_KIND,
      writable: false,
      enumerable: false,
      configurable: true,
    });
    freezeNode(this);
  }

  get table(): Readonly<Record<string, StorageTable>> {
    return this.entries.table ?? Object.freeze({});
  }

  qualifier(): string {
    return '';
  }

  qualifyTable(tableName: string): string {
    return quoteIdentifier(tableName);
  }
}

type Loose = Readonly<Record<string, unknown>>;

function isLoose(value: unknown): value is Loose {
  return typeof value === 'object' && value !== null;
}

function enumMembersOf(
  namespace: SqlNamespaceInput,
  tableName: string,
  columnName: string,
  column: Loose,
): readonly string[] {
  const subject = `Column "${tableName}"."${columnName}"`;
  const ref = column['valueSet'];
  const valueSetName =
    isLoose(ref) && ref['namespaceId'] === namespace.id ? ref['entityName'] : undefined;
  const valueSet =
    typeof valueSetName === 'string' ? namespace.entries['valueSet']?.[valueSetName] : undefined;
  const values = isLoose(valueSet) ? valueSet['values'] : undefined;
  if (!Array.isArray(values) || !values.every((value) => typeof value === 'string')) {
    throw mysqlError(
      'CONTRACT.TYPE_PARAMS_INVALID',
      `${subject} is a MySQL enum but has no enum whose text members it can list.`,
      {
        why: 'A native MySQL enum column is written with its members, which come from the enum that types the column.',
        fix: 'Type the column with a PSL enum or an enumType() whose members are text.',
        meta: { table: tableName, column: columnName },
      },
    );
  }
  return values;
}

function isEnumColumn(column: unknown): column is Loose {
  return isLoose(column) && column['codecId'] === MYSQL_ENUM_CODEC_ID;
}

function sameMembers(left: readonly unknown[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function enumColumnWithMembers(
  namespace: SqlNamespaceInput,
  tableName: string,
  columnName: string,
  column: Loose,
): Loose {
  const typeParams = isLoose(column['typeParams']) ? column['typeParams'] : {};
  const values = enumMembersOf(namespace, tableName, columnName, column);
  const listed = typeParams['values'];
  if (listed !== undefined && !(Array.isArray(listed) && sameMembers(listed, values))) {
    throw mysqlError(
      'CONTRACT.TYPE_PARAMS_INVALID',
      `Column "${tableName}"."${columnName}" lists enum members that differ from the members of the enum that types it.`,
      {
        why: 'A MySQL enum column takes its members from its enum, in the order the enum declares them, so the database and the contract enforce the same members.',
        fix: 'Remove the column’s own members, or make them equal the enum’s members in the same order.',
        meta: {
          table: tableName,
          column: columnName,
          columnValues: listed,
          valueSetValues: values,
        },
      },
    );
  }
  return { ...column, typeParams: { ...typeParams, values } };
}

/** The data types whose bare column type holds whole seconds. */
const PRECISION_DATA_TYPES: ReadonlySet<unknown> = new Set([
  mysqlDatetime.id,
  mysqlTimestamp.id,
  mysqlTime.id,
]);

function isUnwrittenPrecisionColumn(column: unknown): column is Loose {
  if (!isLoose(column) || !PRECISION_DATA_TYPES.has(column['dataType'])) return false;
  const typeParams = column['typeParams'];
  return !isLoose(typeParams) || typeParams['precision'] === undefined;
}

/** A `datetime`, `timestamp` or `time` column with no precision written records 0, the fraction digits MySQL gives the bare type, so its codec writes a value MySQL does not round; a codec reference with no precision is a raw parameter's, which is written whole. */
function withZeroPrecision(column: Loose): Loose {
  const typeParams = isLoose(column['typeParams']) ? column['typeParams'] : {};
  return { ...column, typeParams: { ...typeParams, precision: 0 } };
}

function withFilledTypeParams(
  namespace: SqlNamespaceInput,
  tableName: string,
  table: unknown,
): unknown {
  if (!isLoose(table)) return table;
  const columns = table['columns'];
  if (
    !isLoose(columns) ||
    !Object.values(columns).some(
      (column) => isEnumColumn(column) || isUnwrittenPrecisionColumn(column),
    )
  ) {
    return table;
  }
  const filled = Object.fromEntries(
    Object.entries(columns).map(([columnName, column]) => {
      if (isEnumColumn(column)) {
        return [columnName, enumColumnWithMembers(namespace, tableName, columnName, column)];
      }
      if (isUnwrittenPrecisionColumn(column)) return [columnName, withZeroPrecision(column)];
      return [columnName, column];
    }),
  );
  return { ...table, columns: filled };
}

/**
 * Writes the type parameters MySQL gives a column that the authored schema leaves out. Each MySQL enum column's members, from the value set the column names, go into its type parameters in the order the enum declares them, and a column whose own members differ from them is refused; the column's type is then `enum('A','B')`, so the database enforces the members and `db verify` sees a change to them as a change of the column's type. A `datetime`, `timestamp` or `time` column with no precision records precision 0.
 */
function fillTypeParams(input: SqlNamespaceInput): SqlNamespaceInput {
  const tables = input.entries['table'];
  if (tables === undefined) return input;
  return {
    ...input,
    entries: {
      ...input.entries,
      table: Object.fromEntries(
        Object.entries(tables).map(([tableName, table]) => [
          tableName,
          withFilledTypeParams(input, tableName, table),
        ]),
      ),
    },
  };
}

/**
 * The MySQL target's refusal of expression and partial indexes, which it neither writes nor introspects yet.
 */
function rejectSqlBodyIndexes(input: SqlNamespaceInput): void {
  for (const [tableName, table] of Object.entries(input.entries['table'] ?? {})) {
    const indexes = isLoose(table) ? table['indexes'] : undefined;
    for (const index of Array.isArray(indexes) ? indexes : []) {
      if (!isLoose(index)) continue;
      if (index['expression'] !== undefined || index['where'] !== undefined) {
        throw mysqlError(
          'CONTRACT.ARGUMENT_INVALID',
          `MySQL does not support expression or partial indexes yet: index "${String(index['name'] ?? '<unnamed>')}" on table "${tableName}" declares ${index['expression'] !== undefined ? 'an expression' : 'a where predicate'}. Use a fields-only index.`,
          { meta: { table: tableName } },
        );
      }
    }
  }
}

/**
 * The namespace factory the MySQL target hands `defineContract` and the PSL interpreter. MySQL has one namespace per connection, the framework's unbound slot.
 */
export function mysqlCreateNamespace(input: SqlNamespaceInput): MysqlDatabase {
  if (input.id !== UNBOUND_NAMESPACE_ID) {
    throw mysqlError(
      'CONTRACT.NAMESPACE_INVALID',
      `The MySQL target has one namespace, "${UNBOUND_NAMESPACE_ID}"; it received "${input.id}".`,
      { meta: { received: input.id } },
    );
  }
  rejectSqlBodyIndexes(input);
  return new MysqlDatabase(fillTypeParams(input));
}
