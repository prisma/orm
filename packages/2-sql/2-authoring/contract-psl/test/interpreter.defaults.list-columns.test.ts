import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { fixtureDataTypeSupport } from './fixture-data-types';
import {
  createBuiltinLikeControlMutationDefaults,
  interpretSqlContract,
  postgresCodecLookup,
  postgresNativeScalarTypeDescriptors,
  postgresScalarAuthoringTypes,
  postgresTarget,
} from './fixtures';

const baseInput = {
  target: postgresTarget,
  codecLookup: postgresCodecLookup,
  scalarColumnDescriptors: postgresNativeScalarTypeDescriptors,
  authoringContributions: {
    type: postgresScalarAuthoringTypes,
    dataTypes: fixtureDataTypeSupport.entries,
  },
  dataTypes: fixtureDataTypeSupport,
  composedExtensionContracts: new Map(),
  createNamespace: createTestSqlNamespace,
  capabilities: { sql: { scalarList: true } },
} as const;

const builtinControlMutationDefaults = createBuiltinLikeControlMutationDefaults();

function expectDiagnosticForSchema(
  schema: string,
  diagnostic: { readonly code: string; readonly message?: string },
): void {
  const result = interpretSqlContract(schema, {
    ...baseInput,
    controlMutationDefaults: builtinControlMutationDefaults,
  });

  expect(result.ok).toBe(false);
  if (result.ok) return;
  const expected =
    diagnostic.message === undefined
      ? { code: diagnostic.code }
      : { code: diagnostic.code, message: diagnostic.message };
  expect(result.failure.diagnostics).toEqual(
    expect.arrayContaining([expect.objectContaining(expected)]),
  );
}

describe('interpretPslDocumentToSqlContract list-column defaults', () => {
  it.each([
    ['String?[]', '[null, "alpha", null, "beta", null]', [null, 'alpha', null, 'beta', null]],
    ['String?[]', '[null, null]', [null, null]],
    ['String?[]?', '["alpha", null]', ['alpha', null]],
    ['Int?[]', '[1, null, 2]', [1, null, 2]],
  ])('lowers %s defaults %s through the typed literal pipeline', (type, literal, value) => {
    const result = interpretSqlContract(
      `model Post {\n id Int @id\n tags ${type} @default(${literal})\n}`,
      { ...baseInput, controlMutationDefaults: builtinControlMutationDefaults },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            table: {
              Post: {
                columns: {
                  tags: { many: { elementNullable: true }, default: { kind: 'literal', value } },
                },
              },
            },
          },
        },
      },
    });
  });

  it('rejects null elements on strict lists despite a nullable container', () => {
    expectDiagnosticForSchema(
      'model Post {\n id Int @id\n tags String[]? @default(["alpha", null])\n}',
      { code: 'PSL_INVALID_DEFAULT_APPLICABILITY' },
    );
  });

  it('refuses autoincrement() on a list field, and only that storage function', () => {
    expectDiagnosticForSchema(
      'model Post {\n  id Int @id\n  tags Int[] @default(autoincrement())\n}\n',
      {
        code: 'PSL_LIST_AUTOINCREMENT_UNSUPPORTED',
        message:
          'Field "Post.tags" is a list and cannot use autoincrement(); it is a Prisma marker for a sequence-backed scalar column, not SQL.',
      },
    );
  });

  it.each([
    ['now()', 'now()'],
    ["sql`'{}'::text[]`", "'{}'::text[]"],
  ])(
    'lowers the storage default %s on a list field with no diagnostic',
    (attribute, expression) => {
      const result = interpretSqlContract(
        `model Post {\n  id Int @id\n  tags String[] @default(${attribute})\n}\n`,
        {
          ...baseInput,
          controlMutationDefaults: builtinControlMutationDefaults,
        },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.storage).toMatchObject({
        namespaces: {
          public: {
            entries: {
              table: { Post: { columns: { tags: { default: { kind: 'function', expression } } } } },
            },
          },
        },
      });
    },
  );

  it('rejects an execution default uuid() on a list field', () => {
    expectDiagnosticForSchema(
      `model Post {
  id Int @id
  tags String[] @default(uuid())
}
`,
      {
        code: 'PSL_LIST_EXECUTION_DEFAULT_UNSUPPORTED',
        message:
          'Field "Post.tags" is a list and cannot use an execution default ("uuid()"). Lists have no per-element execution-default semantics; use a literal list @default or remove the default.',
      },
    );
  });
});
