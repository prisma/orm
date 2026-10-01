import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import { fixtureDataTypeSupport } from './fixture-data-types';
import {
  createBuiltinLikeControlMutationDefaults,
  postgresScalarAuthoringTypes,
  postgresScalarTypeDescriptors,
  postgresTarget,
  symbolTableInputFromParseArgs,
} from './fixtures';

describe('interpretPslDocumentToSqlContract scalar list storage', () => {
  it('stores a scalar list, required or optional, in a list column', () => {
    const result = interpretPslDocumentToSqlContract({
      target: postgresTarget,
      scalarColumnDescriptors: postgresScalarTypeDescriptors,
      authoringContributions: { type: postgresScalarAuthoringTypes },
      composedExtensionContracts: new Map(),
      createNamespace: createTestSqlNamespace,
      dataTypeLookup: fixtureDataTypeSupport.lookup,
      capabilities: { sql: { scalarList: true } },
      ...symbolTableInputFromParseArgs({
        schema: `model User {
  id       Int       @id
  tags     String[]
  aliases  String[]?
}`,
        sourceId: 'schema.prisma',
      }),
      controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = { nativeType: 'text', codecId: 'pg/text@1', many: true };
    expect({
      fields: result.value.domain.namespaces['public']?.models['User']?.fields,
      columns: (result.value.storage as SqlStorage).namespaces['public']?.entries.table?.['User']
        ?.columns,
    }).toEqual({
      fields: {
        id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
        tags: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' }, many: true },
        aliases: { nullable: true, type: { kind: 'scalar', codecId: 'pg/text@1' }, many: true },
      },
      columns: {
        id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
        tags: { ...text, nullable: false },
        aliases: { ...text, nullable: true },
      },
    });
  });
});
