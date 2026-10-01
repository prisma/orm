import type { CrossReference } from '@internal/contract/types';
import type { CodecLookup } from '@internal/framework-components/codec';
import type { TypesImportSpec } from '@internal/framework-components/emission';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import type { EmitStackInput } from '../src/exports';
import { createMockSpi } from './mock-spi';
import { createTestContract, emit, modelsFromCanonicalContract } from './utils';

const mockSqlHook = createMockSpi();

function literalCodecLookup(): CodecLookup {
  return {
    get: () => undefined,
    targetTypesFor: () => undefined,
    renderOutputTypeFor: () => undefined,
    renderValueLiteralFor: (_id, value) =>
      typeof value === 'string'
        ? `'${value}'`
        : typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : undefined,
  };
}

describe('emitter integration', () => {
  it(
    'emits complete contract from IR to artifacts',
    async () => {
      const ir = createTestContract({
        models: {
          User: {
            storage: {
              table: 'user',
              fields: {
                id: { column: 'id' },
                email: { column: 'email' },
              },
            },
            fields: {
              id: { type: { kind: 'scalar', codecId: 'pg/int4@1' }, nullable: false },
              email: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false },
            },
            relations: {},
          },
        },
        storage: {
          namespaces: {
            __unbound__: {
              id: '__unbound__',
              entries: {
                table: {
                  user: {
                    columns: {
                      id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                      email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
                    },
                    primaryKey: { columns: ['id'] },
                    uniques: [],
                    indexes: [],
                    foreignKeys: [],
                  },
                },
              },
            },
          },
        },
        extensions: {
          postgres: {
            version: '0.0.1',
          },
          pg: {},
        },
      });

      const codecTypeImports: TypesImportSpec[] = [];
      const extensionIds = ['postgres', 'pg'];
      const options: EmitStackInput = {
        codecTypeImports,
        extensionIds,
      };

      const result = await emit(ir, options, mockSqlHook);

      expect(result.storageHash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.contractDts).toContain('export type Contract');
      expect(result.contractDts).toContain('CodecTypes');
      expect(result.contractDts).toContain('LaneCodecTypes');

      const contractJson = JSON.parse(result.contractJson);
      expect(contractJson).toMatchObject({
        schemaVersion: '1',
        targetFamily: 'sql',
        target: 'postgres',
        profileHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        roots: {},
        storage: {
          storageHash: result.storageHash,
          namespaces: {
            __unbound__: {
              id: '__unbound__',
              entries: {
                table: {
                  user: expect.anything(),
                },
              },
            },
          },
        },
      });
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'produces stable hashes for identical input',
    async () => {
      const ir = createTestContract({
        models: {
          User: {
            storage: {
              table: 'user',
              fields: {
                id: { column: 'id' },
              },
            },
            fields: {
              id: { type: { kind: 'scalar', codecId: 'pg/int4@1' }, nullable: false },
            },
            relations: {},
          },
        },
        storage: {
          tables: {
            user: {
              columns: {
                id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
        extensions: {
          postgres: {
            version: '0.0.1',
          },
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
      const result2 = await emit(ir, options, mockSqlHook);

      expect(result1.storageHash).toBe(result2.storageHash);
      expect(result1.contractDts).toBe(result2.contractDts);
      expect(result1.contractJson).toBe(result2.contractJson);
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'round-trip: IR → JSON → parse JSON → compare',
    async () => {
      const ir = createTestContract({
        models: {
          User: {
            storage: {
              table: 'user',
              fields: {
                id: { column: 'id' },
                email: { column: 'email' },
              },
            },
            fields: {
              id: { type: { kind: 'scalar', codecId: 'pg/int4@1' }, nullable: false },
              email: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false },
            },
            relations: {},
          },
        },
        storage: {
          namespaces: {
            __unbound__: {
              id: '__unbound__',
              entries: {
                table: {
                  user: {
                    columns: {
                      id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                      email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
                    },
                    primaryKey: { columns: ['id'] },
                    uniques: [],
                    indexes: [],
                    foreignKeys: [],
                  },
                },
              },
            },
          },
        },
        extensions: {
          postgres: {
            version: '0.0.1',
          },
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
    'emits the enum value union into FieldOutputTypes/FieldInputTypes for an enum-backed field',
    async () => {
      // Emit-then-consume proof. A real consumer reads the EMITTED contract.d.ts,
      // not `typeof contract`: the in-memory authoring handle's literal tuples are
      // erased by emission. This drives the full emit pipeline and asserts the
      // emitted typemap text carries the member-value union for an enum field —
      // produced via the family `resolveFieldValueSet` resolver + the codec seam
      // (`renderValueLiteralFor`), the same path the SQL/Mongo emitters wire.
      const ir = createTestContract({
        models: {
          Post: {
            storage: {
              table: 'post',
              fields: {
                priority: { column: 'priority' },
                title: { column: 'title' },
              },
            },
            fields: {
              priority: {
                type: { kind: 'scalar', codecId: 'pg/text@1' },
                nullable: false,
                valueSet: {
                  plane: 'domain',
                  entityKind: 'enum',
                  namespaceId: '__unbound__',
                  entityName: 'Priority',
                },
              },
              title: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false },
            },
            relations: {},
          },
        },
        enum: {
          Priority: {
            codecId: 'pg/text@1',
            members: [
              { name: 'Low', value: 'low' },
              { name: 'High', value: 'high' },
              { name: 'Urgent', value: 'urgent' },
            ],
          },
        },
        storage: {
          namespaces: {
            __unbound__: {
              id: '__unbound__',
              entries: {
                table: {
                  post: {
                    columns: {
                      priority: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
                      title: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
                    },
                    primaryKey: { columns: ['title'] },
                    uniques: [],
                    indexes: [],
                    foreignKeys: [],
                  },
                },
              },
            },
          },
        },
        extensions: { postgres: { version: '0.0.1' }, pg: {} },
      });

      const enumResolvingSpi = createMockSpi({
        resolveFieldValueSet: (_modelName, fieldName, _model, contract) => {
          if (fieldName !== 'priority') return undefined;
          const domainEnum = contract.domain.namespaces['__unbound__']?.enum?.['Priority'];
          return domainEnum
            ? { encodedValues: domainEnum.members.map((m) => m.value), codecId: domainEnum.codecId }
            : undefined;
        },
      });

      const result = await emit(
        ir,
        {
          codecTypeImports: [],
          extensionIds: ['postgres', 'pg'],
          codecLookup: literalCodecLookup(),
        },
        enumResolvingSpi,
      );

      const outputMap = result.contractDts.slice(
        result.contractDts.indexOf('export type FieldOutputTypes'),
        result.contractDts.indexOf('export type FieldInputTypes'),
      );
      const inputMap = result.contractDts.slice(
        result.contractDts.indexOf('export type FieldInputTypes'),
        result.contractDts.indexOf('export type TypeMaps'),
      );

      expect(outputMap).toContain("readonly priority: 'low' | 'high' | 'urgent'");
      expect(outputMap).not.toContain("readonly priority: CodecTypes['pg/text@1']['output']");
      // The non-enum field stays on the codec output channel.
      expect(outputMap).toContain("readonly title: CodecTypes['pg/text@1']['output']");

      expect(inputMap).toContain("readonly priority: 'low' | 'high' | 'urgent'");
      expect(inputMap).not.toContain("readonly priority: CodecTypes['pg/text@1']['input']");
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'emits the domain enum block with literal member tuples in the namespace type',
    async () => {
      const ir = createTestContract({
        models: {},
        enum: {
          Priority: {
            codecId: 'pg/text@1',
            members: [
              { name: 'Low', value: 'low' },
              { name: 'High', value: 'high' },
              { name: 'Urgent', value: 'urgent' },
            ],
          },
        },
        storage: {
          namespaces: {
            __unbound__: {
              id: '__unbound__',
              entries: { table: {} },
            },
          },
        },
        extensions: { postgres: { version: '0.0.1' }, pg: {} },
      });

      const result = await emit(
        ir,
        { codecTypeImports: [], extensionIds: ['postgres', 'pg'] },
        mockSqlHook,
      );

      expect(result.contractDts).toContain("readonly codecId: 'pg/text@1'");
      expect(result.contractDts).toContain("readonly name: 'Low'");
      expect(result.contractDts).toContain("readonly value: 'low'");
      expect(result.contractDts).toContain("readonly name: 'High'");
      expect(result.contractDts).toContain("readonly value: 'high'");
      expect(result.contractDts).toContain("readonly name: 'Urgent'");
      expect(result.contractDts).toContain("readonly value: 'urgent'");
      expect(result.contractDts).toContain('readonly enum:');
      expect(result.contractDts).toContain('readonly Priority:');
      expect(result.contractDts).toContain('readonly members: readonly [');
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'emits integer member values as bare number literals',
    async () => {
      const ir = createTestContract({
        models: {},
        enum: {
          Severity: {
            codecId: 'pg/int4@1',
            members: [
              { name: 'Low', value: 1 },
              { name: 'High', value: 10 },
            ],
          },
        },
        storage: {
          namespaces: {
            __unbound__: {
              id: '__unbound__',
              entries: { table: {} },
            },
          },
        },
        extensions: { postgres: { version: '0.0.1' }, pg: {} },
      });

      const result = await emit(
        ir,
        { codecTypeImports: [], extensionIds: ['postgres', 'pg'] },
        mockSqlHook,
      );

      expect(result.contractDts).toContain('readonly value: 1');
      expect(result.contractDts).toContain('readonly value: 10');
      expect(result.contractDts).not.toContain("readonly value: '1'");
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'quotes enum entry names in the enum block when the name is not a valid TS identifier',
    async () => {
      const ir = createTestContract({
        models: {},
        enum: {
          'in-progress-status': {
            codecId: 'pg/text@1',
            members: [{ name: 'Active', value: 'active' }],
          },
          Done: {
            codecId: 'pg/text@1',
            members: [{ name: 'Complete', value: 'complete' }],
          },
        },
        storage: {
          namespaces: {
            __unbound__: {
              id: '__unbound__',
              entries: { table: {} },
            },
          },
        },
        extensions: { postgres: { version: '0.0.1' }, pg: {} },
      });

      const result = await emit(
        ir,
        { codecTypeImports: [], extensionIds: ['postgres', 'pg'] },
        mockSqlHook,
      );

      expect(result.contractDts).toContain("readonly 'in-progress-status':");
      expect(result.contractDts).toContain('readonly Done:');
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'omits the enum member entirely for namespaces without enums',
    async () => {
      const ir = createTestContract({
        models: {},
        storage: {
          namespaces: {
            __unbound__: {
              id: '__unbound__',
              entries: { table: {} },
            },
          },
        },
        extensions: { postgres: { version: '0.0.1' }, pg: {} },
      });

      const result = await emit(
        ir,
        { codecTypeImports: [], extensionIds: ['postgres', 'pg'] },
        mockSqlHook,
      );

      expect(result.contractDts).not.toContain('readonly enum:');
    },
    timeouts.typeScriptCompilation,
  );
});

describe('declarations follow the canonical JSON', () => {
  function contractWithModels(order: readonly string[]) {
    const models: Record<string, unknown> = {};
    for (const name of order) {
      models[name] = {
        fields: {
          id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
        },
        relations: {},
        storage: { namespaceId: '__unbound__', table: name.toLowerCase(), namespace: 'public' },
      };
    }
    return createTestContract({ models });
  }

  it(
    'generates the same contract.d.ts whichever order the models were authored in',
    async () => {
      const authoredZebraFirst = await emit(
        contractWithModels(['Zebra', 'Apple']),
        {},
        createMockSpi(),
      );
      const authoredAppleFirst = await emit(
        contractWithModels(['Apple', 'Zebra']),
        {},
        createMockSpi(),
      );

      expect(authoredZebraFirst.contractJson).toBe(authoredAppleFirst.contractJson);
      expect(authoredZebraFirst.contractDts).toBe(authoredAppleFirst.contractDts);
      expect(authoredZebraFirst.contractDts.indexOf('Apple')).toBeLessThan(
        authoredZebraFirst.contractDts.indexOf('Zebra'),
      );
    },
    timeouts.typeScriptCompilation,
  );
});
