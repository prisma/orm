import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { fixtureInterpreterTypes } from './fixture-codec-descriptors';
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
        ...fixtureInterpreterTypes,
        capabilities: { sql: { scalarList: true } },
        controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = { dataType: 'pg/text', codecId: 'pg/text@1', many: { elementNullable: false } };
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
        id: { many: false, dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
        tags: { ...text, nullable: false },
        aliases: { ...text, nullable: true },
      },
    });
  });
});
