import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { fixtureDataTypeSupport } from './fixture-data-types';
import {
  createBuiltinLikeControlMutationDefaults,
  interpretSqlContract,
  postgresScalarAuthoringTypes,
  postgresScalarTypeDescriptors,
  postgresTarget,
} from './fixtures';

describe('interpretPslDocumentToSqlContract scalar list storage', () => {
  it('stores a scalar list, required or optional, in a list column', () => {
    const result = interpretSqlContract(
      `model User {
  id       Int       @id
  tags     String[]
  aliases  String[]?
}`,
      {
        target: postgresTarget,
        scalarColumnDescriptors: postgresScalarTypeDescriptors,
        authoringContributions: { type: postgresScalarAuthoringTypes },
        composedExtensionContracts: new Map(),
        createNamespace: createTestSqlNamespace,
        dataTypes: fixtureDataTypeSupport,
        capabilities: { sql: { scalarList: true } },
        controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = { nativeType: 'text', codecId: 'pg/text@1', many: { elementNullable: false } };
    expect({
      fields: result.value.domain.namespaces['public']?.models['User']?.fields,
      columns: (result.value.storage as SqlStorage).namespaces['public']?.entries.table?.['User']
        ?.columns,
    }).toEqual({
      fields: {
        id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' }, many: false },
        tags: {
          nullable: false,
          type: { kind: 'scalar', codecId: 'pg/text@1' },
          many: { elementNullable: false },
        },
        aliases: {
          nullable: true,
          type: { kind: 'scalar', codecId: 'pg/text@1' },
          many: { elementNullable: false },
        },
      },
      columns: {
        id: { many: false, nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
        tags: { ...text, nullable: false },
        aliases: { ...text, nullable: true },
      },
    });
  });
});
