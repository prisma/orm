import type { TargetPackRef } from '@internal/framework-components/components';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { buildSqlContractFromDefinition } from '../src/contract-builder';

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
};

const int4 = { codecId: 'pg/int4@1', nativeType: 'int4' } as const;

describe('a field typed by a named storage type in the domain', () => {
  it('takes the named type parameters inline, and reads a named type without parameters as none', () => {
    const contract = buildSqlContractFromDefinition({
      warnings: undefined,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      storageTypes: {
        Short: {
          kind: 'codec-instance',
          codecId: 'sql/varchar@1',
          nativeType: 'character varying',
          typeParams: { length: 10 },
        },
        Email: {
          kind: 'codec-instance',
          codecId: 'pg/text@1',
          nativeType: 'text',
          typeParams: {},
        },
      },
      models: [
        {
          modelName: 'User',
          tableName: 'user',
          fields: [
            { fieldName: 'id', columnName: 'id', descriptor: int4, nullable: false },
            {
              fieldName: 'code',
              columnName: 'code',
              descriptor: {
                codecId: 'sql/varchar@1',
                nativeType: 'character varying',
                typeRef: 'Short',
              },
              nullable: false,
            },
            {
              fieldName: 'email',
              columnName: 'email',
              descriptor: { codecId: 'pg/text@1', nativeType: 'text', typeRef: 'Email' },
              nullable: false,
            },
          ],
          id: { columns: ['id'] },
        },
      ],
    });

    const { id: _id, ...fields } =
      contract.domain.namespaces['public']?.models['User']?.fields ?? {};
    expect(fields).toEqual({
      code: {
        type: { kind: 'scalar', codecId: 'sql/varchar@1', typeParams: { length: 10 } },
        nullable: false,
      },
      email: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false },
    });
  });
});
