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
import citextControl from '../src/exports/control';

function inferFrom(extensions: readonly (typeof citextControl)[]) {
  const stack = createControlStack({
    family: sqlFamilyDescriptor,
    target: postgresTarget,
    adapter: postgresAdapter,
    extensions,
  });
  const citext = { text: 'citext', kind: undefined, schema: 'public', name: 'citext' };
  const tree = new PostgresDatabaseSchemaNode({
    namespaces: {
      public: new PostgresNamespaceSchemaNode({
        schemaName: 'public',
        tables: {
          account: new PostgresTableSchemaNode({
            name: 'account',
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
              email: { name: 'email', typeText: 'citext', nullable: false, reportedType: citext },
              aliases: {
                name: 'aliases',
                typeText: 'citext',
                nullable: false,
                many: true,
                reportedType: citext,
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
    extensions: undefined,
    existingSchemas: ['public'],
    pgVersion: '',
  });
  return () => sqlFamilyDescriptor.create(stack).inferPslContract(tree);
}

describe('contract infer over a citext column', () => {
  it('prints citext.Citext when the pack is configured', async () => {
    const fields = flatPslModels(await inferFrom([citextControl])())[0]?.fields ?? [];
    expect(
      fields.map((field) => ({
        name: field.name,
        path: field.typeConstructor?.path ?? [field.typeName],
        list: field.list,
      })),
    ).toEqual([
      { name: 'id', path: ['Int'], list: false },
      { name: 'email', path: ['citext', 'Citext'], list: false },
      { name: 'aliases', path: ['citext', 'Citext'], list: true },
    ]);
  });

  it('fails and names each citext column when the pack is not configured', async () => {
    await expect(inferFrom([])()).rejects.toThrow(
      expect.objectContaining({
        code: 'CONTRACT.INFER_COLUMN_TYPE_UNCLAIMED',
        meta: { columns: ['public.account.aliases: citext[]', 'public.account.email: citext'] },
      }),
    );
  });
});
