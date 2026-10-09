import { describe, expect, it } from 'vitest';
import { INT_FIELD, printingWidget, refusal, TEXT_COLUMN, TEXT_FIELD } from './refusal-support';

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

  it('refuses an enum member named __proto__, a name the PSL source loses when it reads it', () => {
    expect(
      printingWidget({
        domain: {
          enum: {
            Slot: { codecId: 'pg/text@1', members: [{ name: '__proto__', value: 'a' }] },
          },
        },
        entries: { valueSet: { Slot: { kind: 'valueSet', values: ['a'] } } },
      }),
    ).toThrow(refusal({ kind: 'enum member', name: '__proto__' }));
  });

  it('refuses a named type name that is not an identifier', () => {
    expect(
      printingWidget({
        storageTypes: {
          'short text': {
            kind: 'codec-instance',
            codecId: 'pg/text@1',
            dataType: 'pg/text',
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

describe('fields and the columns they are stored in', () => {
  it('never sees a field stored in no column: the contract is refused when it is read', () => {
    expect(() =>
      printingWidget({ fields: { extra: INT_FIELD }, storageFields: { id: { column: 'id' } } }),
    ).toThrow(
      'Model "public:Widget" field "extra" has no entry in storage.fields, so no column holds it',
    );
  });

  it('refuses a column stored under a field name the model does not declare', () => {
    expect(
      printingWidget({
        columns: { name: TEXT_COLUMN },
        storageFields: { id: { column: 'id' }, name: { column: 'name' } },
      }),
    ).toThrow(refusal({ namespaceId: 'public', modelName: 'Widget', field: 'name' }));
  });
});
