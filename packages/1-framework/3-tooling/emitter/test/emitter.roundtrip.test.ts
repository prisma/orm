import type { CrossReference } from '@internal/contract/types';
import type { TypesImportSpec } from '@internal/framework-components/emission';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import type { EmitStackInput } from '../src/exports';
import { createMockSpi } from './mock-spi';
import { createTestContract, emit, modelsFromCanonicalContract } from './utils';

const mockSqlHook = createMockSpi();

function unboundNamespaceTables(tables: Record<string, unknown>) {
  return {
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: { id: UNBOUND_NAMESPACE_ID, entries: { table: tables } },
    },
  };
}

function tablesFromCanonicalStorage(storage: Record<string, unknown>): Record<string, unknown> {
  const namespaces = storage['namespaces'] as Record<string, unknown>;
  const unbound = namespaces[UNBOUND_NAMESPACE_ID] as Record<string, unknown>;
  const entries = unbound['entries'] as Record<string, unknown>;
  return entries['table'] as Record<string, unknown>;
}

describe('emitter round-trip', () => {
  it(
    'round-trip with minimal IR',
    async () => {
      const ir = createTestContract({
        storage: unboundNamespaceTables({
          user: {
            columns: {
              id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        }),
        extensions: {
          postgres: { version: '0.0.1' },
          pg: {},
        },
      });

      const codecTypeImports: TypesImportSpec[] = [];
      const extensionIds = ['postgres', 'pg'];
      const options: EmitStackInput = {
        codecTypeImports,
        extensionIds,
      };

      const result1 = await emit(ir, options, mockSqlHook);
      const contractJson1 = JSON.parse(result1.contractJson) as Record<string, unknown>;

      const ir2 = createTestContract({
        targetFamily: contractJson1['targetFamily'] as string,
        target: contractJson1['target'] as string,
        roots: contractJson1['roots'] as Record<string, CrossReference>,
        models: modelsFromCanonicalContract(contractJson1),
        storage: contractJson1['storage'] as Record<string, unknown>,
        extensions: contractJson1['extensions'] as Record<string, unknown>,
        capabilities:
          (contractJson1['capabilities'] as Record<string, Record<string, boolean>>) || {},
        meta: (contractJson1['meta'] as Record<string, unknown>) || {},
      });

      const result2 = await emit(ir2, options, mockSqlHook);

      expect(result1.contractJson).toBe(result2.contractJson);
      expect(result1.storageHash).toBe(result2.storageHash);
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'round-trip with complex IR',
    async () => {
      const ir = createTestContract({
        models: {
          User: {
            storage: {
              table: 'user',
              fields: {
                id: { column: 'id' },
                email: { column: 'email' },
                name: { column: 'name' },
              },
            },
            fields: {
              id: { type: { kind: 'scalar', codecId: 'pg/int4@1' }, nullable: false, many: false },
              email: {
                type: { kind: 'scalar', codecId: 'pg/text@1' },
                nullable: false,
                many: false,
              },
              name: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: true, many: false },
            },
            relations: {},
          },
          Post: {
            storage: {
              table: 'post',
              fields: {
                id: { column: 'id' },
                title: { column: 'title' },
                userId: { column: 'user_id' },
              },
            },
            fields: {
              id: { type: { kind: 'scalar', codecId: 'pg/int4@1' }, nullable: false, many: false },
              title: {
                type: { kind: 'scalar', codecId: 'pg/text@1' },
                nullable: false,
                many: false,
              },
              userId: {
                type: { kind: 'scalar', codecId: 'pg/int4@1' },
                nullable: false,
                many: false,
              },
            },
            relations: {},
          },
        },
        storage: unboundNamespaceTables({
          user: {
            columns: {
              id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
              email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              name: { codecId: 'pg/text@1', nativeType: 'text', nullable: true },
            },
            primaryKey: { columns: ['id'] },
            uniques: [{ columns: ['email'], name: 'user_email_key' }],
            indexes: [{ columns: ['name'], name: 'user_name_idx' }],
            foreignKeys: [],
          },
          post: {
            columns: {
              id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
              title: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              user_id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [
              {
                source: {
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  tableName: 'post',
                  columns: ['user_id'],
                },
                target: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'user', columns: ['id'] },
                name: 'post_user_id_fkey',
              },
            ],
          },
        }),
        extensions: {
          postgres: { version: '0.0.1' },
        },
      });

      const codecTypeImports: TypesImportSpec[] = [];
      const extensionIds = ['postgres'];
      const options: EmitStackInput = {
        codecTypeImports,
        extensionIds,
      };

      const result1 = await emit(ir, options, mockSqlHook);
      const contractJson1 = JSON.parse(result1.contractJson) as Record<string, unknown>;

      const ir2 = createTestContract({
        targetFamily: contractJson1['targetFamily'] as string,
        target: contractJson1['target'] as string,
        roots: contractJson1['roots'] as Record<string, CrossReference>,
        models: modelsFromCanonicalContract(contractJson1),
        storage: contractJson1['storage'] as Record<string, unknown>,
        extensions: contractJson1['extensions'] as Record<string, unknown>,
        capabilities:
          (contractJson1['capabilities'] as Record<string, Record<string, boolean>>) || {},
        meta: (contractJson1['meta'] as Record<string, unknown>) || {},
      });

      const result2 = await emit(ir2, options, mockSqlHook);

      expect(result1.contractJson).toBe(result2.contractJson);
      expect(result1.storageHash).toBe(result2.storageHash);
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'round-trip with nullable fields',
    async () => {
      const ir = createTestContract({
        storage: unboundNamespaceTables({
          user: {
            columns: {
              id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
              email: { codecId: 'pg/text@1', nativeType: 'text', nullable: true },
              name: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        }),
        extensions: {
          postgres: { version: '0.0.1' },
          pg: {},
        },
      });

      const codecTypeImports: TypesImportSpec[] = [];
      const extensionIds = ['postgres', 'pg'];
      const options: EmitStackInput = {
        codecTypeImports,
        extensionIds,
      };

      const result1 = await emit(ir, options, mockSqlHook);
      const contractJson1 = JSON.parse(result1.contractJson) as Record<string, unknown>;

      const ir2 = createTestContract({
        targetFamily: contractJson1['targetFamily'] as string,
        target: contractJson1['target'] as string,
        roots: contractJson1['roots'] as Record<string, CrossReference>,
        models: modelsFromCanonicalContract(contractJson1),
        storage: contractJson1['storage'] as Record<string, unknown>,
        extensions: contractJson1['extensions'] as Record<string, unknown>,
        capabilities:
          (contractJson1['capabilities'] as Record<string, Record<string, boolean>>) || {},
        meta: (contractJson1['meta'] as Record<string, unknown>) || {},
      });

      const result2 = await emit(ir2, options, mockSqlHook);

      expect(result1.contractJson).toBe(result2.contractJson);
      expect(result1.storageHash).toBe(result2.storageHash);

      const parsed2 = JSON.parse(result2.contractJson) as Record<string, unknown>;
      const storage = parsed2['storage'] as Record<string, unknown>;
      const tables = tablesFromCanonicalStorage(storage);
      const user = tables['user'] as Record<string, unknown>;
      const columns = user['columns'] as Record<string, unknown>;
      const id = columns['id'] as Record<string, unknown>;
      const email = columns['email'] as Record<string, unknown>;
      const name = columns['name'] as Record<string, unknown>;
      expect(id['nullable']).toBe(false);
      expect(email['nullable']).toBe(true);
      expect(name['nullable']).toBe(false);
    },
    timeouts.typeScriptCompilation,
  );

  it('round-trip with capabilities', async () => {
    const ir = createTestContract({
      storage: unboundNamespaceTables({
        user: {
          columns: {
            id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      }),
      extensions: {
        postgres: { version: '0.0.1' },
        pg: {},
      },
      capabilities: {
        postgres: {
          jsonAgg: true,
          lateral: true,
        },
      },
    });

    const codecTypeImports: TypesImportSpec[] = [];
    const extensionIds = ['postgres', 'pg'];
    const options: EmitStackInput = {
      codecTypeImports,
      extensionIds,
    };

    const result1 = await emit(ir, options, mockSqlHook);
    const contractJson1 = JSON.parse(result1.contractJson) as Record<string, unknown>;

    const ir2 = createTestContract({
      targetFamily: contractJson1['targetFamily'] as string,
      target: contractJson1['target'] as string,
      roots: contractJson1['roots'] as Record<string, CrossReference>,
      models: modelsFromCanonicalContract(contractJson1),
      storage: contractJson1['storage'] as Record<string, unknown>,
      extensions: contractJson1['extensions'] as Record<string, unknown>,
      capabilities:
        (contractJson1['capabilities'] as Record<string, Record<string, boolean>>) || {},
      meta: (contractJson1['meta'] as Record<string, unknown>) || {},
    });

    const result2 = await emit(ir2, options, mockSqlHook);

    expect(result1.contractJson).toBe(result2.contractJson);
    expect(result1.storageHash).toBe(result2.storageHash);
    expect(result1.profileHash).toBe(result2.profileHash);
  });
});
