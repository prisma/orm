import type { Contract } from '@internal/contract/types';
import { asNamespaceId } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import {
  deserialize,
  INT_FIELD,
  PUBLIC,
  printing,
  printingWidget,
  refusal,
  TEXT_COLUMN,
  TEXT_FIELD,
  widgetContract,
  withRawEntries,
} from './refusal-support';

describe('names PSL writes as identifiers', () => {
  it('refuses a value object name that is not an identifier', () => {
    expect(
      printingWidget({
        domain: { valueObjects: { 'Postal Address': { fields: { street: TEXT_FIELD } } } },
      }),
    ).toThrow(refusal({ kind: 'value object', name: 'Postal Address' }));
  });

  it('refuses a field named after a number word, which PSL reads as a number', () => {
    expect(printingWidget({ columns: { NaN: TEXT_COLUMN }, fields: { NaN: TEXT_FIELD } })).toThrow(
      refusal({ kind: 'field', name: 'NaN' }),
    );
  });

  it('refuses a value-object field name that is not an identifier', () => {
    expect(
      printingWidget({
        domain: { valueObjects: { Address: { fields: { 'street line': TEXT_FIELD } } } },
      }),
    ).toThrow(refusal({ kind: 'field', name: 'street line' }));
  });

  it('refuses an enum name and an enum member name that are not identifiers', () => {
    const enumOf = (name: string, member: string) =>
      printingWidget({
        domain: {
          enum: { [name]: { codecId: 'pg/text@1', members: [{ name: member, value: 'a' }] } },
        },
        entries: { valueSet: { [name]: { kind: 'valueSet', values: ['a'] } } },
      });
    expect(enumOf('Order Status', 'Open')).toThrow(refusal({ kind: 'enum', name: 'Order Status' }));
    expect(enumOf('OrderStatus', 'is open')).toThrow(
      refusal({ kind: 'enum member', name: 'is open' }),
    );
  });

  it('refuses a named type name that is not an identifier', () => {
    expect(
      printingWidget({
        storageTypes: {
          'short text': {
            kind: 'codec-instance',
            codecId: 'pg/text@1',
            nativeType: 'text',
            typeParams: {},
          },
        },
      }),
    ).toThrow(refusal({ kind: 'named type', name: 'short text' }));
  });

  it('refuses an index option key that is not an identifier', () => {
    expect(
      printingWidget({
        table: {
          indexes: [
            {
              name: 'widget_id_idx',
              unique: false,
              columns: ['id'],
              type: 'btree',
              options: { 'fill factor': '70' },
            },
          ],
        },
      }),
    ).toThrow(refusal({ kind: 'index option', name: 'fill factor' }));
  });
});

describe('index options', () => {
  it('refuses options on an index with no type', () => {
    expect(
      printingWidget({
        table: {
          indexes: [
            {
              name: 'widget_id_idx',
              unique: false,
              columns: ['id'],
              options: { fillfactor: '70' },
            },
          ],
        },
      }),
    ).toThrow(refusal({ namespaceId: 'public', table: 'Widget', index: 'widget_id_idx' }));
  });
});

describe('enums', () => {
  it('refuses an enum and a native enum that derive the same value set', () => {
    expect(
      printingWidget({
        domain: {
          enum: { Status: { codecId: 'pg/text@1', members: [{ name: 'A', value: 'a' }] } },
        },
        entries: {
          native_enum: { status: { kind: 'postgres-enum', typeName: 'status', members: ['a'] } },
          valueSet: { Status: { kind: 'valueSet', values: ['a'] } },
        },
      }),
    ).toThrow(refusal({ namespaceId: 'public', name: 'Status' }));
  });
});

describe('row-level security entries the PSL source would file differently', () => {
  const unboundRoles = (roles: Record<string, unknown>) => ({
    __unbound__: { id: '__unbound__', entries: { table: {}, role: roles } },
  });

  it('refuses a row-level security entry not keyed by its table name', () => {
    expect(
      printingWidget({
        entries: {
          rls: { widget_rls: { kind: 'rls', namespaceId: 'public', tableName: 'Widget' } },
        },
      }),
    ).toThrow(refusal({ namespaceId: 'public', kind: 'rls', name: 'widget_rls' }));
  });

  it('refuses a row-level security entry that records another namespace', () => {
    expect(
      printingWidget({
        entries: { rls: { Widget: { kind: 'rls', namespaceId: 'auth', tableName: 'Widget' } } },
      }),
    ).toThrow(refusal({ namespaceId: 'public', kind: 'rls', name: 'Widget' }));
  });

  it('refuses a role not keyed by its name', () => {
    expect(
      printingWidget({
        storageNamespaces: unboundRoles({
          app: { kind: 'role', name: 'app_user', namespaceId: '__unbound__', control: 'external' },
        }),
      }),
    ).toThrow(refusal({ namespaceId: '__unbound__', kind: 'role', name: 'app' }));
  });

  it('refuses a policy that records another namespace', () => {
    expect(
      printingWidget({
        entries: {
          rls: { Widget: { kind: 'rls', namespaceId: 'public', tableName: 'Widget' } },
          policy: {
            widget_read: {
              kind: 'policy',
              name: 'widget_read',
              tableName: 'Widget',
              namespaceId: 'auth',
              operation: 'select',
              roles: ['app_user'],
              using: 'true',
              permissive: true,
            },
          },
        },
        storageNamespaces: unboundRoles({
          app_user: {
            kind: 'role',
            name: 'app_user',
            namespaceId: '__unbound__',
            control: 'external',
          },
        }),
      }),
    ).toThrow(refusal({ namespaceId: 'public', kind: 'policy', name: 'widget_read' }));
  });
});

describe('storage a model names but the contract does not declare', () => {
  function withWidget(patch: (widget: Record<string, unknown>) => Record<string, unknown>) {
    const contract = deserialize(
      widgetContract({ columns: { name: TEXT_COLUMN }, fields: { name: TEXT_FIELD } }),
    );
    const publicDomain = contract.domain.namespaces['public'];
    const widget = blindCast<Record<string, unknown>, 'the test widget model'>(
      publicDomain?.models['Widget'],
    );
    return blindCast<Contract<SqlStorage>, 'a contract the validator would reject'>({
      ...contract,
      domain: {
        namespaces: {
          ...contract.domain.namespaces,
          public: { ...publicDomain, models: { Widget: patch(widget) } },
        },
      },
    });
  }

  it('refuses a field stored in no column', () => {
    expect(
      printing(
        withWidget((widget) => ({
          ...widget,
          fields: { ...blindCast<object, 'fields'>(widget['fields']), extra: INT_FIELD },
        })),
      ),
    ).toThrow(refusal({ namespaceId: 'public', modelName: 'Widget', field: 'extra' }));
  });

  it('refuses a field stored in a column the table does not declare', () => {
    expect(
      printing(
        withWidget((widget) => ({
          ...widget,
          storage: {
            table: 'Widget',
            namespaceId: 'public',
            fields: { id: { column: 'id' }, name: { column: 'missing' } },
          },
        })),
      ),
    ).toThrow(refusal({ namespaceId: 'public', modelName: 'Widget', field: 'name' }));
  });

  it('reports a relation to a model the contract does not declare', () => {
    expect(
      printing(
        withWidget((widget) => ({
          ...widget,
          relations: {
            owner: {
              to: { namespace: PUBLIC, model: 'Ghost' },
              cardinality: '1:N',
              on: { localFields: ['id'], targetFields: ['widgetId'] },
            },
          },
        })),
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.MODEL_UNKNOWN',
        meta: { model: 'Widget', field: 'owner', target: 'public.Ghost' },
      }),
    );
  });

  it('reports a variant whose base does not list it', () => {
    expect(
      printing(
        withWidget((widget) => ({
          ...widget,
          base: { namespace: asNamespaceId('public'), model: 'Ghost' },
        })),
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.MODEL_UNKNOWN',
        meta: { namespaceId: 'public', modelName: 'Widget' },
      }),
    );
  });

  it('reports a model stored in a table the storage does not declare', () => {
    expect(
      printing(withRawEntries(deserialize(widgetContract()), 'public', { table: {} })),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.MODEL_UNKNOWN',
        meta: { namespaceId: 'public', modelName: 'Widget', table: 'Widget' },
      }),
    );
  });
});
