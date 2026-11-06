import { type ParamRef, RawQueryAst } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { contractFromJson } from '../src/static/contract-from-json';
import postgresStatic from '../src/static/postgres-static';
import type { Contract } from './fixtures/generated/contract';
import contractJson from './fixtures/generated/contract.json' with { type: 'json' };

const contract = contractFromJson<Contract>(contractJson);
const db = () => postgresStatic({ contract });

/** Interpolated values ride the node's param refs. A plan lists them once lowered. */
const paramValues = (ast: RawQueryAst): unknown[] =>
  ast.collectParamRefs().map((ref) => (ref as ParamRef).value);

describe('the raw lane on the client', () => {
  it('builds a plan from a template the way a caller writes one', () => {
    const client = db();
    const users = client.sql.public.users;

    const plan = client.raw.sql`SELECT id, email FROM users WHERE invited_by_id = ${1}`
      .returnsRow({ id: users.columns.id, email: users.columns.email })
      .build();

    expect(plan.ast).toBeInstanceOf(RawQueryAst);
    expect(plan.meta.lane).toBe('raw');
    expect(plan.meta.target).toBe('postgres');
    expect(paramValues(plan.ast as RawQueryAst)).toEqual([1]);
  });

  it('carries the declared columns onto the node', () => {
    const plan = db().raw.sql`SELECT count(*) AS n FROM users`
      .returnsRow({ n: 'pg/int8@1' })
      .build();
    const ast = plan.ast as RawQueryAst;

    expect(ast.result).toEqual({
      kind: 'rows',
      columns: { n: { codecId: 'pg/int8@1', nullable: false } },
    });
  });

  it('builds an affected-count plan from the mutation terminator', () => {
    const plan = db().raw.sql`UPDATE users SET name = ${'Ada'} WHERE id = ${1}`
      .affectedCount()
      .build();

    expect((plan.ast as RawQueryAst).result).toEqual({ kind: 'affected-count' });
    expect(paramValues(plan.ast as RawQueryAst)).toEqual(['Ada', 1]);
  });
});
