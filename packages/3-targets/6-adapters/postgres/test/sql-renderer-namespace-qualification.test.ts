import type { StorageHashBase } from '@internal/contract/types';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import {
  BinaryExpr,
  ColumnRef,
  DeleteAst,
  LiteralExpr,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { postgresCodecDescriptorRegistry } from '@internal/target-postgres/codecs';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import { PostgresSchema } from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { renderLoweredSql } from '../src/core/sql-renderer';
import type { PostgresContract } from '../src/core/types';

const postgresDataTypeLookup = createDataTypeLookup(postgresDataTypes);

const userTableInput = {
  columns: {
    id: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false },
    email: { codecId: 'pg/text@1', dataType: 'pg/text', nullable: false },
  },
  uniques: [],
  indexes: [],
  foreignKeys: [],
};

const publicContract = {
  target: 'postgres',
  targetFamily: 'sql',
  profileHash: 'test-profile',
  roots: {},
  capabilities: {},
  extensions: {},
  meta: {},
  storage: new SqlStorage({
    storageHash: 'test-core-public' as StorageHashBase<'test-core-public'>,
    namespaces: {
      public: new PostgresSchema({
        id: 'public',
        entries: { table: { user: new StorageTable(userTableInput) } },
      }),
    },
  }),
  domain: applicationDomainOf({ models: {} }),
} as PostgresContract;

describe('renderLoweredSql namespace qualification', () => {
  it('renders schema-qualified identifiers from the TableSource namespace coordinate', () => {
    const user = TableSource.named('user', undefined, 'public');

    const selectSql = renderLoweredSql(
      SelectAst.from(user).withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))]),
      publicContract,
      postgresCodecDescriptorRegistry,
      postgresDataTypeLookup,
    ).sql;
    expect(selectSql).toBe('SELECT "user"."id" AS "id" FROM "public"."user"');

    const deleteSql = renderLoweredSql(
      DeleteAst.from(user).withWhere(BinaryExpr.eq(ColumnRef.of('user', 'id'), LiteralExpr.of(1))),
      publicContract,
      postgresCodecDescriptorRegistry,
      postgresDataTypeLookup,
    ).sql;
    expect(deleteSql).toContain('DELETE FROM "public"."user"');
  });
});
