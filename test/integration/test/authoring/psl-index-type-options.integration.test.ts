import { ContractValidationError } from '@internal/contract/contract-validation-error';
import paradedbPack from '@internal/extension-paradedb/pack';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
// postgresPack is used directly in interpretPslDocumentToSqlContract (not in defineContract).
import postgresPack from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { describe, expect, it } from 'vitest';

const scalarColumnDescriptors = new Map<string, { codecId: string; nativeType: string }>([
  ['Int', { codecId: 'pg/int4@1', nativeType: 'int4' }],
  ['String', { codecId: 'pg/text@1', nativeType: 'text' }],
]);

function interpret(schema: string) {
  const { document, sources } = parse(schema, 'index-type-options.prisma');
  const { symbolTable } = buildSymbolTable({
    documents: [document],
    sources,
    pslBlockDescriptors: {},
  });
  return interpretPslDocumentToSqlContract({
    dataTypeLookup: createDataTypeLookup(postgresDataTypes),
    document,
    symbolTable,
    sources,
    target: postgresPack,
    scalarColumnDescriptors,
    composedExtensionContracts: new Map(),
    composedExtensions: [paradedbPack.id],
    composedExtensionPackRefs: [paradedbPack],
    createNamespace: postgresCreateNamespace,
    capabilities: { sql: { scalarList: true } },
  });
}

describe('PSL @@index type and options — integration with real paradedb pack', () => {
  it('lowers the documented example to a Contract IR index node carrying type, options, and name', () => {
    const result = interpret(`model Doc {
  id Int @id
  body String
  @@index([body], type: "bm25", options: { key_field: "id" }, map: "doc_body_bm25_idx")
}`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            table: {
              Doc: {
                indexes: [
                  {
                    columns: ['body'],
                    name: 'doc_body_bm25_idx',
                    type: 'bm25',
                    options: { key_field: 'id' },
                  },
                ],
              },
            },
          },
        },
      },
    });
  });

  it('the interpreter rejects a PSL-authored bm25 index whose options miss key_field', () => {
    let thrown: unknown;
    try {
      interpret(`model Doc {
  id Int @id
  body String
  @@index([body], type: "bm25", options: { wrong_field: "x" })
}`);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ContractValidationError);
    const message = (thrown as ContractValidationError).message;
    expect(message).toContain('bm25');
    expect(message).toContain('key_field');
  });

  it('the interpreter rejects a PSL-authored index whose type is not registered', () => {
    expect(() =>
      interpret(`model Doc {
  id Int @id
  body String
  @@index([body], type: "made-up")
}`),
    ).toThrow(/unregistered index type "made-up"/);
  });

  it('the interpreter rejects an empty options literal for bm25 (missing key_field)', () => {
    expect(() =>
      interpret(`model Doc {
  id Int @id
  body String
  @@index([body], type: "bm25", options: {})
}`),
    ).toThrow(/key_field/);
  });
});
