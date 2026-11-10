import { asNamespaceId } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import {
  deserializeEdited,
  INT_COLUMN,
  INT_FIELD,
  PUBLIC,
  printing,
  printingWidget,
  refusal,
  TEXT_COLUMN,
  TEXT_FIELD,
  widgetContract,
} from './refusal-support';

/** A second namespace holding one model `Archived`, stored in table `Archived`. */
function printingWithNamespace(namespaceId: string) {
  return printingWidget({
    domainNamespaces: {
      [namespaceId]: {
        models: {
          Archived: {
            storage: { table: 'Archived', namespaceId, fields: { id: { column: 'id' } } },
            fields: { id: INT_FIELD },
            relations: {},
          },
        },
      },
    },
    storageNamespaces: {
      [namespaceId]: {
        id: namespaceId,
        entries: {
          table: {
            Archived: {
              columns: { id: INT_COLUMN },
              uniques: [],
              indexes: [],
              foreignKeys: [],
              primaryKey: { columns: ['id'] },
            },
          },
        },
      },
    },
    contract: {
      roots: {
        Widget: { namespace: PUBLIC, model: 'Widget' },
        Archived: { namespace: asNamespaceId(namespaceId), model: 'Archived' },
      },
    },
  });
}

describe('namespace names', () => {
  it('prints a namespace whose name is a PSL identifier', () => {
    expect(printingWithNamespace('archive')).not.toThrow();
  });

  it.each(['2024archive', 'sales data'])(
    'refuses the namespace "%s", which is not a PSL identifier',
    (namespaceId) => {
      expect(printingWithNamespace(namespaceId)).toThrow(
        refusal({ kind: 'namespace', name: namespaceId }),
      );
    },
  );

  it('refuses a namespace named unbound, which PSL reads as the late-binding namespace', () => {
    expect(printingWithNamespace('unbound')).toThrow(refusal({ namespaceId: 'unbound' }));
  });
});

describe('the name __proto__ inside @map and @@map', () => {
  const renamed = (placeholder: string) => (json: string) =>
    json.replaceAll(placeholder, '__proto__');

  it('refuses a column named __proto__', () => {
    const contract = deserializeEdited(
      widgetContract({
        columns: { placeholder_column: TEXT_COLUMN },
        fields: { label: TEXT_FIELD },
        storageFields: { id: { column: 'id' }, label: { column: 'placeholder_column' } },
      }),
      renamed('placeholder_column'),
    );
    expect(printing(contract)).toThrow(refusal({ kind: 'column', name: '__proto__' }));
  });

  it('refuses a table named __proto__', () => {
    const contract = deserializeEdited(
      widgetContract({
        models: {
          Gadget: {
            storage: {
              table: 'placeholder_table',
              namespaceId: 'public',
              fields: { id: { column: 'id' } },
            },
            fields: { id: INT_FIELD },
            relations: {},
          },
        },
        tables: {
          placeholder_table: {
            columns: { id: INT_COLUMN },
            uniques: [],
            indexes: [],
            foreignKeys: [],
            primaryKey: { columns: ['id'] },
          },
        },
        contract: {
          roots: {
            Widget: { namespace: PUBLIC, model: 'Widget' },
            placeholder_table: { namespace: PUBLIC, model: 'Gadget' },
          },
        },
      }),
      renamed('placeholder_table'),
    );
    expect(printing(contract)).toThrow(refusal({ kind: 'table', name: '__proto__' }));
  });
});
