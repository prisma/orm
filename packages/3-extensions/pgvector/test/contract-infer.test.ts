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

function inferFrom(extensions: readonly (typeof pgvectorControl)[], nativeType = 'vector(3)') {
  const stack = createControlStack({
    family: sqlFamilyDescriptor,
    target: postgresTarget,
    adapter: postgresAdapter,
    extensions,
  });
  const vector = { text: nativeType, kind: undefined, schema: 'public', name: 'vector' };
  const tree = new PostgresDatabaseSchemaNode({
    namespaces: {
      public: new PostgresNamespaceSchemaNode({
        schemaName: 'public',
        tables: {
          item: new PostgresTableSchemaNode({
            name: 'item',
            columns: {
              id: {
                name: 'id',
                nativeType: 'int4',
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
                nativeType,
                nullable: false,
                reportedType: vector,
              },
              history: {
                name: 'history',
                nativeType,
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
  it.each(['vector(3)', 'vector'])(
    'prints the constructor for %s when the pack is configured',
    (nativeType) => {
      const args = nativeType === 'vector' ? [] : ['3'];
      const fields = flatPslModels(inferFrom([pgvectorControl], nativeType)())[0]?.fields ?? [];
      expect(
        fields.map((field) => ({
          name: field.name,
          path: field.typeConstructor?.path ?? [field.typeName],
          args: field.typeConstructor?.args.map((arg) => arg.value) ?? [],
          list: field.list,
        })),
      ).toEqual([
        { name: 'id', path: ['Int'], args: [], list: false },
        { name: 'embedding', path: ['pgvector', 'Vector'], args, list: false },
        { name: 'history', path: ['pgvector', 'Vector'], args, list: true },
      ]);
    },
  );

  it('fails and names each vector column when the pack is not configured', () => {
    expect(inferFrom([])).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.INFER_COLUMN_TYPE_UNCLAIMED',
        meta: { columns: ['public.item.embedding: vector(3)', 'public.item.history: vector(3)[]'] },
      }),
    );
  });
});
