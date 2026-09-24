import type { ContractField } from '@internal/contract/types';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import { buildPostgresPslContract } from '../../src/core/psl-print/psl-contract';
import { extensionCodec, testPrintContext } from './print-context';
import {
  deserialize,
  INT_COLUMN,
  PUBLIC,
  printing,
  printingWidget,
  refusal,
  TEXT_FIELD,
  widgetContract,
  withRawEntries,
} from './refusal-support';

describe('parts of the contract no model carries', () => {
  it('refuses a table no model is stored in', () => {
    expect(
      printingWidget({
        tables: {
          audit_log: { columns: { id: INT_COLUMN }, uniques: [], indexes: [], foreignKeys: [] },
        },
      }),
    ).toThrow(refusal({ namespaceId: 'public', table: 'audit_log' }));
  });

  it('refuses a value set no enum derives', () => {
    expect(
      printingWidget({ entries: { valueSet: { Stray: { kind: 'valueSet', values: ['a'] } } } }),
    ).toThrow(refusal({ namespaceId: 'public', name: 'Stray' }));
  });

  it('refuses a value set whose values are not the members of the enum it is named after', () => {
    expect(
      printingWidget({
        domain: {
          enum: { Priority: { codecId: 'pg/text@1', members: [{ name: 'Low', value: 'low' }] } },
        },
        entries: { valueSet: { Priority: { kind: 'valueSet', values: ['low', 'high'] } } },
      }),
    ).toThrow(refusal({ namespaceId: 'public', name: 'Priority' }));
  });

  it('refuses a native enum with no value set holding its members', () => {
    expect(
      printingWidget({
        entries: {
          native_enum: { status: { kind: 'postgres-enum', typeName: 'status', members: ['a'] } },
        },
      }),
    ).toThrow(refusal({ namespaceId: 'public', typeName: 'status' }));
  });

  it('refuses an enum with no value set holding its members', () => {
    expect(
      printingWidget({
        domain: {
          enum: { Priority: { codecId: 'pg/text@1', members: [{ name: 'Low', value: 'low' }] } },
        },
      }),
    ).toThrow(refusal({ namespaceId: 'public', name: 'Priority' }));
  });

  it('refuses a native enum whose value set name is not a PSL identifier', () => {
    expect(
      printingWidget({
        entries: {
          native_enum: { status: { kind: 'postgres-enum', typeName: 'status', members: ['a'] } },
          valueSet: { 'order status': { kind: 'valueSet', values: ['a'] } },
        },
      }),
    ).toThrow(refusal({ kind: 'native enum', name: 'order status' }));
  });

  it('refuses a native enum with its own control policy', () => {
    expect(
      printingWidget({
        entries: {
          native_enum: {
            status: {
              kind: 'postgres-enum',
              typeName: 'status',
              members: ['a'],
              control: 'external',
            },
          },
          valueSet: { status: { kind: 'valueSet', values: ['a'] } },
        },
      }),
    ).toThrow(refusal({ namespaceId: 'public', typeName: 'status', control: 'external' }));
  });

  it('refuses a domain enum outside the default namespace', () => {
    expect(
      printingWidget({
        domainNamespaces: {
          auth: {
            models: {},
            enum: { Role: { codecId: 'pg/text@1', members: [{ name: 'Admin', value: 'admin' }] } },
          },
        },
      }),
    ).toThrow(refusal({ namespaceId: 'auth', names: ['Role'] }));
  });

  it('refuses a namespace that declares nothing', () => {
    expect(
      printingWidget({ storageNamespaces: { archive: { id: 'archive', entries: { table: {} } } } }),
    ).toThrow(refusal({ plane: 'storage', namespaceId: 'archive' }));
  });

  it('refuses a domain namespace with no model, value object or enum', () => {
    expect(printingWidget({ domainNamespaces: { archive: { models: {} } } })).toThrow(
      refusal({ plane: 'domain', namespaceId: 'archive' }),
    );
  });

  it('refuses a contract without the default namespace the PSL source always creates', () => {
    const contract = deserialize(widgetContract());
    const { public: _, ...others } = contract.storage.namespaces;
    const withoutPublic = blindCast<typeof contract, 'a contract missing its default namespace'>({
      ...contract,
      domain: { namespaces: {} },
      roots: {},
      storage: { ...contract.storage, namespaces: others },
    });
    expect(printing(withoutPublic)).toThrow(refusal({ plane: 'storage', namespaceId: 'public' }));
  });

  it('refuses top-level meta entries', () => {
    expect(printingWidget({ contract: { meta: { owner: 'billing' } } })).toThrow(
      refusal({ keys: ['owner'] }),
    );
  });

  it('refuses roots other than the ones the PSL source derives', () => {
    expect(printingWidget({ contract: { roots: {} } })).toThrow(refusal({ root: 'Widget' }));
    expect(
      printingWidget({
        contract: {
          roots: {
            widgets: { namespace: PUBLIC, model: 'Widget' },
          },
        },
      }),
    ).toThrow(refusal({ root: 'widgets' }));
  });

  it('refuses an entity kind the printer does not write', () => {
    expect(
      printing(
        withRawEntries(deserialize(widgetContract()), 'public', { sequence: { counter: {} } }),
      ),
    ).toThrow(refusal({ namespaceId: 'public', kind: 'sequence', names: ['counter'] }));
  });

  it.each(['rls', 'policy', 'role', 'native_enum'])(
    'refuses a %s entry that is not an entity of its kind',
    (kind) => {
      expect(
        printing(
          withRawEntries(deserialize(widgetContract()), 'public', { [kind]: { odd: { kind } } }),
        ),
      ).toThrow(refusal({ namespaceId: 'public', kind, name: 'odd' }));
    },
  );
});

describe('row-level security', () => {
  const RLS = { Widget: { kind: 'rls', namespaceId: 'public', tableName: 'Widget' } };
  const ROLES = {
    app_user: { kind: 'role', name: 'app_user', namespaceId: '__unbound__', control: 'external' },
  };

  function policy(overrides: Record<string, unknown> = {}) {
    return {
      kind: 'policy',
      name: 'widget_read',
      tableName: 'Widget',
      namespaceId: 'public',
      operation: 'select',
      roles: ['app_user'],
      using: 'true',
      permissive: true,
      ...overrides,
    };
  }

  function withRls(
    entries: Record<string, Record<string, unknown>>,
    unboundRoles: Record<string, unknown> = ROLES,
  ) {
    return printingWidget({
      entries,
      storageNamespaces: {
        __unbound__: { id: '__unbound__', entries: { table: {}, role: unboundRoles } },
      },
    });
  }

  it('prints the row-level security the refusal tests start from', () => {
    expect(withRls({ rls: RLS, policy: { widget_read: policy() } })).not.toThrow();
  });

  it('refuses row-level security on a table with no model', () => {
    expect(
      withRls({
        rls: { ...RLS, archive: { kind: 'rls', namespaceId: 'public', tableName: 'archive' } },
      }),
    ).toThrow(refusal({ namespaceId: 'public', table: 'archive' }));
  });

  it('refuses a policy on a table with no model', () => {
    expect(
      withRls({ rls: RLS, policy: { widget_read: policy({ tableName: 'archive' }) } }),
    ).toThrow(refusal({ namespaceId: 'public', table: 'archive', name: 'widget_read' }));
  });

  it('refuses a policy on a table without row-level security', () => {
    expect(withRls({ policy: { widget_read: policy() } })).toThrow(
      refusal({ namespaceId: 'public', table: 'Widget', name: 'widget_read' }),
    );
  });

  it('refuses a policy named by something other than a PSL identifier', () => {
    expect(
      withRls({
        rls: RLS,
        policy: {
          'Enable read access for all users': policy({ name: 'Enable read access for all users' }),
        },
      }),
    ).toThrow(refusal({ kind: 'policy', name: 'Enable read access for all users' }));
  });

  it('refuses a policy role that is not a PSL identifier', () => {
    expect(
      withRls(
        { rls: RLS, policy: { widget_read: policy({ roles: ['app user'] }) } },
        {
          'app user': {
            kind: 'role',
            name: 'app user',
            namespaceId: '__unbound__',
            control: 'external',
          },
        },
      ),
    ).toThrow(refusal({ kind: 'role', name: 'app user' }));
  });

  it('refuses a wire-named policy whose name is not its prefix and the hash of its content', () => {
    expect(
      withRls({
        rls: RLS,
        policy: { widget_read: policy({ name: 'widget_read_00000000', prefix: 'widget_read' }) },
      }),
    ).toThrow(refusal({ namespaceId: 'public', table: 'Widget', name: 'widget_read_00000000' }));
  });

  it('writes a policy expression holding a tab and another control character', () => {
    expect(
      withRls({ rls: RLS, policy: { widget_read: policy({ using: 'owner\t= 1\u0001' }) } }),
    ).not.toThrow();
  });

  it('refuses a role outside the unbound namespace', () => {
    expect(
      withRls({ role: { app_user: { ...ROLES.app_user, namespaceId: 'public' } } }, {}),
    ).toThrow(refusal({ namespaceId: 'public', name: 'app_user' }));
  });
});

describe('value objects', () => {
  function addressContract(field: ContractField) {
    return deserialize(
      widgetContract({
        columns: { address: { nativeType: 'jsonb', codecId: 'pg/jsonb@1', nullable: false } },
        fields: { address: { nullable: false, type: { kind: 'valueObject', name: 'Address' } } },
        domain: { valueObjects: { Address: { fields: { street: field } } } },
      }),
    );
  }

  function withAddress(field: ContractField) {
    return printing(addressContract(field));
  }

  it('refuses a value object outside the default namespace, which the PSL source would move', () => {
    expect(
      printingWidget({
        domainNamespaces: {
          auth: { models: {}, valueObjects: { Address: { fields: { street: TEXT_FIELD } } } },
        },
        storageNamespaces: { auth: { id: 'auth', entries: { table: {} } } },
      }),
    ).toThrow(refusal({ namespaceId: 'auth', names: ['Address'] }));
  });

  it('refuses a value-object field whose type is a union', () => {
    expect(
      withAddress({
        nullable: false,
        type: { kind: 'union', members: [{ kind: 'scalar', codecId: 'pg/text@1' }] },
      }),
    ).toThrow(refusal({ coordinate: '"public".Address.street', kind: 'union' }));
  });

  it('refuses a value-object field that is a dictionary', () => {
    expect(withAddress({ ...TEXT_FIELD, dict: true })).toThrow(
      refusal({ coordinate: '"public".Address.street' }),
    );
  });

  it('refuses a value-object field whose codec no Postgres codec in the stack names a native type for', () => {
    expect(
      withAddress({ nullable: false, type: { kind: 'scalar', codecId: 'pgvector/vector@1' } }),
    ).toThrow(refusal({ coordinate: '"public".Address.street', codecId: 'pgvector/vector@1' }));
  });

  it('refuses a value-object field whose codec names a native type only from type parameters', () => {
    expect(
      withAddress({ nullable: false, type: { kind: 'scalar', codecId: 'pg/enum@1' } }),
    ).toThrow(refusal({ coordinate: '"public".Address.street', codecId: 'pg/enum@1' }));
  });

  it('writes a value-object field typed by a codec only the stack knows, as the type constructor that produces it', () => {
    const context = testPrintContext({
      codecs: [extensionCodec],
      types: {
        ext: {
          Citext: {
            kind: 'typeConstructor',
            output: { codecId: extensionCodec.codecId, nativeType: 'citext' },
          },
        },
      },
    });
    const document = buildPostgresPslContract(
      addressContract({
        nullable: false,
        type: { kind: 'scalar', codecId: extensionCodec.codecId },
      }),
      context,
    );

    expect(
      document.namespaces.flatMap((namespace) =>
        namespace.compositeTypes.flatMap((compositeType) =>
          compositeType.fields.map((field) => field.typeName),
        ),
      ),
    ).toEqual(['ext.Citext']);
  });

  it('refuses a value-object field whose type carries type parameters, which the PSL source drops', () => {
    expect(
      withAddress({
        nullable: false,
        type: { kind: 'scalar', codecId: 'sql/varchar@1', typeParams: { length: 20 } },
      }),
    ).toThrow(refusal({ coordinate: '"public".Address.street' }));
  });

  it('refuses a value-object field that names a value set, which the PSL source drops', () => {
    expect(
      withAddress({
        ...TEXT_FIELD,
        valueSet: {
          plane: 'storage',
          entityKind: 'valueSet',
          namespaceId: 'public',
          entityName: 'Label',
        },
      }),
    ).toThrow(refusal({ coordinate: '"public".Address.street' }));
  });
});
