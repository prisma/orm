import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { SqlStatementStats } from '@internal/sql-relational-core/ast';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import type { StructuredError } from '@internal/utils/structured-error';
import { isAutoIncrementColumn, resolveRowIdentityColumns } from './collection-contract';
import { ormError } from './orm-errors';

/** The key column the database numbers for the one row an insert adds, and how its reported number becomes the column's value. */
export interface GeneratedKey {
  readonly column: string;
  decode(insertId: string): Promise<unknown>;
}

export interface WrittenKeys {
  readonly keys: readonly Record<string, unknown>[];
  readonly generated: GeneratedKey | undefined;
}

/**
 * The key of each row an insert writes, for reading the rows back without `RETURNING`: the values the client supplies, and at most one auto-increment column, whose value the database reports only for a one-row insert. Refuses, before anything runs, an insert whose rows cannot be found this way.
 */
export function writtenKeys(options: {
  readonly context: ExecutionContext<Contract<SqlStorage>>;
  readonly namespaceId: string;
  readonly tableName: string;
  readonly modelName: string;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly method: string;
}): WrittenKeys {
  const { context, namespaceId, tableName, modelName, rows, method } = options;
  const identity = readBackIdentity(context.contract, namespaceId, tableName, modelName, method);
  const supplied = identity.filter((column) => rows.every((row) => row[column] !== undefined));
  const keys = rows.map((row) =>
    Object.fromEntries(supplied.map((column) => [column, row[column]])),
  );
  const [column, ...others] = identity.filter((key) => !supplied.includes(key));
  if (column === undefined) {
    return { keys, generated: undefined };
  }
  const refused = (problem: string) =>
    ormError('ORM.CAPABILITY_MISSING', `${method} on model "${modelName}" ${problem}`, {
      meta: { capability: 'returning', action: method, model: modelName },
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
  const codec = context.contractCodecs.forColumn(namespaceId, tableName, column);
  return {
    keys,
    generated: {
      column,
      decode: async (insertId) =>
        codec === undefined
          ? insertId
          : codec.fromWire(insertId, { column: { table: tableName, name: column } }),
    },
  };
}

/** The columns a write without `RETURNING` reads its rows back by: the table's row identity, which it must have. */
export function readBackIdentity(
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
    `${method} on model "${modelName}" reads the rows it wrote back by key, since the contract does not report capability "returning", so table "${tableName}" needs a primary key or unique constraint`,
    { meta: { model: modelName, table: tableName } },
  );
}

/** The `insertId` a one-row insert reported, or the error that it reported none, which a middleware answering the statement may cause. */
export function reportedInsertId(
  stats: SqlStatementStats,
  generated: GeneratedKey,
  modelName: string,
): string {
  if (stats.affectedRows === 1 && stats.insertId !== undefined) {
    return stats.insertId;
  }
  throw insertIdMissing(generated, modelName, stats.affectedRows);
}

function insertIdMissing(
  generated: GeneratedKey,
  modelName: string,
  affectedRows: number,
): StructuredError {
  return ormError(
    'ORM.INSERT_ID_MISSING',
    `The insert for model "${modelName}" reported no generated value for key column "${generated.column}", so the ORM cannot read the row back. A middleware that answers the statement in place of the database must report the row's insertId.`,
    { meta: { model: modelName, column: generated.column, affectedRows } },
  );
}
