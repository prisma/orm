import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import {
  modelsOf,
  postgresNativeScalarTypeDescriptors,
  postgresScalarAuthoringTypes,
  postgresTarget,
  symbolTableInputFromParseArgs,
  testEnumEntityContributions,
} from './fixtures';

type DomainModels = Record<string, { fields: Record<string, unknown> }>;

function domainFields(schema: string) {
  const document = symbolTableInputFromParseArgs({ schema, sourceId: 'schema.prisma' });
  const result = interpretPslDocumentToSqlContract({
    ...document,
    target: postgresTarget,
    scalarColumnDescriptors: postgresNativeScalarTypeDescriptors,
    authoringContributions: {
      entityTypes: testEnumEntityContributions,
      type: postgresScalarAuthoringTypes,
      field: {},
    },
    composedExtensionContracts: new Map(),
    createNamespace: createTestSqlNamespace,
    capabilities: { sql: { scalarList: true } },
  });
  if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
  return (modelsOf(result.value) as DomainModels)['Post']?.fields ?? {};
}

describe('scalar list fields in the domain plane', () => {
  it('carry the same type params as the single-valued field of the same type', () => {
    const fields = domainFields(`model Post {
  id   Int @id
  tag  VarChar(32)
  tags VarChar(32)[]
  at   Timestamp(3)
  ats  Timestamp(3)[]?
}`);
    expect(fields['tags']).toEqual({
      nullable: false,
      many: true,
      type: { kind: 'scalar', codecId: 'sql/varchar@1', typeParams: { length: 32 } },
    });
    expect(fields['ats']).toEqual({
      nullable: true,
      many: true,
      type: {
        kind: 'scalar',
        codecId: 'pg/timestamp-temporal@1',
        typeParams: { precision: 3 },
      },
    });
    expect(fields['tag']).toMatchObject({ type: { typeParams: { length: 32 } } });
  });
});
