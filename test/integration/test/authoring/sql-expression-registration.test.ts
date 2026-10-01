import postgresAdapter from '@internal/adapter-postgres/control';
import sqliteAdapter from '@internal/adapter-sqlite/control';
import arktypeJsonControl from '@internal/extension-arktype-json/control';
import paradedbControl from '@internal/extension-paradedb/control';
import pgvectorControl from '@internal/extension-pgvector/control';
import postgisControl from '@internal/extension-postgis/control';
import supabasePack from '@internal/extension-supabase/pack';
import sql from '@internal/family-sql/control';
import type { DataType } from '@internal/framework-components/codec';
import { type ControlStack, createControlStack } from '@internal/framework-components/control';
import {
  SQL_EXPRESSION_DATA_TYPE_ID,
  sqlExpressionAuthoringEntry,
  sqlExpressionDataType,
} from '@internal/sql-contract/sql-expression';
import postgres from '@internal/target-postgres/control';
import sqlite from '@internal/target-sqlite/control';
import { describe, expect, it } from 'vitest';

const castsFromSqlExpression = (type: DataType): boolean =>
  Object.hasOwn(type.casts, SQL_EXPRESSION_DATA_TYPE_ID) ||
  (type.listCast?.of.includes(SQL_EXPRESSION_DATA_TYPE_ID) ?? false);

describe.each([
  [
    'Postgres, with every extension pack the repository ships',
    () =>
      createControlStack({
        family: sql,
        target: postgres,
        adapter: postgresAdapter,
        extensions: [
          arktypeJsonControl,
          paradedbControl,
          pgvectorControl,
          postgisControl,
          supabasePack,
        ],
      }),
    ['arktype-json', 'paradedb', 'pgvector', 'postgis', 'supabase'],
  ],
  ['SQLite', () => createControlStack({ family: sql, target: sqlite, adapter: sqliteAdapter }), []],
])('the assembled %s stack', (_name, assemble, extensionIds) => {
  const stack: ControlStack<'sql', string> = assemble();

  it('composes the extension packs', () => {
    expect(stack.extensions.map((extension) => extension.id).sort()).toEqual(extensionIds);
  });

  it('registers the family sql/expression data type and its authoring entry', () => {
    expect(stack.dataTypeLookup.get(SQL_EXPRESSION_DATA_TYPE_ID)).toBe(sqlExpressionDataType);
    expect(stack.authoringContributions.dataTypes[SQL_EXPRESSION_DATA_TYPE_ID]).toBe(
      sqlExpressionAuthoringEntry,
    );
  });

  it('lists the sql/expression entry first, so users see the sql tag first', () => {
    expect(Object.keys(stack.authoringContributions.dataTypes)[0]).toBe(
      SQL_EXPRESSION_DATA_TYPE_ID,
    );
  });

  it('registers no data type that casts from sql/expression', () => {
    const registered = stack.declaredDataTypes.map(({ type }) => type);
    expect(registered).toContain(sqlExpressionDataType);
    expect(registered.filter(castsFromSqlExpression).map((type) => type.id)).toEqual([]);
    expect(() => sql.create(stack)).not.toThrow();
  });
});
