import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { generateDataContractJsonSchema } from '../src/data-contract-json-schema';
import { validSqlContractJson } from './sql-contract-json-fixture';
import { storageWithNamespacedTables } from './storage-with-namespaced-tables';

const checkedInSchemaPath = join(import.meta.dirname, '..', 'schemas', 'data-contract-sql-v1.json');

function compileGeneratedSchema() {
  const ajv = new Ajv2020({ strict: false });
  return ajv.compile(generateDataContractJsonSchema());
}

describe('data contract JSON schema', () => {
  it('accepts omitted cardinality on model and value-object fields', () => {
    const validate = new Ajv2020({ strict: false }).compile(
      JSON.parse(readFileSync(checkedInSchemaPath, 'utf8')),
    );
    const field = { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false };
    const contract = validSqlContractJson({
      domain: {
        namespaces: {
          __unbound__: {
            models: {
              User: {
                storage: { namespaceId: '__unbound__', table: 'User', fields: {} },
                fields: { name: field },
              },
            },
            valueObjects: { Address: { fields: { city: field } } },
          },
        },
      },
    });
    expect({ valid: validate(contract), errors: validate.errors }).toEqual({
      valid: true,
      errors: null,
    });
  });

  describe.each(['domain field', 'storage column'])('%s many metadata', (location) => {
    it.each([
      { many: false, valid: true },
      { many: { elementNullable: false }, valid: true },
      { many: { elementNullable: true }, valid: true },
      { many: { elementNullable: false, elementNullabe: true }, valid: false },
      { many: {}, valid: false },
      { many: { elementNullable: 'false' }, valid: false },
    ])('validates $many as $valid', ({ many, valid }) => {
      const validate = new Ajv2020({ strict: false }).compile(
        JSON.parse(readFileSync(checkedInSchemaPath, 'utf8')),
      );
      const contract = validSqlContractJson(
        location === 'domain field'
          ? {
              models: {
                User: {
                  storage: { namespaceId: '__unbound__', table: 'User', fields: {} },
                  fields: { tags: { type: 'String', nullable: false, many } },
                },
              },
            }
          : {
              storage: storageWithNamespacedTables({
                storageHash: 'test',
                tables: {
                  User: {
                    columns: {
                      tags: { codecId: 'pg/text@1', nativeType: 'text', nullable: false, many },
                    },
                    uniques: [],
                    indexes: [],
                    foreignKeys: [],
                  },
                },
              }),
            },
      );
      expect(validate(contract)).toBe(valid);
    });
  });

  it('checked-in schemas/data-contract-sql-v1.json matches the generated output', () => {
    const checkedIn = JSON.parse(readFileSync(checkedInSchemaPath, 'utf8'));
    expect(checkedIn).toEqual(generateDataContractJsonSchema());
  });

  it('accepts a valid contract envelope including wire-only keys', () => {
    const validate = compileGeneratedSchema();
    const contract = {
      $schema: '../../schemas/data-contract-sql-v1.json',
      ...validSqlContractJson(),
      _generated: { warning: 'generated file' },
    };
    expect({ valid: validate(contract), errors: validate.errors }).toEqual({
      valid: true,
      errors: null,
    });
  });

  it('accepts columns with many, control, valueSet, default, and table checks', () => {
    const validate = compileGeneratedSchema();
    const contract = validSqlContractJson({
      storage: storageWithNamespacedTables({
        storageHash: 'test',
        tables: {
          User: {
            columns: {
              id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false, many: false },
              tags: {
                codecId: 'pg/text@1',
                nativeType: 'text',
                nullable: false,
                many: { elementNullable: false },
              },
              status: {
                codecId: 'pg/text@1',
                nativeType: 'text',
                nullable: false,
                control: 'managed',
                valueSet: {
                  plane: 'storage',
                  namespaceId: '__unbound__',
                  entityKind: 'valueSet',
                  entityName: 'user_status',
                },
                default: { kind: 'literal', value: 'active' },
              },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
            control: 'managed',
            checks: [{ name: 'user_status_check', expression: "status IN ('active')" }],
          },
        },
      }),
    });
    expect({ valid: validate(contract), errors: validate.errors }).toEqual({
      valid: true,
      errors: null,
    });
  });

  it('rejects a column with an unknown property', () => {
    const validate = compileGeneratedSchema();
    const contract = validSqlContractJson({
      storage: storageWithNamespacedTables({
        storageHash: 'test',
        tables: {
          User: {
            columns: {
              id: {
                codecId: 'pg/text@1',
                nativeType: 'text',
                nullable: false,
                noSuchColumnField: true,
              },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      }),
    });
    expect(validate(contract)).toBe(false);
  });

  it('accepts pack-contributed entry kinds as generic entity maps', () => {
    const validate = compileGeneratedSchema();
    const contract = validSqlContractJson({
      storage: {
        storageHash: 'test',
        namespaces: {
          __unbound__: {
            id: '__unbound__',
            entries: {
              table: {},
              rls: { User: { kind: 'rls', tableName: 'User', enabled: true } },
            },
          },
        },
      },
    });
    expect({ valid: validate(contract), errors: validate.errors }).toEqual({
      valid: true,
      errors: null,
    });
  });
});
