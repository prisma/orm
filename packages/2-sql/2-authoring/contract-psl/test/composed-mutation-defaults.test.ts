import type {
  DefaultFunctionLoweringContext,
  TypedDefaultFunctionCall,
} from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import {
  type InterpretPslDocumentToSqlContractInput,
  interpretPslDocumentToSqlContract as interpretPslDocumentToSqlContractInternal,
} from '../src/interpreter';
import {
  postgresScalarTypeDescriptors,
  postgresTarget,
  symbolTableInputFromParseArgs,
} from './fixtures';

describe('composed mutation default registries', () => {
  const interpretPslDocumentToSqlContract = (
    input: Omit<
      InterpretPslDocumentToSqlContractInput,
      | 'target'
      | 'scalarColumnDescriptors'
      | 'composedExtensionContracts'
      | 'createNamespace'
      | 'capabilities'
    > &
      Partial<Pick<InterpretPslDocumentToSqlContractInput, 'composedExtensionContracts'>>,
  ) =>
    interpretPslDocumentToSqlContractInternal({
      target: postgresTarget,
      scalarColumnDescriptors: postgresScalarTypeDescriptors,
      composedExtensionContracts: new Map(),
      createNamespace: createTestSqlNamespace,
      capabilities: { sql: { scalarList: true } },
      ...input,
    });

  it('rejects a default function call as invalid syntax when no components contribute handlers', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model User {
  id Int @id
  externalId String @default(uuid())
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...document });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
          message: expect.stringContaining('Expected one of'),
        }),
      ]),
    );
  });

  it('accepts a function contributed through component composition', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model User {
  id Int @id
  slug String @default(slugid())
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: {
        defaultLiteralTagRegistry: new Map(),
        defaultFunctionRegistry: new Map([
          [
            'slugid',
            {
              signature: { documentation: 'Generates a slug identifier when a value is omitted.' },
              lower: (input: {
                call: TypedDefaultFunctionCall;
                context: DefaultFunctionLoweringContext;
              }) => {
                void input;
                return {
                  ok: true as const,
                  value: {
                    kind: 'execution' as const,
                    generated: {
                      kind: 'generator' as const,
                      id: 'slugid',
                    },
                  },
                };
              },
              usageSignatures: ['slugid()'],
            },
          ],
        ]),
        generatorDescriptors: [{ id: 'slugid', applicableCodecIds: ['pg/text@1'] }],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toMatchObject({
      execution: {
        mutations: {
          defaults: [
            {
              ref: { namespace: 'public', table: 'User', column: 'slug' },
              onCreate: { kind: 'generator', id: 'slugid' },
            },
          ],
        },
      },
    });
  });

  it('emits applicability diagnostics for incompatible generator codec ids', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model User {
  id Int @id @default(slugid())
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: {
        defaultLiteralTagRegistry: new Map(),
        defaultFunctionRegistry: new Map([
          [
            'slugid',
            {
              signature: { documentation: 'Generates a slug identifier for text fields.' },
              lower: () => ({
                ok: true as const,
                value: {
                  kind: 'execution' as const,
                  generated: {
                    kind: 'generator' as const,
                    id: 'slugid',
                  },
                },
              }),
              usageSignatures: ['slugid()'],
            },
          ],
        ]),
        generatorDescriptors: [{ id: 'slugid', applicableCodecIds: ['pg/text@1'] }],
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_DEFAULT_APPLICABILITY',
          message: expect.stringContaining('slugid'),
        }),
      ]),
    );
  });
});
