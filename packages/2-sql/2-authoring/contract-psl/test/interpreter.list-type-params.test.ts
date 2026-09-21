import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import {
  modelsOf,
  postgresNativeScalarTypeDescriptors,
  postgresScalarAuthoringTypes,
  postgresTarget,
  symbolTableInputFromParseArgs,
} from './fixtures';

const authoringTypes = {
  ...postgresScalarAuthoringTypes,
  VarCharish: {
    kind: 'typeConstructor',
    args: [{ kind: 'number', name: 'length', integer: true, minimum: 1 }],
    output: {
      codecId: 'sql/varchar@1',
      nativeType: 'character varying',
      typeParams: { length: { kind: 'arg', index: 0 } },
    },
  },
} satisfies AuthoringTypeNamespace;

describe('interpretPslDocumentToSqlContract list fields with type parameters', () => {
  it('gives a list field the same type parameters as the scalar field of that type', () => {
    const document = symbolTableInputFromParseArgs({
      schema: 'model Doc {\n  id Int @id\n  one VarCharish(12)\n  many VarCharish(12)[]\n}\n',
      sourceId: 'schema.prisma',
    });
    const result = interpretPslDocumentToSqlContract({
      ...document,
      target: postgresTarget,
      scalarColumnDescriptors: postgresNativeScalarTypeDescriptors,
      authoringContributions: { type: authoringTypes },
      composedExtensionContracts: new Map(),
      createNamespace: createTestSqlNamespace,
      capabilities: { sql: { scalarList: true } },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(modelsOf(result.value)['Doc']?.fields).toMatchObject({
      one: { type: { kind: 'scalar', codecId: 'sql/varchar@1', typeParams: { length: 12 } } },
      many: {
        type: { kind: 'scalar', codecId: 'sql/varchar@1', typeParams: { length: 12 } },
        many: true,
      },
    });
  });
});
