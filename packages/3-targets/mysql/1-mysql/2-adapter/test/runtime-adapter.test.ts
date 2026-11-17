import type { SqlExecuteRequest, SqlQueryable } from '@internal/sql-relational-core/ast';
import {
  ColumnRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { createSqlExecutionStack } from '@internal/sql-runtime';
import { MysqlCreateTable } from '@internal/target-mysql/ddl';
import mysqlRuntimeTarget from '@internal/target-mysql/runtime';
import { describe, expect, it } from 'vitest';
import { mysqlAdapterCapabilities } from '../src/core/capabilities';
import { mysqlRawCodecInferer } from '../src/core/raw-codec-inferer';
import mysqlRuntimeAdapter from '../src/core/runtime/runtime-adapter';

const markerRow = {
  space: 'app',
  core_hash: 'sha256:core',
  profile_hash: 'sha256:profile',
  contract_json: null,
  canonical_version: '1',
  updated_at: '2024-01-02 03:04:05.678',
  app_tag: null,
  meta: {},
  invariants: '[]',
};

function queryable(tables: readonly string[], markers: readonly Record<string, unknown>[]) {
  const requests: SqlExecuteRequest[] = [];
  const answer = (request: SqlExecuteRequest): readonly Record<string, unknown>[] =>
    request.sql.includes('information_schema.TABLES')
      ? tables.filter((name) => request.params?.[0] === name).map((name) => ({ TABLE_NAME: name }))
      : markers;
  const target: SqlQueryable & { readonly requests: SqlExecuteRequest[] } = {
    requests,
    async *query<Row>(request: SqlExecuteRequest): AsyncIterable<Row> {
      requests.push(request);
      for (const row of answer(request)) yield row as Row;
    },
    async execute() {
      return { affectedRows: 0 };
    },
  };
  return target;
}

function createAdapter() {
  return mysqlRuntimeAdapter.create(
    createSqlExecutionStack({
      target: mysqlRuntimeTarget,
      adapter: mysqlRuntimeAdapter,
      extensions: [],
    }),
  );
}

describe('the MySQL runtime adapter', () => {
  it('reports the adapter capabilities and lowers a select with the MySQL renderer', () => {
    const adapter = createAdapter();
    const ast = SelectAst.from(TableSource.named('user')).withProjection([
      ProjectionItem.of('id', ColumnRef.of('user', 'id')),
    ]);
    expect({
      profile: { id: adapter.profile.id, capabilities: adapter.profile.capabilities },
      lowered: adapter.lower(ast, { contract: undefined as never }),
    }).toEqual({
      profile: { id: 'mysql/default@1', capabilities: mysqlAdapterCapabilities },
      lowered: {
        sql: 'SELECT `user`.`id` AS `id` FROM `user`',
        params: [],
      },
    });
  });

  it('refuses to lower DDL, which belongs to the control adapter', () => {
    const ddl = new MysqlCreateTable({ table: 't', columns: [] });
    expect(() => createAdapter().lower(ddl as never, { contract: undefined as never })).toThrow(
      expect.objectContaining({ code: 'RUNTIME.DDL_UNSUPPORTED' }),
    );
  });

  it('reads the marker from the control tables 2b writes', async () => {
    const adapter = createAdapter();
    const present = queryable(['_prisma_marker'], [markerRow]);
    expect({
      noTable: await adapter.profile.readMarker(queryable([], [])),
      absent: await adapter.profile.readMarker(queryable(['_prisma_marker'], [])),
      present: await adapter.profile.readMarker(present),
      read: present.requests.at(-1),
    }).toEqual({
      noTable: { kind: 'no-table' },
      absent: { kind: 'absent' },
      present: {
        kind: 'present',
        record: {
          storageHash: 'sha256:core',
          profileHash: 'sha256:profile',
          contractJson: null,
          canonicalVersion: 1,
          updatedAt: new Date('2024-01-02T03:04:05.678Z'),
          appTag: null,
          meta: {},
          invariants: [],
        },
      },
      read: {
        sql: 'SELECT space, core_hash, profile_hash, contract_json, canonical_version, updated_at, app_tag, meta, invariants FROM `_prisma_marker` WHERE space = ?',
        params: ['app'],
      },
    });
  });
});

describe('the MySQL raw codec inferer', () => {
  it.each([
    [1, 'mysql/int@1'],
    [-(2 ** 31), 'mysql/int@1'],
    [10n, 'mysql/bigint@1'],
    ['x', 'mysql/text@1'],
  ] as const)('infers %s as %s', (value, codecId) => {
    expect(mysqlRawCodecInferer.inferCodec(value)).toBe(codecId);
  });

  it.each([[1.5], [2 ** 31], [true], [new Uint8Array([1])]] as const)(
    'refuses %s, which no MySQL codec here takes',
    (value) => {
      expect(() => mysqlRawCodecInferer.inferCodec(value)).toThrow(
        expect.objectContaining({ code: 'RUNTIME.RAW_SQL_UNSUPPORTED_INTERPOLATION' }),
      );
    },
  );
});
