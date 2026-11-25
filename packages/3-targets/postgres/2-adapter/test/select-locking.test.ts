import {
  ColumnRef,
  EqColJoinOn,
  JoinAst,
  LockingClause,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { postgresCodecDescriptorRegistry } from '@internal/target-postgres/codecs';
import { createPostgresBuiltinDataTypeLookup } from '@internal/target-postgres/data-types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { TestSqlContractSerializer as SqlContractSerializer } from '../../../../2-sql-family/9-family/test/test-sql-contract-serializer';
import { createPostgresAdapter } from '../src/core/adapter';
import { postgresAdapterDescriptorMeta } from '../src/core/descriptor-meta';
import { renderLoweredSql } from '../src/core/sql-renderer';
import type { PostgresContract } from '../src/core/types';

const lockFlags = {
  sql: {
    forUpdate: true,
    forShare: true,
    lockOf: true,
    lockNowait: true,
    lockSkipLocked: true,
  },
  postgres: {
    forNoKeyUpdate: true,
    forKeyShare: true,
  },
};

const contract = new SqlContractSerializer().deserializeContract({
  target: 'postgres',
  targetFamily: 'sql',
  profileHash: 'test-profile',
  roots: {},
  capabilities: lockFlags,
  extensions: {},
  meta: {},
  storage: {
    storageHash: 'test-core',
    namespaces: {
      __unbound__: {
        id: '__unbound__',
        entries: {
          table: {
            job: {
              columns: {
                id: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false },
              },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
            worker: {
              columns: {
                jobId: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false },
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

const base = SelectAst.from(TableSource.named('job', 'j')).withProjection([
  ProjectionItem.of('id', ColumnRef.of('j', 'id')),
]);
const baseSql = 'SELECT "j"."id" AS "id" FROM "job" AS "j"';

describe('Postgres adapter row locking', () => {
  const adapter = createPostgresAdapter();

  function lower(locking: ReadonlyArray<LockingClause>, ast: SelectAst = base): string {
    return adapter.lower(ast.withLocking(locking), { contract }).sql;
  }

  it('declares no locking flags, which are facts about the database the target declares by version', () => {
    expect([adapter.profile.capabilities, postgresAdapterDescriptorMeta.capabilities]).toEqual([
      {},
      {},
    ]);
  });

  it("refuses a clause the contract's capabilities do not list", () => {
    const withoutLocking = { ...contract, capabilities: {} };
    expect(() =>
      adapter.lower(base.withLocking([LockingClause.of('forUpdate')]), {
        contract: withoutLocking,
      }),
    ).toThrow(
      'The contract does not list capability sql.forUpdate, which this locking clause needs. Write the contract for a database that provides it.',
    );
  });

  it.each([
    ['forUpdate', 'FOR UPDATE'],
    ['forNoKeyUpdate', 'FOR NO KEY UPDATE'],
    ['forShare', 'FOR SHARE'],
    ['forKeyShare', 'FOR KEY SHARE'],
  ] as const)('renders %s', (strength, keyword) => {
    expect(lower([LockingClause.of(strength)])).toBe(`${baseSql} ${keyword}`);
  });

  it('renders nowait and skipLocked', () => {
    expect(lower([LockingClause.of('forUpdate', { waitPolicy: 'nowait' })])).toBe(
      `${baseSql} FOR UPDATE NOWAIT`,
    );
    expect(lower([LockingClause.of('forUpdate', { waitPolicy: 'skipLocked' })])).toBe(
      `${baseSql} FOR UPDATE SKIP LOCKED`,
    );
  });

  it('renders of as unqualified quoted names', () => {
    const joined = base.withJoins([
      JoinAst.inner(
        TableSource.named('worker', 'w'),
        EqColJoinOn.of(ColumnRef.of('j', 'id'), ColumnRef.of('w', 'jobId')),
      ),
    ]);

    expect(lower([LockingClause.of('forUpdate', { of: ['j'], waitPolicy: 'nowait' })])).toBe(
      `${baseSql} FOR UPDATE OF "j" NOWAIT`,
    );
    expect(lower([LockingClause.of('forShare', { of: ['j', 'w'] })], joined)).toBe(
      'SELECT "j"."id" AS "id" FROM "job" AS "j" INNER JOIN "worker" AS "w" ON "j"."id" = "w"."jobId" FOR SHARE OF "j", "w"',
    );
  });

  it('renders two clauses in order', () => {
    expect(
      lower([
        LockingClause.of('forUpdate', { of: ['j'] }),
        LockingClause.of('forKeyShare', { of: ['w'], waitPolicy: 'skipLocked' }),
      ]),
    ).toBe(`${baseSql} FOR UPDATE OF "j" FOR KEY SHARE OF "w" SKIP LOCKED`);
  });

  it('renders the clause after LIMIT and OFFSET', () => {
    expect(lower([LockingClause.of('forUpdate')], base.withLimit(1).withOffset(2))).toBe(
      `${baseSql} LIMIT 1 OFFSET 2 FOR UPDATE`,
    );
  });

  describe('refuses a clause the capabilities do not list', () => {
    const withoutFlag = (group: 'sql' | 'postgres', flag: string) => ({
      ...lockFlags,
      [group]: { ...lockFlags[group], [flag]: false },
    });

    it.each([
      { group: 'sql', flag: 'forUpdate', clause: LockingClause.of('forUpdate') },
      { group: 'sql', flag: 'forShare', clause: LockingClause.of('forShare') },
      { group: 'postgres', flag: 'forNoKeyUpdate', clause: LockingClause.of('forNoKeyUpdate') },
      { group: 'postgres', flag: 'forKeyShare', clause: LockingClause.of('forKeyShare') },
      { group: 'sql', flag: 'lockOf', clause: LockingClause.of('forUpdate', { of: ['j'] }) },
      {
        group: 'sql',
        flag: 'lockNowait',
        clause: LockingClause.of('forUpdate', { waitPolicy: 'nowait' }),
      },
      {
        group: 'sql',
        flag: 'lockSkipLocked',
        clause: LockingClause.of('forUpdate', { waitPolicy: 'skipLocked' }),
      },
    ] as const)('without $group.$flag', ({ group, flag, clause }) => {
      const capability = `${group}.${flag}`;
      expect(() =>
        renderLoweredSql(
          base.withLocking([clause]),
          { ...contract, capabilities: withoutFlag(group, flag) },
          postgresCodecDescriptorRegistry,
          createPostgresBuiltinDataTypeLookup(),
        ),
      ).toThrow(
        expect.objectContaining({
          name: 'StructuredError',
          code: 'RUNTIME.AST_UNSUPPORTED',
          message: `The contract does not list capability ${capability}, which this locking clause needs. Write the contract for a database that provides it.`,
          meta: { target: 'postgres', feature: 'locking-clause', capability },
        }),
      );
    });
  });
});
