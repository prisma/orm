import { describe, expect, it, vi } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import {
  createBuiltinLikeControlMutationDefaults,
  postgresScalarTypeDescriptors,
  postgresTarget,
  symbolTableInputFromParseArgs,
  testEnumEntityContributions,
} from './fixtures';
import { sqlStorageFromSuccessfulSqlInterpretation } from './interpret-sql-contract-storage';
import { unboundTables } from './unbound-tables';

describe('index naming at PSL lowering', () => {
  const builtinControlMutationDefaults = createBuiltinLikeControlMutationDefaults();

  function interpret(schema: string) {
    const document = symbolTableInputFromParseArgs({ schema, sourceId: 'schema.prisma' });
    return interpretPslDocumentToSqlContract({
      ...document,
      target: postgresTarget,
      scalarColumnDescriptors: postgresScalarTypeDescriptors,
      authoringContributions: { entityTypes: testEnumEntityContributions, type: {}, field: {} },
      composedExtensionContracts: new Map(),
      controlMutationDefaults: builtinControlMutationDefaults,
      createNamespace: createTestSqlNamespace,
      capabilities: { sql: { scalarList: true } },
    });
  }

  it('unnamed @@index lowers wire-named with the default prefix and a content-hash wire name', () => {
    const result = interpret(`model Doc {
  id Int @id
  body String
  @@index([body])
}`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    expect(unboundTables(storage)['Doc']!.indexes).toEqual([
      {
        name: 'Doc_body_idx_f3377346',
        prefix: 'Doc_body_idx',
        columns: ['body'],
        unique: false,
      },
    ]);
  });

  it('@@index with map: lowers exact — the mapped name verbatim, no prefix, no hash', () => {
    const result = interpret(`model Doc {
  id Int @id
  body String
  @@index([body], map: "doc_body_lookup")
}`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    expect(unboundTables(storage)['Doc']!.indexes).toEqual([
      {
        name: 'doc_body_lookup',
        columns: ['body'],
        unique: false,
      },
    ]);
  });
});

describe('@@index matrix threading at PSL lowering', () => {
  const builtinControlMutationDefaults = createBuiltinLikeControlMutationDefaults();

  function interpretMatrix(schema: string) {
    const document = symbolTableInputFromParseArgs({ schema, sourceId: 'schema.prisma' });
    return interpretPslDocumentToSqlContract({
      ...document,
      target: postgresTarget,
      scalarColumnDescriptors: postgresScalarTypeDescriptors,
      authoringContributions: { entityTypes: testEnumEntityContributions, type: {}, field: {} },
      composedExtensionContracts: new Map(),
      controlMutationDefaults: builtinControlMutationDefaults,
      createNamespace: createTestSqlNamespace,
      capabilities: { sql: { scalarList: true } },
    });
  }

  it('expression + name lowers a wire-named expression index', () => {
    const result = interpretMatrix(`model User {
  id    Int    @id
  email String
  @@index(expression: "lower(email)", name: "users_email_eq")
}`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    expect(unboundTables(storage)['User']!.indexes).toEqual([
      {
        name: 'users_email_eq_17273133',
        prefix: 'users_email_eq',
        expression: 'lower(email)',
        unique: false,
      },
    ]);
  });

  it('where and unique thread through a fields index', () => {
    const result = interpretMatrix(`model User {
  id    Int    @id
  email String
  @@index([email], where: "(deleted_at IS NULL)", unique: true, name: "users_email_active")
}`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    const index = unboundTables(storage)['User']!.indexes[0];
    expect(index).toMatchObject({
      prefix: 'users_email_active',
      columns: ['email'],
      where: '(deleted_at IS NULL)',
      unique: true,
    });
  });

  it('the Cipherstash-style index authors as specified (type: rides the registry, covered by the e2e)', () => {
    const result = interpretMatrix(`model User {
  id    Int    @id
  email String
  @@index(expression: "eql_v3.eq_term(email)", name: "users_email_eq")
}`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    const index = unboundTables(storage)['User']!.indexes[0];
    expect(index).toMatchObject({
      prefix: 'users_email_eq',
      expression: 'eql_v3.eq_term(email)',
      unique: false,
    });
  });

  it('map with an expression lowers exact and draws the exact-name body warning', () => {
    const emitWarning = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
    try {
      const result = interpretMatrix(`model User {
  id    Int    @id
  email String
  @@index(expression: "lower(email)", map: "users_email_adopted")
}`);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
      expect(unboundTables(storage)['User']!.indexes).toEqual([
        { name: 'users_email_adopted', expression: 'lower(email)', unique: false },
      ]);
      expect(emitWarning).toHaveBeenCalledTimes(1);
      expect(String(emitWarning.mock.calls[0]?.[0])).toContain(
        'index "users_email_adopted" uses map: with a SQL body.',
      );
    } finally {
      emitWarning.mockRestore();
    }
  });
});
