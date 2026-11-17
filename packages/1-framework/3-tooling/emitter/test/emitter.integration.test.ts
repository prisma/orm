import type { CodecLookup } from '@internal/framework-components/codec';
import type { TypesImportSpec } from '@internal/framework-components/emission';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import type { EmitStackInput } from '../src/exports';
import { createMockSpi } from './mock-spi';
import { createTestContract, emit } from './utils';

const mockSqlHook = createMockSpi();

function literalCodecLookup(): CodecLookup {
  return {
    get: () => undefined,
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
              id: { type: { kind: 'scalar', codecId: 'pg/int4@1' }, nullable: false, many: false },
              email: {
                type: { kind: 'scalar', codecId: 'pg/text@1' },
                nullable: false,
                many: false,
              },
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
                      id: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false },
                      email: { codecId: 'pg/text@1', dataType: 'pg/text', nullable: false },
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
              id: { type: { kind: 'scalar', codecId: 'pg/int4@1' }, nullable: false, many: false },
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
                      id: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false },
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
      const result2 = await emit(ir, options, mockSqlHook);

      expect(result1.storageHash).toBe(result2.storageHash);
      expect(result1.contractDts).toBe(result2.contractDts);
      expect(result1.contractJson).toBe(result2.contractJson);
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
      // produced via the family `resolveStorageValueSet` resolver + the codec seam
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
                many: false,
              },
              title: {
                type: { kind: 'scalar', codecId: 'pg/text@1' },
                nullable: false,
                many: false,
              },
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
                      priority: { codecId: 'pg/text@1', dataType: 'pg/text', nullable: false },
                      title: { codecId: 'pg/text@1', dataType: 'pg/text', nullable: false },
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
        resolveStorageValueSet: (_modelName, fieldName, _model, contract) => {
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

      const overrides = result.contractDts.slice(
        result.contractDts.indexOf('type FieldTypeOverrides'),
        result.contractDts.indexOf('export type FieldOutputTypes'),
      );

      expect(overrides).toContain("readonly output: 'low' | 'high' | 'urgent';");
      expect(overrides).toContain("readonly input: 'low' | 'high' | 'urgent';");
      // The non-enum field has no override, so the shared generic gives it its codec type.
      expect(overrides).not.toContain('title');
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
          id: { nullable: false, many: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
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
