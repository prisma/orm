import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import { fixtureDataTypeSupport } from './fixture-data-types';
import {
  createBuiltinLikeControlMutationDefaults,
  postgresCodecLookup,
  postgresNativeScalarTypeDescriptors,
  postgresScalarAuthoringTypes,
  postgresTarget,
  symbolTableInputFromParseArgs,
} from './fixtures';

function interpret(schema: string) {
  return interpretPslDocumentToSqlContract({
    ...symbolTableInputFromParseArgs({ schema, sourceId: 'schema.prisma' }),
    target: postgresTarget,
    codecLookup: postgresCodecLookup,
    scalarColumnDescriptors: postgresNativeScalarTypeDescriptors,
    authoringContributions: {
      type: postgresScalarAuthoringTypes,
      dataTypes: fixtureDataTypeSupport.entries,
    },
    dataTypeLookup: fixtureDataTypeSupport.lookup,
    composedExtensionContracts: new Map(),
    createNamespace: createTestSqlNamespace,
    capabilities: { sql: { scalarList: true } },
    controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
  });
}

describe('interpretPslDocumentToSqlContract given a view block', () => {
  it.each([
    ['plain fields', 'view ActiveUsers {\n  id Int\n}\n'],
    ['field attributes', 'view ActiveUsers {\n  id Int @unique\n\n  @@map("active")\n}\n'],
  ])('reports a view block with %s as an unsupported top-level block', (_, view) => {
    const result = interpret(`${view}model User {\n  id Int @id\n}\n`);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual([
      {
        code: 'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK',
        message: 'Unsupported top-level block "view"',
        sourceId: 'schema.prisma',
        span: {
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 4, line: 1, column: 5 },
        },
      },
    ]);
  });
});
