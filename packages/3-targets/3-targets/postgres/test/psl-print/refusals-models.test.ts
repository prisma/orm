import { asNamespaceId } from '@internal/contract/types';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import {
  deserialize,
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

describe('models and relations', () => {
  it('refuses a model with an owner', () => {
    expect(
      printingWidget({
        model: { owner: 'Other' },
        models: {
          Other: {
            storage: { table: 'Other', namespaceId: 'public', fields: { id: { column: 'id' } } },
            fields: { id: INT_FIELD },
            relations: {},
          },
        },
        tables: {
          Other: {
            columns: { id: INT_COLUMN },
            uniques: [],
            indexes: [],
            foreignKeys: [],
            primaryKey: { columns: ['id'] },
          },
        },
        contract: { roots: { Other: { namespace: PUBLIC, model: 'Other' } } },
      }),
    ).toThrow(refusal({ namespaceId: 'public', modelName: 'Widget', owner: 'Other' }));
  });

  it('refuses a model whose domain namespace is not the namespace of its table', () => {
    const contract = deserialize(widgetContract());
    const { public: publicNamespace, ...others } = contract.domain.namespaces;
    const moved = {
      ...contract,
      domain: { namespaces: { ...others, app: publicNamespace } },
    };
    expect(
      printing(blindCast<typeof contract, 'a contract the validator would reject'>(moved)),
    ).toThrow(refusal({ namespaceId: 'app', modelName: 'Widget', tableNamespaceId: 'public' }));
  });

  it('refuses a model name that is not a PSL identifier', () => {
    expect(
      printing(
        deserialize(
          widgetContract({
            models: {
              'Line Item': {
                storage: {
                  table: 'line_item',
                  namespaceId: 'public',
                  fields: { id: { column: 'id' } },
                },
                fields: { id: INT_FIELD },
                relations: {},
              },
            },
            tables: {
              line_item: {
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
                line_item: { namespace: PUBLIC, model: 'Line Item' },
              },
            },
          }),
        ),
      ),
    ).toThrow(refusal({ kind: 'model', name: 'Line Item' }));
  });

  it('refuses a field name that is not a PSL identifier', () => {
    expect(
      printingWidget({
        columns: { display_name: TEXT_COLUMN },
        fields: { 'display name': TEXT_FIELD },
        storageFields: { id: { column: 'id' }, 'display name': { column: 'display_name' } },
      }),
    ).toThrow(refusal({ kind: 'field', name: 'display name' }));
  });

  function postAndWidget(parts: {
    readonly foreignKeys?: readonly unknown[];
    readonly relations?: Record<string, unknown>;
  }) {
    return printingWidget({
      columns: { postId: INT_COLUMN },
      fields: { postId: INT_FIELD },
      table: { foreignKeys: parts.foreignKeys ?? [] },
      model: { relations: parts.relations ?? {} },
      models: {
        Post: {
          storage: { table: 'Post', namespaceId: 'public', fields: { id: { column: 'id' } } },
          fields: { id: INT_FIELD },
          relations: {},
        },
      },
      tables: {
        Post: {
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
          Post: { namespace: PUBLIC, model: 'Post' },
        },
      },
    });
  }

  it('refuses a foreign key no relation travels', () => {
    expect(
      postAndWidget({
        foreignKeys: [
          {
            source: { namespaceId: 'public', tableName: 'Widget', columns: ['postId'] },
            target: { namespaceId: 'public', tableName: 'Post', columns: ['id'] },
          },
        ],
      }),
    ).toThrow(refusal({ namespaceId: 'public', table: 'Widget', columns: ['postId'] }));
  });

  it('refuses a to-one relation with no foreign key behind it', () => {
    expect(
      postAndWidget({
        relations: {
          post: {
            to: { namespace: PUBLIC, model: 'Post' },
            cardinality: 'N:1',
            nullable: false,
            on: { localFields: ['postId'], targetFields: ['id'] },
          },
        },
      }),
    ).toThrow(refusal({ model: 'Widget', field: 'post' }));
  });

  it('refuses a relation into another contract space, with or without a foreign key', () => {
    const relations = {
      user: {
        to: { namespace: asNamespaceId('auth'), model: 'AuthUser', space: 'supabase' },
        cardinality: 'N:1',
        nullable: false,
        on: { localFields: ['postId'], targetFields: ['id'] },
      },
    };
    const expected = refusal({ model: 'Widget', field: 'user', space: 'supabase' });
    expect(postAndWidget({ relations })).toThrow(expected);
    expect(
      postAndWidget({
        relations,
        foreignKeys: [
          {
            source: { namespaceId: 'public', tableName: 'Widget', columns: ['postId'] },
            target: {
              namespaceId: 'auth',
              tableName: 'users',
              columns: ['id'],
              spaceId: 'supabase',
            },
          },
        ],
      }),
    ).toThrow(expected);
  });

  it('refuses a many-to-many relation whose junction model has no relation back to it', () => {
    expect(
      printingWidget({
        model: {
          relations: {
            tags: {
              to: { namespace: PUBLIC, model: 'Tag' },
              cardinality: 'N:M',
              on: { localFields: ['id'], targetFields: ['id'] },
              through: {
                table: 'WidgetTag',
                namespaceId: 'public',
                parentColumns: ['widgetId'],
                childColumns: ['tagId'],
                targetColumns: ['id'],
              },
            },
          },
        },
        models: {
          Tag: {
            storage: { table: 'Tag', namespaceId: 'public', fields: { id: { column: 'id' } } },
            fields: { id: INT_FIELD },
            relations: {},
          },
          WidgetTag: {
            storage: {
              table: 'WidgetTag',
              namespaceId: 'public',
              fields: { widgetId: { column: 'widgetId' }, tagId: { column: 'tagId' } },
            },
            fields: { widgetId: INT_FIELD, tagId: INT_FIELD },
            relations: {},
          },
        },
        tables: {
          Tag: {
            columns: { id: INT_COLUMN },
            uniques: [],
            indexes: [],
            foreignKeys: [],
            primaryKey: { columns: ['id'] },
          },
          WidgetTag: {
            columns: { widgetId: INT_COLUMN, tagId: INT_COLUMN },
            uniques: [],
            indexes: [],
            foreignKeys: [],
            primaryKey: { columns: ['widgetId', 'tagId'] },
          },
        },
        contract: {
          roots: {
            Widget: { namespace: PUBLIC, model: 'Widget' },
            Tag: { namespace: PUBLIC, model: 'Tag' },
            WidgetTag: { namespace: PUBLIC, model: 'WidgetTag' },
          },
        },
      }),
    ).toThrow(refusal({ model: 'Widget', field: 'tags' }));
  });
});

describe('one model name in two namespaces', () => {
  it('refuses it, naming the model and both namespaces', () => {
    const table = {
      columns: { id: INT_COLUMN },
      uniques: [],
      indexes: [],
      foreignKeys: [],
      primaryKey: { columns: ['id'] },
    };
    expect(
      printing(
        deserialize(
          widgetContract({
            domainNamespaces: {
              auth: {
                models: {
                  Widget: {
                    storage: {
                      table: 'Widget',
                      namespaceId: 'auth',
                      fields: { id: { column: 'id' } },
                    },
                    fields: { id: INT_FIELD },
                    relations: {},
                  },
                },
              },
            },
            storageNamespaces: { auth: { id: 'auth', entries: { table: { Widget: table } } } },
            contract: {
              roots: {
                'public.Widget': { namespace: PUBLIC, model: 'Widget' },
                'auth.Widget': { namespace: asNamespaceId('auth'), model: 'Widget' },
              },
            },
          }),
        ),
      ),
    ).toThrow(refusal({ modelName: 'Widget', namespaces: ['public', 'auth'] }));
  });
});

describe('variants', () => {
  const TYPE_COLUMN = TEXT_COLUMN;

  function taskWithVariant(parts: {
    readonly variantTable: string;
    readonly variantColumns: Record<string, unknown>;
    readonly variantTableExtras?: Record<string, unknown>;
    readonly taskColumns?: Record<string, unknown>;
  }) {
    const singleTable = parts.variantTable === 'Task';
    const variantTable = {
      columns: parts.variantColumns,
      uniques: [],
      indexes: [],
      foreignKeys: [],
      ...parts.variantTableExtras,
    };
    return printing(
      deserialize({
        roots: { Task: { namespace: PUBLIC, model: 'Task' } },
        namespaces: {
          public: {
            models: {
              Task: {
                storage: {
                  table: 'Task',
                  namespaceId: 'public',
                  fields: { id: { column: 'id' }, type: { column: 'type' } },
                },
                fields: { id: INT_FIELD, type: TEXT_FIELD },
                relations: {},
                discriminator: { field: 'type' },
                variants: { Epic: { value: 'epic' } },
              },
              Epic: {
                storage: {
                  table: parts.variantTable,
                  namespaceId: 'public',
                  fields: { scope: { column: 'scope' } },
                },
                fields: { scope: TEXT_FIELD },
                relations: {},
                base: { namespace: PUBLIC, model: 'Task' },
              },
            },
          },
        },
        storage: {
          namespaces: {
            public: {
              id: 'public',
              entries: {
                table: {
                  Task: {
                    columns: {
                      id: INT_COLUMN,
                      type: TYPE_COLUMN,
                      ...parts.taskColumns,
                      ...(singleTable ? parts.variantColumns : {}),
                    },
                    uniques: [],
                    indexes: [],
                    foreignKeys: [],
                    primaryKey: { columns: ['id'] },
                  },
                  ...(singleTable ? {} : { [parts.variantTable]: variantTable }),
                },
              },
            },
          },
        },
      }),
    );
  }

  const LINK = {
    source: { namespaceId: 'public', tableName: 'epics', columns: ['id'] },
    target: { namespaceId: 'public', tableName: 'Task', columns: ['id'] },
    onDelete: 'cascade',
  };

  it('prints a multi-table variant whose link to its base is the one the PSL source derives', () => {
    expect(
      taskWithVariant({
        variantTable: 'epics',
        variantColumns: { id: INT_COLUMN, scope: TEXT_COLUMN },
        variantTableExtras: { primaryKey: { columns: ['id'] }, foreignKeys: [LINK] },
      }),
    ).not.toThrow();
  });

  it.each([
    [
      'a named primary key',
      { primaryKey: { columns: ['id'], name: 'epics_pk' }, foreignKeys: [LINK] },
    ],
    [
      'a link that does not cascade',
      { primaryKey: { columns: ['id'] }, foreignKeys: [{ ...LINK, onDelete: 'restrict' }] },
    ],
    ['no link', { primaryKey: { columns: ['id'] } }],
  ])('refuses a multi-table variant with %s', (_, variantTableExtras) => {
    expect(
      taskWithVariant({
        variantTable: 'epics',
        variantColumns: { id: INT_COLUMN, scope: TEXT_COLUMN },
        variantTableExtras,
      }),
    ).toThrow(refusal({ namespaceId: 'public', modelName: 'Epic' }));
  });

  it('refuses a multi-table variant whose link column is not the base primary key column', () => {
    expect(
      taskWithVariant({
        variantTable: 'epics',
        variantColumns: {
          id: { ...INT_COLUMN, default: { kind: 'literal', value: 1 } },
          scope: TEXT_COLUMN,
        },
        variantTableExtras: { primaryKey: { columns: ['id'] }, foreignKeys: [LINK] },
      }),
    ).toThrow(refusal({ namespaceId: 'public', modelName: 'Epic' }));
  });

  it('refuses a single-table variant column that is not nullable', () => {
    expect(
      taskWithVariant({ variantTable: 'Task', variantColumns: { scope: TEXT_COLUMN } }),
    ).toThrow(refusal({ coordinate: '"public"."Task"."scope"' }));
  });

  it('prints a single-table variant whose columns are nullable', () => {
    expect(
      taskWithVariant({
        variantTable: 'Task',
        variantColumns: { scope: { ...TEXT_COLUMN, nullable: true } },
      }),
    ).not.toThrow();
  });
});
