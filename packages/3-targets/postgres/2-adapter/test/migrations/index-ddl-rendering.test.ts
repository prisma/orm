/**
 * Byte-level index DDL rendering through the real adapter lowerer. The
 * contract-free AST nodes carry the structure; the adapter renderer owns
 * quoting and escaping, so the byte assertions live beside it.
 */
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  CreateIndexCall,
  DropIndexCall,
  RenameIndexCall,
} from '@internal/target-postgres/op-factory-call';
import { describe, expect, it } from 'vitest';
import { controlAdapter } from './fixtures/runner-fixtures';

async function executeSql(call: {
  toOp(lowerer: typeof controlAdapter): Promise<{ execute: readonly { sql: string }[] }>;
}): Promise<string> {
  const op = await call.toOp(controlAdapter);
  const stmt = op.execute[0];
  if (!stmt) throw new Error('op has no execute step');
  return stmt.sql;
}

describe('CreateIndexCall DDL rendering', () => {
  it('renders a plain CREATE INDEX when no extras are supplied', async () => {
    const call = new CreateIndexCall('public', 'user', 'user_email_idx', { columns: ['email'] });
    expect(await executeSql(call)).toBe(
      'CREATE INDEX "user_email_idx" ON "public"."user" ("email")',
    );
  });

  it('renders USING <method> when type is supplied', async () => {
    const call = new CreateIndexCall(
      'public',
      'doc',
      'doc_body_idx',
      { columns: ['body'] },
      {
        type: 'gin',
      },
    );
    expect(await executeSql(call)).toBe(
      'CREATE INDEX "doc_body_idx" ON "public"."doc" USING "gin" ("body")',
    );
  });

  it('renders WITH (...) when options are supplied', async () => {
    const call = new CreateIndexCall(
      'public',
      'doc',
      'doc_body_idx',
      { columns: ['body'] },
      {
        type: 'gin',
        options: { fastupdate: false },
      },
    );
    expect(await executeSql(call)).toBe(
      'CREATE INDEX "doc_body_idx" ON "public"."doc" USING "gin" ("body") WITH ("fastupdate" = off)',
    );
  });

  it('omits WITH when options is an empty object', async () => {
    const call = new CreateIndexCall(
      'public',
      'doc',
      'doc_body_idx',
      { columns: ['body'] },
      {
        type: 'gin',
        options: {},
      },
    );
    expect(await executeSql(call)).toBe(
      'CREATE INDEX "doc_body_idx" ON "public"."doc" USING "gin" ("body")',
    );
  });

  it('renders number, boolean, and string option leaves correctly', async () => {
    const call = new CreateIndexCall(
      'public',
      'doc',
      'doc_body_idx',
      { columns: ['body'] },
      {
        type: 'demo',
        options: { fillfactor: 70, fastupdate: false, pdb_locale: 'en-US' },
      },
    );
    expect(await executeSql(call)).toBe(
      `CREATE INDEX "doc_body_idx" ON "public"."doc" USING "demo" ("body") WITH ("fillfactor" = 70, "fastupdate" = off, "pdb_locale" = 'en-US')`,
    );
  });

  it('escapes single quotes in string option values', async () => {
    const call = new CreateIndexCall(
      'public',
      'doc',
      'doc_body_idx',
      { columns: ['body'] },
      {
        type: 'demo',
        options: { needle: "with'quote" },
      },
    );
    expect(await executeSql(call)).toContain(`"needle" = 'with''quote'`);
  });

  it('rejects null option values as CONTRACT.INDEX_INVALID', async () => {
    const call = new CreateIndexCall(
      'public',
      'doc',
      'doc_body_idx',
      { columns: ['body'] },
      {
        type: 'demo',
        options: { weird: null },
      },
    );
    await expect(call.toOp(controlAdapter)).rejects.toMatchObject({
      code: 'CONTRACT.INDEX_INVALID',
      message: 'Index option "weird" must be a string, finite number, or boolean; got object',
      meta: { key: 'weird', valueType: 'object' },
    });
  });

  it('rejects non-finite numeric option values', async () => {
    const call = new CreateIndexCall(
      'public',
      'doc',
      'doc_body_idx',
      { columns: ['body'] },
      {
        type: 'demo',
        options: { weird: Number.NaN },
      },
    );
    await expect(call.toOp(controlAdapter)).rejects.toThrow(/Index option/);
  });

  it('renders CREATE UNIQUE INDEX when unique is set', async () => {
    const call = new CreateIndexCall(
      'public',
      'user',
      'user_email_key',
      { columns: ['email'] },
      {
        unique: true,
      },
    );
    expect(await executeSql(call)).toBe(
      'CREATE UNIQUE INDEX "user_email_key" ON "public"."user" ("email")',
    );
  });

  it('renders the WHERE predicate verbatim in parens, never quoted or escaped', async () => {
    const call = new CreateIndexCall(
      'public',
      'doc',
      'doc_active_idx',
      { columns: ['email'] },
      {
        where: "deleted_at IS NULL AND status = 'active'",
      },
    );
    expect(await executeSql(call)).toBe(
      `CREATE INDEX "doc_active_idx" ON "public"."doc" ("email") WHERE (deleted_at IS NULL AND status = 'active')`,
    );
  });

  it('renders the expression element list verbatim, never quoted or escaped', async () => {
    const call = new CreateIndexCall('public', 'doc', 'doc_email_eq', {
      expression: 'eql_v3.eq_term(email)',
    });
    expect(await executeSql(call)).toBe(
      'CREATE INDEX "doc_email_eq" ON "public"."doc" (eql_v3.eq_term(email))',
    );
  });

  it('renders a GIN index over to_tsvector, the shape a full-text predicate needs', async () => {
    const call = new CreateIndexCall(
      'public',
      'message',
      'message_text_search',
      { expression: `to_tsvector('english', "text")` },
      { type: 'gin' },
    );
    expect(await executeSql(call)).toBe(
      `CREATE INDEX "message_text_search" ON "public"."message" USING "gin" (to_tsvector('english', "text"))`,
    );
  });

  it('combines unique, USING, expression, WITH, and WHERE in clause order', async () => {
    const call = new CreateIndexCall(
      'public',
      'doc',
      'doc_email_eq',
      { expression: 'lower(email), id' },
      {
        unique: true,
        type: 'btree',
        options: { fillfactor: 70 },
        where: 'deleted_at IS NULL',
      },
    );
    expect(await executeSql(call)).toBe(
      'CREATE UNIQUE INDEX "doc_email_eq" ON "public"."doc" USING "btree" (lower(email), id) WITH ("fillfactor" = 70) WHERE (deleted_at IS NULL)',
    );
  });

  it('renders unqualified names for the unbound namespace', async () => {
    const call = new CreateIndexCall(UNBOUND_NAMESPACE_ID, 'user', 'user_email_idx', {
      columns: ['email'],
    });
    expect(await executeSql(call)).toBe('CREATE INDEX "user_email_idx" ON "user" ("email")');
  });
});

describe('RenameIndexCall DDL rendering', () => {
  it('renders ALTER INDEX … RENAME TO with quoted identifiers', async () => {
    const call = new RenameIndexCall('public', 'user', 'old_email_idx', 'user_email_idx_46df9cad');
    expect(await executeSql(call)).toBe(
      'ALTER INDEX "public"."old_email_idx" RENAME TO "user_email_idx_46df9cad"',
    );
  });
});

describe('DropIndexCall DDL rendering', () => {
  it('renders DROP INDEX with the qualified name', async () => {
    const call = new DropIndexCall('public', 'user', 'user_email_idx');
    expect(await executeSql(call)).toBe('DROP INDEX "public"."user_email_idx"');
  });
});
