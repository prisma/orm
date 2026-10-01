import { ColumnRef } from '@internal/sql-relational-core/ast';
import { buildOperation, createRawSql, param } from '@internal/sql-relational-core/expression';
import { sqliteCodecDescriptorRegistry } from '@internal/target-sqlite/codecs';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { TestSqlContractSerializer as SqlContractSerializer } from '../../../../2-sql/9-family/test/test-sql-contract-serializer';
import { renderLoweredSql, sqliteRawCodecInferer } from '../src/core/adapter';
import type { SqliteContract } from '../src/core/types';

const contract = new SqlContractSerializer().deserializeContract({
  target: 'sqlite',
  targetFamily: 'sql',
  profileHash: 'raw-query-test',
  roots: {},
  capabilities: {},
  extensions: {},
  meta: {},
  storage: {
    storageHash: 'raw-query-core',
    namespaces: {
      __unbound__: {
        id: '__unbound__',
        entries: {
          table: {
            user: {
              columns: {
                id: { codecId: 'sqlite/integer@1', nativeType: 'integer', nullable: false },
                email: { codecId: 'sqlite/text@1', nativeType: 'text', nullable: false },
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
}) as SqliteContract;

const rawSql = createRawSql(sqliteRawCodecInferer, { contract });

function lower(plan: { readonly ast: Parameters<typeof renderLoweredSql>[0] }) {
  return renderLoweredSql(plan.ast, contract, sqliteCodecDescriptorRegistry);
}

describe('raw-query sqlite lowering', () => {
  it('binds bare-literal and param() interpolations in template order', () => {
    const plan =
      rawSql`SELECT id, email FROM "user" WHERE id > ${7} AND email = ${param('a@b.example', { codecId: 'sqlite/text@1' })}`
        .returnsRow({ id: 'sqlite/integer@1', email: 'sqlite/text@1' })
        .build();

    const lowered = lower(plan);

    expect(lowered.sql).toBe('SELECT id, email FROM "user" WHERE id > ? AND email = ?');
    expect(lowered.params).toEqual([
      { kind: 'literal', value: 7 },
      { kind: 'literal', value: 'a@b.example' },
    ]);
  });

  it('renders an interpolated expression through its lowering template', () => {
    const lowerEmail = buildOperation({
      method: 'lower',
      args: [ColumnRef.of('user', 'email')],
      returns: { codecId: 'sqlite/text@1', nullable: false },
      lowering: { targetFamily: 'sql', template: 'lower({{self}})' },
    });

    const plan = rawSql`SELECT ${lowerEmail} AS email FROM "user"`
      .returnsRow({ email: 'sqlite/text@1' })
      .build();

    const lowered = lower(plan);

    expect(lowered.sql).toBe('SELECT lower("user"."email") AS email FROM "user"');
    expect(lowered.params).toEqual([]);
  });

  it('keeps params in template order across a spliced subquery', () => {
    const active = rawSql`SELECT id FROM "user" WHERE id > ${10}`.returnsRow({
      id: 'sqlite/integer@1',
    });

    const plan = rawSql`WITH active AS (${active}) SELECT id FROM active WHERE id < ${99}`
      .returnsRow({ id: 'sqlite/integer@1' })
      .build();

    const lowered = lower(plan);

    expect(lowered.sql).toBe(
      'WITH active AS (SELECT id FROM "user" WHERE id > ?) SELECT id FROM active WHERE id < ?',
    );
    expect(lowered.params).toEqual([
      { kind: 'literal', value: 10 },
      { kind: 'literal', value: 99 },
    ]);
  });

  it('lowers an affected-count mutation statement', () => {
    const plan = rawSql`UPDATE "user" SET email = ${'new@b.example'} WHERE id = ${3}`
      .affectedCount()
      .build();

    const lowered = lower(plan);

    expect(lowered.sql).toBe('UPDATE "user" SET email = ? WHERE id = ?');
    expect(lowered.params).toEqual([
      { kind: 'literal', value: 'new@b.example' },
      { kind: 'literal', value: 3 },
    ]);
  });
});
