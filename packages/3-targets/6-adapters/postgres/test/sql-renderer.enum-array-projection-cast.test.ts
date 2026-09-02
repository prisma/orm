import {
  ColumnRef,
  InsertAst,
  ParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { postgresCodecDescriptorRegistry } from '@internal/target-postgres/codecs';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { TestSqlContractSerializer as SqlContractSerializer } from '../../../../2-sql/9-family/test/test-sql-contract-serializer';
import { renderLoweredSql } from '../src/core/sql-renderer';
import type { PostgresContract } from '../src/core/types';

const baseContract = new SqlContractSerializer().deserializeContract({
  target: 'postgres',
  targetFamily: 'sql',
  profileHash: 'sha256:enum-array-projection-cast-test',
  roots: {},
  capabilities: { returning: { enabled: true } },
  extensions: {},
  meta: {},
  storage: {
    storageHash: 'sha256:enum-array-projection-cast',
    namespaces: {
      __unbound__: {
        id: '__unbound__',
        entries: {
          table: {
            probe: {
              columns: {
                id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
                mood: {
                  codecId: 'pg/enum@1',
                  nativeType: 'mood',
                  nullable: false,
                  typeParams: { typeName: 'mood' },
                },
                moods: {
                  codecId: 'pg/enum@1',
                  nativeType: 'mood',
                  nullable: false,
                  many: true,
                  typeParams: { typeName: 'mood' },
                },
                labels: { codecId: 'pg/text@1', nativeType: 'text', nullable: false, many: true },
              },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      },
    },
  },
  domain: applicationDomainOf({ models: {} }),
}) as PostgresContract;

function selectProjection(
  alias: string,
  column: string,
  codec?: Parameters<typeof ProjectionItem.of>[2],
) {
  return SelectAst.from(TableSource.named('probe')).withProjection([
    ProjectionItem.of(alias, ColumnRef.of('probe', column), codec),
  ]);
}

describe('renderLoweredSql — native-enum array projection cast', () => {
  it('casts a many + pg/enum@1 SELECT projection to ::text[]', () => {
    const ast = selectProjection('moods', 'moods', {
      codecId: 'pg/enum@1',
      many: true,
      typeParams: { typeName: 'mood' },
    });

    const lowered = renderLoweredSql(ast, baseContract, postgresCodecDescriptorRegistry);

    expect(lowered.sql).toBe('SELECT "probe"."moods"::text[] AS "moods" FROM "probe"');
  });

  it('casts a many + pg/enum@1 RETURNING projection to ::text[] with an explicit alias', () => {
    const ast = InsertAst.into(TableSource.named('probe'))
      .withRows([{ id: ParamRef.of('1', { name: 'id', codec: { codecId: 'pg/text@1' } }) }])
      .withReturning([
        ProjectionItem.of('moods', ColumnRef.of('probe', 'moods'), {
          codecId: 'pg/enum@1',
          many: true,
          typeParams: { typeName: 'mood' },
        }),
      ]);

    const lowered = renderLoweredSql(ast, baseContract, postgresCodecDescriptorRegistry);

    expect(lowered.sql).toBe(
      'INSERT INTO "probe" ("id") VALUES ($1) RETURNING "probe"."moods"::text[] AS "moods"',
    );
  });

  it('leaves a scalar (non-many) pg/enum@1 projection uncast', () => {
    const ast = selectProjection('mood', 'mood', {
      codecId: 'pg/enum@1',
      typeParams: { typeName: 'mood' },
    });

    const lowered = renderLoweredSql(ast, baseContract, postgresCodecDescriptorRegistry);

    expect(lowered.sql).toBe('SELECT "probe"."mood" AS "mood" FROM "probe"');
  });

  it('leaves an ordinary many text[] projection uncast', () => {
    const ast = selectProjection('labels', 'labels', { codecId: 'pg/text@1', many: true });

    const lowered = renderLoweredSql(ast, baseContract, postgresCodecDescriptorRegistry);

    expect(lowered.sql).toBe('SELECT "probe"."labels" AS "labels" FROM "probe"');
  });

  it('leaves an ordinary scalar text projection uncast', () => {
    const ast = selectProjection('id', 'id', { codecId: 'pg/text@1' });

    const lowered = renderLoweredSql(ast, baseContract, postgresCodecDescriptorRegistry);

    expect(lowered.sql).toBe('SELECT "probe"."id" AS "id" FROM "probe"');
  });

  it('leaves a projection with no codec uncast', () => {
    const ast = selectProjection('moods', 'moods');

    const lowered = renderLoweredSql(ast, baseContract, postgresCodecDescriptorRegistry);

    expect(lowered.sql).toBe('SELECT "probe"."moods" AS "moods" FROM "probe"');
  });
});
