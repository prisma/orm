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
import postgisControl from '../src/exports/control';

function inferFrom(
  extensions: readonly (typeof postgisControl)[],
  columns: Readonly<Record<string, string>>,
) {
  const stack = createControlStack({
    family: sqlFamilyDescriptor,
    target: postgresTarget,
    adapter: postgresAdapter,
    extensions,
  });
  const geometry = (text: string) => ({
    text,
    kind: undefined,
    schema: 'public',
    name: 'geometry',
  });
  const column = (name: string, text: string) => ({
    name,
    typeText: text,
    nullable: false,
    reportedType: geometry(text),
  });
  const tree = new PostgresDatabaseSchemaNode({
    extensions: undefined,
    namespaces: {
      public: new PostgresNamespaceSchemaNode({
        schemaName: 'public',
        tables: {
          place: new PostgresTableSchemaNode({
            name: 'place',
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
              ...Object.fromEntries(
                Object.entries(columns).map(([name, text]) => [name, column(name, text)]),
              ),
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

const claimed = { area: 'geometry', located: 'geometry(Geometry,4326)' };

describe('contract infer over PostGIS columns', () => {
  it('prints postgis.Geometry with its srid when the pack is configured', async () => {
    const fields = flatPslModels(await inferFrom([postgisControl], claimed)())[0]?.fields ?? [];
    expect(
      fields.map((field) => ({
        name: field.name,
        path: field.typeConstructor?.path ?? [field.typeName],
        args: field.typeConstructor?.args.map((arg) => arg.value) ?? [],
      })),
    ).toEqual([
      { name: 'id', path: ['Int'], args: [] },
      { name: 'area', path: ['postgis', 'Geometry'], args: [] },
      { name: 'located', path: ['postgis', 'Geometry'], args: ['4326'] },
    ]);
  });

  it('fails on a geometry subtype, which no data type claims, even with the pack', async () => {
    await expect(
      inferFrom([postgisControl], { ...claimed, point: 'geometry(Point,4326)' })(),
    ).rejects.toThrow(
      expect.objectContaining({
        code: 'CONTRACT.INFER_COLUMN_TYPE_UNCLAIMED',
        meta: { columns: ['public.place.point: geometry(Point,4326)'] },
      }),
    );
  });

  it('fails and names each geometry column when the pack is not configured', async () => {
    await expect(inferFrom([], claimed)()).rejects.toThrow(
      expect.objectContaining({
        code: 'CONTRACT.INFER_COLUMN_TYPE_UNCLAIMED',
        meta: {
          columns: ['public.place.area: geometry', 'public.place.located: geometry(Geometry,4326)'],
        },
      }),
    );
  });
});
