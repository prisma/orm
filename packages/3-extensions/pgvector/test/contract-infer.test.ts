import postgresAdapter from '@internal/adapter-postgres/control';
import sqlFamilyDescriptor from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import { flatPslModels } from '@internal/framework-components/psl-ast';
import postgresTarget from '@internal/target-postgres/control';
import {
  PostgresDatabaseSchemaNode,
  PostgresNamespaceSchemaNode,
  PostgresTableSchemaNode,
} from '@internal/target-postgres/types';
import { describe, expect, it } from 'vitest';
import pgvectorControl from '../src/exports/control';

function inferFrom(extensions: readonly (typeof pgvectorControl)[]) {
  const stack = createControlStack({
    family: sqlFamilyDescriptor,
    target: postgresTarget,
    adapter: postgresAdapter,
    extensions,
  });
  const vector = { text: 'vector(3)', kind: undefined, schema: 'public', name: 'vector' };
  const tree = new PostgresDatabaseSchemaNode({
    extensions: undefined,
    namespaces: {
      public: new PostgresNamespaceSchemaNode({
        schemaName: 'public',
        tables: {
          item: new PostgresTableSchemaNode({
            name: 'item',
            columns: {
              id: {
                name: 'id',
                typeText: 'int4',
                nullable: false,
                reportedType: {
                  text: 'integer',
                  kind: undefined,
                  schema: 'pg_catalog',
                  name: 'int4',
                },
              },
              embedding: {
                name: 'embedding',
                typeText: 'vector(3)',
                nullable: false,
                reportedType: vector,
              },
              history: {
                name: 'history',
                typeText: 'vector(3)',
                nullable: false,
                many: true,
                reportedType: vector,
              },
            },
            primaryKey: { columns: ['id'] },
            foreignKeys: [],
            uniques: [],
            indexes: [],
            rlsEnabled: false,
          }),
        },
        nativeEnums: [],
      }),
    },
    roles: [],
    existingSchemas: ['public'],
    pgVersion: '',
  });
  return () => sqlFamilyDescriptor.create(stack).inferPslContract(tree);
}

describe('contract infer over a pgvector column', () => {
  it('prints pgvector.Vector(3) when the pack is configured', async () => {
    const fields = flatPslModels(await inferFrom([pgvectorControl])())[0]?.fields ?? [];
    expect(
      fields.map((field) => ({
        name: field.name,
        path: field.typeConstructor?.path ?? [field.typeName],
        args: field.typeConstructor?.args.map((arg) => arg.value) ?? [],
        list: field.list,
      })),
    ).toEqual([
      { name: 'id', path: ['Int'], args: [], list: false },
      { name: 'embedding', path: ['pgvector', 'Vector'], args: ['3'], list: false },
      { name: 'history', path: ['pgvector', 'Vector'], args: ['3'], list: true },
    ]);
  });

  it('fails and names each vector column when the pack is not configured', async () => {
    await expect(inferFrom([])()).rejects.toThrow(
      expect.objectContaining({
        code: 'CONTRACT.INFER_COLUMN_TYPE_UNCLAIMED',
        meta: { columns: ['public.item.embedding: vector(3)', 'public.item.history: vector(3)[]'] },
      }),
    );
  });
});
