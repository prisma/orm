import { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import {
  exampleContractFromTypeScript,
  exampleContractSchema,
  loadExampleContract,
} from './example-contract';

const autoincrement = { kind: 'function', expression: 'autoincrement()' } as const;

describe('the example contract on MySQL', () => {
  it('loads as a contract for target mysql', () => {
    const contract = loadExampleContract();
    expect({ target: contract.target, capabilities: contract.capabilities }).toEqual({
      target: 'mysql',
      capabilities: {
        sql: { defaultInInsert: true, enums: true, foreignKeys: true, limit: true, orderBy: true },
      },
    });
  });

  it('has the same storage and storage hash when written with defineContract', () => {
    const fromPsl = loadExampleContract();
    const fromTypeScript = exampleContractFromTypeScript();
    expect(JSON.parse(JSON.stringify(fromTypeScript.storage))).toEqual(
      JSON.parse(JSON.stringify(fromPsl.storage)),
    );
    expect(fromTypeScript.storage.storageHash).toBe(fromPsl.storage.storageHash);
  });

  it('describes the schema IR a MySQL database with its tables introspects to', () => {
    expect(exampleContractSchema()).toEqual(
      new SqlSchemaIR({
        tables: {
          Post: {
            name: 'Post',
            columns: {
              id: { name: 'id', typeText: 'int', nullable: false, resolvedDefault: autoincrement },
              title: { name: 'title', typeText: 'varchar(191)', nullable: false },
              authorId: { name: 'authorId', typeText: 'int', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            foreignKeys: [
              { columns: ['authorId'], referencedTable: 'User', referencedColumns: ['id'] },
            ],
            uniques: [],
            indexes: [
              {
                naming: { kind: 'wire', prefix: 'Post_authorId_idx', hash: 'e47547ed' },
                columns: ['authorId'],
                unique: false,
                where: undefined,
                partial: false,
                type: undefined,
                options: undefined,
                annotations: undefined,
                dependsOn: undefined,
              },
            ],
          },
          User: {
            name: 'User',
            columns: {
              id: { name: 'id', typeText: 'int', nullable: false, resolvedDefault: autoincrement },
              email: { name: 'email', typeText: 'varchar(191)', nullable: false },
              role: { name: 'role', typeText: "enum('USER','ADMIN')", nullable: false },
            },
            primaryKey: { columns: ['id'] },
            foreignKeys: [],
            uniques: [{ columns: ['email'] }],
            indexes: [],
          },
        },
      }),
    );
  });

  it('types the enum column by its members, compared by the text MySQL prints', () => {
    const role = exampleContractSchema().tables['User']?.columns['role'];
    expect({ storedType: role?.storedType?.id, catalogText: role?.catalogText }).toEqual({
      storedType: 'mysql/enum',
      catalogText: "enum('USER','ADMIN')",
    });
  });
});
