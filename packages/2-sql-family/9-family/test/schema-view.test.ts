import type {
  ControlFamilyDescriptor,
  ControlTargetDescriptor,
} from '@internal/framework-components/control';
import { createControlStack } from '@internal/framework-components/control';
import type { SqlSchemaIRNode } from '@internal/sql-schema-ir/types';
import { SqlIndexIR, SqlSchemaIR, SqlTableIR } from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { createSqlFamilyInstance } from '../src/core/control-instance';

function createMockStack() {
  return createControlStack({
    family: {
      kind: 'family',
      id: 'sql',
      familyId: 'sql',
      version: '0.0.1',
      create: (() => ({})) as unknown as ControlFamilyDescriptor<'sql'>['create'],
      emission: {
        id: 'sql',
        generateStorageType: () =>
          '{ readonly tables: Record<string, never>; readonly types: Record<string, never>; readonly storageHash: StorageHash }',
        generateModelStorageType: () => 'Record<string, never>',
        getFamilyImports: () => [
          "import type { ContractWithTypeMaps, TypeMaps as TypeMapsType } from '@internal/sql-contract/types';",
        ],
        getFamilyTypeAliases: () => '',
        getTypeMapsExpression: () => 'TypeMapsType<CodecTypes, OperationTypes>',
        getContractWrapper: (base: string, tm: string) =>
          `export type Contract = ContractWithTypeMaps<${base}, ${tm}>;`,
      },
    },
    target: {
      kind: 'target',
      id: 'postgres',
      version: '0.0.1',
      familyId: 'sql',
      targetId: 'postgres',
      defaultNamespaceId: 'public',
      contractSerializer: {
        deserializeContract: (json) => json as never,
        serializeContract: (contract) => contract as never,
      },
      create: () => ({ familyId: 'sql', targetId: 'postgres' }),
    } as ControlTargetDescriptor<'sql', 'postgres'>,
    adapter: {
      kind: 'adapter',
      id: 'postgres',
      version: '0.0.1',
      familyId: 'sql',
      targetId: 'postgres',

      create: () => ({ familyId: 'sql', targetId: 'postgres' }),
    },
    extensions: [],
  });
}

describe('SqlFamilyInstance.toSchemaView', () => {
  it('stores column defaults in meta, not in label', () => {
    const familyInstance = createSqlFamilyInstance(createMockStack());

    const schema = new SqlSchemaIR({
      tables: {
        User: {
          name: 'User',
          columns: {
            id: {
              name: 'id',
              typeText: 'int4',
              nullable: false,
              default: "nextval('users_id_seq'::regclass)",
            },
            status: {
              name: 'status',
              typeText: 'text',
              nullable: false,
              default: "'draft'::text",
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
    });

    const view = familyInstance.toSchemaView(schema);
    const userTable = view.root.children?.find((n) => n.id === 'table-User');
    expect(userTable?.kind).toBe('entity');

    const columnsGroup = userTable?.children?.find((n) => n.id === 'columns-User');
    expect(columnsGroup?.kind).toBe('collection');

    const idNode = columnsGroup?.children?.find((n) => n.id === 'column-User-id');
    expect(idNode?.kind).toBe('field');
    expect(idNode?.label).toBe('id: int4 (not nullable)');
    expect(idNode?.meta).toMatchObject({
      typeText: 'int4',
      nullable: false,
      default: "nextval('users_id_seq'::regclass)",
    });

    const statusNode = columnsGroup?.children?.find((n) => n.id === 'column-User-status');
    expect(statusNode?.kind).toBe('field');
    expect(statusNode?.label).toBe('status: text (not nullable)');
    expect(statusNode?.meta).toMatchObject({
      typeText: 'text',
      nullable: false,
      default: "'draft'::text",
    });
  });

  it('splits each label into keyword, name and detail parts', () => {
    const familyInstance = createSqlFamilyInstance(createMockStack());
    const schema = new SqlSchemaIR({
      tables: {
        post: {
          name: 'post',
          columns: { id: { name: 'id', typeText: 'int4', nullable: false } },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [{ name: 'post_slug_key', columns: ['slug'] }],
          indexes: [
            new SqlIndexIR({
              naming: { kind: 'exact', name: 'post_title_idx' },
              columns: ['title'],
              where: undefined,
              unique: true,
              type: undefined,
              options: undefined,
              annotations: undefined,
              dependsOn: undefined,
              partial: false,
            }),
          ],
        },
      },
    });

    const table = familyInstance.toSchemaView(schema).root.children?.[0];
    const [columns, primaryKey, unique, index] = table?.children ?? [];

    expect(table?.labelParts).toEqual([
      { text: 'table', role: 'keyword' },
      { text: ' ' },
      { text: 'post', role: 'name' },
    ]);
    expect(columns?.children?.[0]?.labelParts).toEqual([
      { text: 'id', role: 'name' },
      { text: ': ' },
      { text: 'int4' },
      { text: ' ' },
      { text: '(not nullable)', role: 'detail' },
    ]);
    expect(primaryKey?.labelParts).toEqual([
      { text: 'primary key', role: 'keyword' },
      { text: ': ' },
      { text: 'id', role: 'name' },
    ]);
    expect(unique?.labelParts).toEqual([
      { text: 'unique', role: 'keyword' },
      { text: ' ' },
      { text: 'post_slug_key', role: 'name' },
    ]);
    expect(index?.labelParts).toEqual([
      { text: 'unique index', role: 'keyword' },
      { text: ' ' },
      { text: 'post_title_idx', role: 'name' },
    ]);
  });

  it('flattens tables from every namespace of a multi-namespace root', () => {
    const familyInstance = createSqlFamilyInstance(createMockStack());

    const namespaceTable = (columnName: string): SqlTableIR =>
      new SqlTableIR({
        name: 'ignored',
        columns: {
          [columnName]: { name: columnName, typeText: 'int4', nullable: false },
        },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      });

    const schema = {
      namespaces: {
        public: { schemaName: 'public', tables: { User: namespaceTable('id') } },
        audit: { schemaName: 'audit', tables: { Log: namespaceTable('event') } },
      },
    } as unknown as SqlSchemaIRNode;

    const view = familyInstance.toSchemaView(schema);
    const tableIds = view.root.children?.map((n) => n.id) ?? [];
    expect(tableIds).toContain('table-public.User');
    expect(tableIds).toContain('table-audit.Log');

    const userColumn = view.root.children
      ?.find((n) => n.id === 'table-public.User')
      ?.children?.find((n) => n.id === 'columns-public.User')
      ?.children?.find((n) => n.id === 'column-public.User-id');
    expect(userColumn?.label).toBe('id: int4 (not nullable)');
  });

  it('renders same-named tables in different namespaces with distinct ids and labels', () => {
    const familyInstance = createSqlFamilyInstance(createMockStack());

    const namespaceTable = (columnName: string): SqlTableIR =>
      new SqlTableIR({
        name: 'ignored',
        columns: {
          [columnName]: { name: columnName, typeText: 'int4', nullable: false },
        },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      });

    const schema = {
      namespaces: {
        public: { schemaName: 'public', tables: { thing: namespaceTable('id') } },
        auth: { schemaName: 'auth', tables: { thing: namespaceTable('uid') } },
      },
    } as unknown as SqlSchemaIRNode;

    const view = familyInstance.toSchemaView(schema);
    const tables = view.root.children ?? [];
    const ids = tables.map((n) => n.id);
    expect(ids).toEqual(['table-public.thing', 'table-auth.thing']);
    expect(new Set(ids).size).toBe(2);
    expect(tables.map((n) => n.label)).toEqual(['table public.thing', 'table auth.thing']);
  });

  it('keeps unqualified ids and labels for a single-namespace root', () => {
    const familyInstance = createSqlFamilyInstance(createMockStack());

    const schema = {
      namespaces: {
        public: {
          schemaName: 'public',
          tables: {
            users: {
              name: 'users',
              columns: { id: { name: 'id', typeText: 'int4', nullable: false } },
              foreignKeys: [],
              uniques: [],
              indexes: [],
            },
          },
        },
      },
    } as unknown as SqlSchemaIRNode;

    const view = familyInstance.toSchemaView(schema);
    const tables = view.root.children ?? [];
    expect(tables.map((n) => n.id)).toEqual(['table-users']);
    expect(tables.map((n) => n.label)).toEqual(['table users']);
  });
});
