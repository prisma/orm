import { ContractValidationError } from '@internal/contract/contract-validation-error';
import paradedbPack from '@internal/extension-paradedb/pack';
import type { AuthoringTypeConstructorDescriptor } from '@internal/framework-components/authoring';
import { createDataTypeLookup, emptyCodecLookup } from '@internal/framework-components/codec';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { bindPslSchema } from '@internal/psl-parser/test';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import {
  describeUnsupportedSqlAttribute,
  sqlAttributeSpecs,
} from '@internal/sql-contract-psl/attribute-specs';
import { sqlContextInput } from '@internal/sql-contract-psl/test';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
// postgresPack is used directly in interpretPslDocumentToSqlContract (not in defineContract).
import postgresPack from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { describe, expect, it } from 'vitest';

const scalarColumnDescriptors = new Map<string, { codecId: string; nativeType: string }>([
  ['Int', { codecId: 'pg/int4@1', nativeType: 'int4' }],
  ['String', { codecId: 'pg/text@1', nativeType: 'text' }],
]);

const scalarTypeConstructors: Record<string, AuthoringTypeConstructorDescriptor> =
  Object.fromEntries(
    [...scalarColumnDescriptors].map(([name, output]) => [
      name,
      { kind: 'typeConstructor' as const, output },
    ]),
  );

const postgresDataTypeLookup = createDataTypeLookup(postgresDataTypes);

function interpret(schema: string) {
  const bound = bindPslSchema(schema, {
    sourceId: 'index-type-options.prisma',
    context: {
      composedExtensions: [paradedbPack.id],
      composedExtensionContracts: new Map(),
      authoringContributions: {
        field: {},
        type: scalarTypeConstructors,
        entityTypes: {},
        pslBlockDescriptors: {},
        modelAttributes: {},
        attributeSpecs: sqlAttributeSpecs,
        dataTypes: {},
      },
      pslDiagnostics: { describeUnsupportedAttribute: describeUnsupportedSqlAttribute },
      codecLookup: { ...emptyCodecLookup, descriptorFor: () => undefined },
      controlMutationDefaults: { defaultFunctionRegistry: new Map(), generatorDescriptors: [] },
      dataTypeLookup: postgresDataTypeLookup,
      resolvedInputs: [],
      capabilities: { sql: { scalarList: true } },
    },
  });
  return withSeedDiagnostics(
    interpretPslDocumentToSqlContract({
      documents: bound.documents,
      sources: bound.sources,
      symbolTable: bound.symbolTable,
      binder: bound.binder,
      ...sqlContextInput(bound.context),
      target: postgresPack,
      composedExtensionPackRefs: [paradedbPack],
      createNamespace: postgresCreateNamespace,
    }),
    bound.seedDiagnostics,
  );
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
