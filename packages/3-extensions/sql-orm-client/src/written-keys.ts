import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { SqlStatementStats } from '@internal/sql-relational-core/ast';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { isAutoIncrementColumn, resolveRowIdentityColumns } from './collection-contract';
import { ormError } from './orm-errors';

/** The key column the database numbers for the one row an insert adds, and how its reported number becomes the column's value. */
export interface GeneratedKey {
  readonly column: string;
  decode(insertId: string): Promise<unknown>;
}

export interface InsertedRows {
  readonly context: ExecutionContext<Contract<SqlStorage>>;
  readonly namespaceId: string;
  readonly tableName: string;
  readonly modelName: string;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly method: string;
  readonly columns: readonly string[];
}

export function generatedKeyColumn(options: InsertedRows): string | undefined {
  const { context, namespaceId, tableName, modelName, rows, method, columns } = options;
  const [column, ...others] = columns.filter((key) => !rows.every((row) => row[key] !== undefined));
  if (column === undefined) {
    return undefined;
  }
  const refused = (problem: string) =>
    ormError('ORM.CAPABILITY_MISSING', `${method} on model "${modelName}" ${problem}`, {
      meta: { capability: 'returning', action: method },
    });
  if (
    others.length > 0 ||
    !isAutoIncrementColumn(context.contract, namespaceId, tableName, column)
  ) {
    throw refused(
      `cannot find the row it inserts: key column "${[column, ...others].join('", "')}" gets no value from the client and is not an auto-increment column, and the contract does not report capability "returning" to read the value the database chose. Supply the key, or give the column a client-side default.`,
    );
  }
  if (rows.length > 1) {
    throw refused(
      `cannot return the rows it inserts: their key column "${column}" is generated, and without capability "returning" the database reports a generated value only for a one-row insert. Use createAndCount(), or create() for each row.`,
    );
  }
  return column;
}

export function generatedKey(options: InsertedRows): GeneratedKey | undefined {
  const column = generatedKeyColumn(options);
  if (column === undefined) {
    return undefined;
  }
  const { context, namespaceId, tableName } = options;
  const codec = context.contractCodecs.forColumn(namespaceId, tableName, column);
  return {
    column,
    decode: async (insertId) =>
      codec === undefined
        ? insertId
        : codec.fromWire(insertId, { column: { table: tableName, name: column } }),
  };
}

export function rowIdentity(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  modelName: string,
  method: string,
): readonly string[] {
  const identity = resolveRowIdentityColumns(contract, namespaceId, tableName);
  if (identity.length > 0) return identity;
  throw ormError(
    'ORM.ROW_IDENTITY_MISSING',
    `${method} on model "${modelName}" requires the table to have a primary key or unique constraint`,
    { meta: { model: modelName, table: tableName } },
  );
}

/** The call a write belongs to, named in the error when the ORM cannot find the row it wrote. */
export interface WrittenRowOwner {
  readonly operation: string;
  readonly modelName: string;
}

/** The `insertId` a one-row insert reported, or the error that it reported none, which a middleware answering the statement may cause. */
export function reportedInsertId(
  stats: SqlStatementStats,
  generated: GeneratedKey,
  owner: WrittenRowOwner,
): string {
  if (stats.affectedRows === 1 && stats.insertId !== undefined) {
    return stats.insertId;
  }
  throw ormError(
    'ORM.MUTATION_ROW_MISSING',
    `${owner.operation}() for model "${owner.modelName}" cannot find the row it inserted: the insert's result carried no insert id for key column "${generated.column}". A middleware may have answered the statement in place of the database without one.`,
    {
      meta: {
        operation: owner.operation,
        model: owner.modelName,
        phase: 'insert-id',
        column: generated.column,
        affectedRows: stats.affectedRows,
      },
    },
  );
}
