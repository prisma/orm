import type { SqlCheckConstraintIR } from '@internal/sql-schema-ir/types';
import type { PostgresDatabaseSchemaNode } from '../schema-ir/postgres-database-schema-node';
import type { PostgresTableSchemaNode } from '../schema-ir/postgres-table-schema-node';
import { quoteIdentifier } from '../sql-utils';
import {
  AddCheckConstraintCall,
  AlterColumnTypeCall,
  DropCheckConstraintCall,
  type PostgresOpFactoryCall,
} from './op-factory-call';

function tableIn(
  tree: PostgresDatabaseSchemaNode,
  ddlSchemaName: string,
  tableName: string,
): PostgresTableSchemaNode | undefined {
  return Object.values(tree.namespaces).find((node) => node.schemaName === ddlSchemaName)?.tables[
    tableName
  ];
}

function escapedForPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whether a check's predicate names the column, quoted or bare. The predicate is opaque SQL, so this
 * reads its text, and may name a check that does not depend on the column: dropping and adding
 * such a check again changes nothing.
 */
function mentionsColumn(check: SqlCheckConstraintIR, column: string): boolean {
  const quoted = escapedForPattern(quoteIdentifier(column));
  const bare = escapedForPattern(column);
  return new RegExp(`${quoted}|(?<![\\w$"])${bare}(?![\\w$"])`, 'i').test(check.expression);
}

/**
 * Puts a drop of each check that names a column a type change alters before the first such type
 * change, and the check back after the last. Postgres stores a check bound to the column's old type,
 * such as `array_position(tags, NULL::integer)`, and re-checks it while it alters the type, so a
 * check left in place can fail the alter; a check that names two retyped columns can only be added
 * back once both have their new types. Only checks the plan keeps unchanged are moved: one the plan
 * drops or adds is already planned around the alter. The check is added back as the destination
 * contract writes it.
 */
export function withChecksAroundTypeChanges(input: {
  readonly calls: readonly PostgresOpFactoryCall[];
  readonly expected: PostgresDatabaseSchemaNode;
  readonly actual: PostgresDatabaseSchemaNode;
  /** The DDL schema a call's schema name stands for. */
  readonly ddlSchemaOf: (schemaName: string) => string;
}): readonly PostgresOpFactoryCall[] {
  const moved = new Map<
    string,
    {
      readonly schemaName: string;
      readonly tableName: string;
      readonly check: SqlCheckConstraintIR;
      readonly first: number;
      last: number;
    }
  >();
  input.calls.forEach((call, index) => {
    if (!(call instanceof AlterColumnTypeCall)) return;
    const ddlSchemaName = input.ddlSchemaOf(call.schemaName);
    const kept = tableIn(input.actual, ddlSchemaName, call.tableName)?.checks ?? [];
    for (const check of tableIn(input.expected, ddlSchemaName, call.tableName)?.checks ?? []) {
      if (!mentionsColumn(check, call.columnName)) continue;
      if (!kept.some(({ name }) => name === check.name)) continue;
      const key = JSON.stringify([ddlSchemaName, call.tableName, check.name]);
      const entry = moved.get(key);
      if (entry === undefined) {
        moved.set(key, {
          schemaName: call.schemaName,
          tableName: call.tableName,
          check,
          first: index,
          last: index,
        });
      } else {
        entry.last = index;
      }
    }
  });
  const entries = [...moved.values()];
  return input.calls.flatMap((call, index): readonly PostgresOpFactoryCall[] => [
    ...entries
      .filter(({ first }) => first === index)
      .map(
        ({ schemaName, tableName, check }) =>
          new DropCheckConstraintCall(schemaName, tableName, check.name),
      ),
    call,
    ...entries
      .filter(({ last }) => last === index)
      .map(
        ({ schemaName, tableName, check }) =>
          new AddCheckConstraintCall(schemaName, tableName, check.name, check.expression),
      ),
  ]);
}
