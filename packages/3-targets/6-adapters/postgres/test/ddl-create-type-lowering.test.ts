import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import { PostgresCreateType, PostgresDropType } from '@internal/target-postgres/ddl';
import { describe, expect, it } from 'vitest';
import { PostgresControlAdapter } from '../src/core/control-adapter';
import type { PostgresContract } from '../src/core/types';

const adapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());
const ctx = { contract: {} as PostgresContract };

describe('PostgresControlAdapter.lowerToExecuteRequest — CREATE/DROP TYPE DDL', () => {
  it('renders CREATE TYPE schema-qualified, quoted, declaration-ordered, single-quote-escaped', async () => {
    const ast = new PostgresCreateType({
      schema: 'sales',
      name: 'order status',
      values: ['draft', "it's reviewed", 'done'],
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result).toEqual({
      sql: `CREATE TYPE "sales"."order status" AS ENUM ('draft', 'it''s reviewed', 'done')`,
      params: [],
    });
  });

  it('renders CREATE TYPE unqualified when no schema (search_path resolves it)', async () => {
    const ast = new PostgresCreateType({ name: 'mood', values: ['happy'] });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result).toEqual({
      sql: `CREATE TYPE "mood" AS ENUM ('happy')`,
      params: [],
    });
  });

  it('renders DROP TYPE schema-qualified and quoted', async () => {
    const ast = new PostgresDropType({ schema: 'sales', name: 'order_status' });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result).toEqual({ sql: `DROP TYPE "sales"."order_status"`, params: [] });
  });

  it('renders DROP TYPE unqualified when no schema', async () => {
    const ast = new PostgresDropType({ name: 'mood' });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result).toEqual({ sql: `DROP TYPE "mood"`, params: [] });
  });
});
