import type {
  ApplicationDomainNamespace,
  Contract,
  ContractField,
  ContractRelation,
  ExecutionMutationDefault,
} from '@internal/contract/types';
import { asNamespaceId } from '@internal/contract/types';
import type {
  PslAttribute,
  PslExtensionBlock,
  PslField,
  PslModel,
} from '@internal/framework-components/psl-ast';
import { namespacePslExtensionBlocks } from '@internal/framework-components/psl-ast';
import type { SqlStorage } from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';
import { createSqlContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { PostgresContractSerializer } from '../../src/core/postgres-contract-serializer';
import { printPostgresPslContract } from '../../src/core/psl-print/print-psl-contract';

const INT_COLUMN = { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } as const;
const TEXT_COLUMN = { nativeType: 'text', codecId: 'pg/text@1', nullable: false } as const;

function attributeText(attribute: PslAttribute): string {
  const prefix = attribute.target === 'model' ? '@@' : '@';
  if (attribute.args.length === 0) return `${prefix}${attribute.name}`;
  const args = attribute.args
    .map((arg) => (arg.kind === 'positional' ? arg.value : `${arg.name}: ${arg.value}`))
    .join(', ');
  return `${prefix}${attribute.name}(${args})`;
}

function fieldText(field: PslField): string {
  const type =
    field.typeConstructor === undefined
      ? field.typeName
      : `${field.typeConstructor.path.join('.')}(${field.typeConstructor.args
          .map((arg) => (arg.kind === 'positional' ? arg.value : `${arg.name}: ${arg.value}`))
          .join(', ')})`;
  const suffix = field.list ? '[]' : field.optional ? '?' : '';
  return [`${field.name} ${type}${suffix}`, ...field.attributes.map(attributeText)].join(' ');
}

interface ModelInput {
  readonly table: string;
  readonly fields: Record<string, { readonly column: string }>;
  readonly relations?: Record<string, ContractRelation>;
}

const INT_FIELD: ContractField = {
  nullable: false,
  type: { kind: 'scalar', codecId: 'pg/int4@1' },
};

function print(input: {
  readonly models: Record<string, ModelInput>;
  readonly tables: Record<string, unknown>;
  readonly execution?: {
    readonly mutations: { readonly defaults: readonly ExecutionMutationDefault[] };
  };
}): readonly PslModel[] {
  const domainNamespace: ApplicationDomainNamespace = {
    models: Object.fromEntries(
      Object.entries(input.models).map(([name, model]) => [
        name,
        {
          storage: { table: model.table, namespaceId: 'public', fields: model.fields },
          fields: Object.fromEntries(
            Object.keys(model.fields).map((fieldName) => [fieldName, INT_FIELD]),
          ),
          relations: model.relations ?? {},
        },
      ]),
    ),
  };
  const overrides = {
    namespaces: { public: domainNamespace },
    storage: { namespaces: { public: { id: 'public', entries: { table: input.tables } } } },
  };
  const json =
    input.execution === undefined
      ? createSqlContract(overrides)
      : createSqlContract({ ...overrides, execution: input.execution });
  const contract = new PostgresContractSerializer().deserializeContract(json);
  const ast = printPostgresPslContract(
    blindCast<Contract<SqlStorage>, 'the Postgres serializer yields a SQL contract'>(contract),
  );
  return ast.namespaces.flatMap((namespace) => namespace.models);
}

function table(input: {
  readonly columns: Record<string, unknown>;
  readonly primaryKey?: { readonly columns: readonly string[] };
  readonly uniques?: readonly unknown[];
  readonly indexes?: readonly unknown[];
  readonly foreignKeys?: readonly unknown[];
  readonly checks?: readonly unknown[];
}): unknown {
  return {
    columns: input.columns,
    uniques: input.uniques ?? [],
    indexes: input.indexes ?? [],
    foreignKeys: input.foreignKeys ?? [],
    ...(input.checks === undefined ? {} : { checks: input.checks }),
    ...(input.primaryKey === undefined ? {} : { primaryKey: input.primaryKey }),
  };
}

function oneModel(columns: Record<string, unknown>, fields: Record<string, { column: string }>) {
  return print({
    models: { Widget: { table: 'Widget', fields } },
    tables: { Widget: table({ columns, primaryKey: { columns: ['id'] } }) },
  })[0];
}

describe('names the PSL source cannot derive', () => {
  it('maps a model whose table is not the model name', () => {
    const [model] = print({
      models: { Widget: { table: 'widgets', fields: { id: { column: 'id' } } } },
      tables: { widgets: table({ columns: { id: INT_COLUMN }, primaryKey: { columns: ['id'] } }) },
    });
    expect(model?.attributes.map(attributeText)).toEqual(['@@map("widgets")']);
  });

  it('leaves a model whose table is the model name unmapped', () => {
    const [model] = print({
      models: { Widget: { table: 'Widget', fields: { id: { column: 'id' } } } },
      tables: { Widget: table({ columns: { id: INT_COLUMN }, primaryKey: { columns: ['id'] } }) },
    });
    expect(model?.attributes).toEqual([]);
  });

  it('maps a field whose column is not the field name', () => {
    const model = oneModel(
      { id: INT_COLUMN, first_name: TEXT_COLUMN },
      { id: { column: 'id' }, firstName: { column: 'first_name' } },
    );
    expect(model?.fields.map(fieldText)).toEqual([
      'id Int @id',
      'firstName String @map("first_name")',
    ]);
  });
});

describe('keys and indexes', () => {
  it('prints a unique index as an index, never as @unique', () => {
    const model = oneModel(
      { id: INT_COLUMN, email: TEXT_COLUMN },
      { id: { column: 'id' }, email: { column: 'email' } },
    );
    expect(model?.fields.map(fieldText)).toEqual(['id Int @id', 'email String']);

    const [withIndex] = print({
      models: {
        Widget: { table: 'Widget', fields: { id: { column: 'id' }, email: { column: 'email' } } },
      },
      tables: {
        Widget: table({
          columns: { id: INT_COLUMN, email: TEXT_COLUMN },
          primaryKey: { columns: ['id'] },
          indexes: [{ name: 'Widget_email_key', unique: true, columns: ['email'] }],
        }),
      },
    });
    expect(withIndex?.attributes.map(attributeText)).toEqual([
      '@@index([email], map: "Widget_email_key", unique: true)',
    ]);
    expect(withIndex?.fields.map(fieldText)).toEqual(['id Int @id', 'email String']);
  });

  it('prints a unique constraint as @@unique, under the field names its columns carry', () => {
    const [model] = print({
      models: {
        Widget: { table: 'Widget', fields: { id: { column: 'id' }, email: { column: 'e_mail' } } },
      },
      tables: {
        Widget: table({
          columns: { id: INT_COLUMN, e_mail: TEXT_COLUMN },
          primaryKey: { columns: ['id'] },
          uniques: [{ columns: ['e_mail'], name: 'widget_email_key' }],
        }),
      },
    });
    expect(model?.attributes.map(attributeText)).toEqual([
      '@@unique([email], map: "widget_email_key")',
    ]);
  });

  it('prints every check constraint the table carries', () => {
    const [model] = print({
      models: { Widget: { table: 'Widget', fields: { id: { column: 'id' } } } },
      tables: {
        Widget: table({
          columns: { id: INT_COLUMN },
          primaryKey: { columns: ['id'] },
          checks: [
            { name: 'widget_id_positive', expression: 'id > 0' },
            { name: 'widget_id_small', expression: 'id < 100' },
          ],
        }),
      },
    });
    expect(model?.attributes.map(attributeText)).toEqual([
      '@@check(expression: "id > 0", map: "widget_id_positive")',
      '@@check(expression: "id < 100", map: "widget_id_small")',
    ]);
  });

  it('prints a multi-column primary key as a model attribute', () => {
    const [model] = print({
      models: {
        Widget: { table: 'Widget', fields: { a: { column: 'a' }, b: { column: 'b_col' } } },
      },
      tables: {
        Widget: table({
          columns: { a: INT_COLUMN, b_col: TEXT_COLUMN },
          primaryKey: { columns: ['a', 'b_col'] },
        }),
      },
    });
    expect(model?.attributes.map(attributeText)).toEqual(['@@id([a, b])']);
  });
});

describe('column defaults', () => {
  function defaultOf(column: Record<string, unknown>): string | undefined {
    const model = oneModel(
      { id: INT_COLUMN, value: column },
      { id: { column: 'id' }, value: { column: 'value' } },
    );
    return model?.fields[1]?.attributes.map(attributeText)[0];
  }

  it('prints a string literal as a PSL string', () => {
    expect(defaultOf({ ...TEXT_COLUMN, default: { kind: 'literal', value: 'hello' } })).toBe(
      '@default("hello")',
    );
  });

  it('prints a decimal default as the text that keeps every digit', () => {
    expect(
      defaultOf({
        nativeType: 'numeric',
        codecId: 'pg/numeric@1',
        nullable: false,
        default: { kind: 'literal', value: '1.50' },
      }),
    ).toBe('@default(1.50)');
  });

  it('prints an integer default unquoted', () => {
    expect(defaultOf({ ...INT_COLUMN, default: { kind: 'literal', value: 42 } })).toBe(
      '@default(42)',
    );
  });

  it('prints now() and autoincrement() by name', () => {
    expect(
      defaultOf({ ...INT_COLUMN, default: { kind: 'function', expression: 'autoincrement()' } }),
    ).toBe('@default(autoincrement())');
    expect(
      defaultOf({
        nativeType: 'timestamp',
        codecId: 'pg/timestamp-temporal@1',
        nullable: false,
        default: { kind: 'function', expression: 'now()' },
      }),
    ).toBe('@default(now())');
  });

  it('prints every other function default as dbgenerated', () => {
    expect(
      defaultOf({
        nativeType: 'uuid',
        codecId: 'pg/uuid@1',
        nullable: false,
        default: { kind: 'function', expression: 'gen_random_uuid()' },
      }),
    ).toBe('@default(dbgenerated("gen_random_uuid()"))');
  });

  it('refuses a literal default that cannot be written in PSL for the column type', () => {
    let thrown: unknown;
    try {
      defaultOf({
        nativeType: 'inet',
        codecId: 'pg/inet@1',
        nullable: false,
        default: { kind: 'literal', value: { a: 1 } },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      code: 'CONTRACT.PRINT_UNSUPPORTED',
      message: expect.stringContaining('"public"."Widget"."value"'),
    });
  });
});

describe('list columns', () => {
  it('prints the element-not-null check a list column carries', () => {
    const model = oneModel(
      { id: INT_COLUMN, tags: { ...TEXT_COLUMN, many: true, noCheck: ['elementNotNull'] } },
      { id: { column: 'id' }, tags: { column: 'tags' } },
    );
    expect(model?.fields.map(fieldText)).toEqual([
      'id Int @id',
      'tags String[] @noCheck(elementNotNull)',
    ]);
  });
});

describe('generated values', () => {
  function withGenerator(
    column: Record<string, unknown>,
    phases: Record<string, unknown>,
  ): string | undefined {
    const [model] = print({
      models: {
        Widget: { table: 'Widget', fields: { id: { column: 'id' }, value: { column: 'value' } } },
      },
      tables: {
        Widget: table({
          columns: { id: INT_COLUMN, value: column },
          primaryKey: { columns: ['id'] },
        }),
      },
      execution: {
        mutations: {
          defaults: [{ ref: { namespace: 'public', table: 'Widget', column: 'value' }, ...phases }],
        },
      },
    });
    const field = model?.fields[1];
    return field === undefined ? undefined : fieldText(field);
  }

  it('prints an id generator as the default function that produces it', () => {
    expect(withGenerator(TEXT_COLUMN, { onCreate: { kind: 'generator', id: 'uuidv4' } })).toBe(
      'value String @default(uuid())',
    );
    expect(withGenerator(TEXT_COLUMN, { onCreate: { kind: 'generator', id: 'uuidv7' } })).toBe(
      'value String @default(uuid(7))',
    );
    expect(withGenerator(TEXT_COLUMN, { onCreate: { kind: 'generator', id: 'cuid2' } })).toBe(
      'value String @default(cuid(2))',
    );
    expect(withGenerator(TEXT_COLUMN, { onCreate: { kind: 'generator', id: 'ulid' } })).toBe(
      'value String @default(ulid())',
    );
    expect(
      withGenerator(TEXT_COLUMN, {
        onCreate: { kind: 'generator', id: 'nanoid', params: { size: 10 } },
      }),
    ).toBe('value String @default(nanoid(10))');
  });

  it('prints a wall-clock-now pair as the temporal preset of the column codec', () => {
    expect(
      withGenerator(
        {
          nativeType: 'timestamp',
          codecId: 'pg/timestamp-temporal@1',
          nullable: false,
          typeParams: { precision: 3 },
        },
        {
          onCreate: { kind: 'generator', id: 'plainDateTimeNow' },
          onUpdate: { kind: 'generator', id: 'plainDateTimeNow' },
        },
      ),
    ).toBe('value temporal.timestamp(3, onCreate: now, onUpdate: now)');
  });

  it('refuses a column that pairs the wall-clock-now generator with a different one', () => {
    const timestamp = {
      nativeType: 'timestamp',
      codecId: 'pg/timestamp-temporal@1',
      nullable: false,
    };
    const refusal = (phases: Record<string, unknown>): unknown => {
      try {
        withGenerator(timestamp, phases);
      } catch (error) {
        return error;
      }
      return undefined;
    };

    expect(
      refusal({
        onCreate: { kind: 'generator', id: 'plainDateTimeNow' },
        onUpdate: { kind: 'generator', id: 'uuidv4' },
      }),
    ).toMatchObject({
      code: 'CONTRACT.PRINT_UNSUPPORTED',
      message: expect.stringContaining('"public"."Widget"."value"'),
    });
    expect(
      refusal({
        onCreate: { kind: 'generator', id: 'uuidv4' },
        onUpdate: { kind: 'generator', id: 'plainDateTimeNow' },
      }),
    ).toMatchObject({
      code: 'CONTRACT.PRINT_UNSUPPORTED',
      message: expect.stringContaining('"public"."Widget"."value"'),
    });
  });
});

describe('relations', () => {
  function postAndUser(foreignKey: Record<string, unknown>) {
    return print({
      models: {
        User: {
          table: 'user',
          fields: { id: { column: 'id' } },
          relations: {
            posts: {
              to: { namespace: asNamespaceId('public'), model: 'Post' },
              cardinality: '1:N',
              on: { localFields: ['id'], targetFields: ['authorId'] },
            },
          },
        },
        Post: {
          table: 'post',
          fields: { id: { column: 'id' }, authorId: { column: 'authorId' } },
          relations: {
            author: {
              to: { namespace: asNamespaceId('public'), model: 'User' },
              cardinality: 'N:1',
              nullable: false,
              on: { localFields: ['authorId'], targetFields: ['id'] },
            },
          },
        },
      },
      tables: {
        user: table({ columns: { id: INT_COLUMN }, primaryKey: { columns: ['id'] } }),
        post: table({
          columns: { id: INT_COLUMN, authorId: INT_COLUMN },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            {
              source: { namespaceId: 'public', tableName: 'post', columns: ['authorId'] },
              target: { namespaceId: 'public', tableName: 'user', columns: ['id'] },
              ...foreignKey,
            },
          ],
        }),
      },
    });
  }

  it('writes both referential actions and declines a backing index', () => {
    const models = postAndUser({ onDelete: 'cascade', onUpdate: 'restrict' });
    expect(models[1]?.fields.map(fieldText)[2]).toBe(
      'author User @relation(fields: [authorId], references: [id], onDelete: Cascade, onUpdate: Restrict, index: false)',
    );
  });

  it('writes the foreign key name when the key carries one, and no action the key does not', () => {
    const models = postAndUser({ name: 'post_author_fkey' });
    expect(models[1]?.fields.map(fieldText)[2]).toBe(
      'author User @relation(fields: [authorId], references: [id], map: "post_author_fkey", index: false)',
    );
  });

  it('prints the other side as a list with no arguments', () => {
    const models = postAndUser({ onDelete: 'cascade', onUpdate: 'cascade' });
    expect(models[0]?.fields.map(fieldText)[1]).toBe('posts Post[]');
  });

  it('takes its actions from the foreign key that references the columns the relation names', () => {
    const models = print({
      models: {
        User: {
          table: 'user',
          fields: { id: { column: 'id' }, altId: { column: 'altId' } },
          relations: {},
        },
        Post: {
          table: 'post',
          fields: { id: { column: 'id' }, authorId: { column: 'authorId' } },
          relations: {
            author: {
              to: { namespace: asNamespaceId('public'), model: 'User' },
              cardinality: 'N:1',
              nullable: false,
              on: { localFields: ['authorId'], targetFields: ['altId'] },
            },
            authorById: {
              to: { namespace: asNamespaceId('public'), model: 'User' },
              cardinality: 'N:1',
              nullable: false,
              on: { localFields: ['authorId'], targetFields: ['id'] },
            },
          },
        },
      },
      tables: {
        user: table({
          columns: { id: INT_COLUMN, altId: INT_COLUMN },
          primaryKey: { columns: ['id'] },
          uniques: [{ columns: ['altId'], name: 'user_altId_key' }],
        }),
        post: table({
          columns: { id: INT_COLUMN, authorId: INT_COLUMN },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            {
              source: { namespaceId: 'public', tableName: 'post', columns: ['authorId'] },
              target: { namespaceId: 'public', tableName: 'user', columns: ['id'] },
              name: 'post_author_id_fkey',
              onDelete: 'cascade',
              onUpdate: 'cascade',
            },
            {
              source: { namespaceId: 'public', tableName: 'post', columns: ['authorId'] },
              target: { namespaceId: 'public', tableName: 'user', columns: ['altId'] },
              name: 'post_author_altId_fkey',
              onDelete: 'restrict',
              onUpdate: 'restrict',
            },
          ],
        }),
      },
    });

    expect(models[1]?.fields.map(fieldText).slice(2)).toEqual([
      'author User @relation(name: "Post_author", fields: [authorId], references: [altId], onDelete: Restrict, onUpdate: Restrict, map: "post_author_altId_fkey", index: false)',
      'authorById User @relation(name: "Post_authorById", fields: [authorId], references: [id], onDelete: Cascade, onUpdate: Cascade, map: "post_author_id_fkey", index: false)',
    ]);
  });
});

describe('native enum blocks', () => {
  function blockText(block: PslExtensionBlock): string {
    const members = Object.entries(block.parameters).map(([name, value]) =>
      value.kind === 'value' ? `${name} = ${value.raw}` : name,
    );
    const attributes = block.blockAttributes.map(
      (attribute) => `@@${attribute.name}(${attribute.args.map((arg) => arg.value).join(', ')})`,
    );
    return [`${block.keyword} ${block.name}`, ...members, ...attributes].join(' ');
  }

  function enumBlocks(input: {
    readonly nativeEnums: Record<string, { readonly typeName: string; readonly members: string[] }>;
    readonly valueSets: Record<string, { readonly values: string[] }>;
    readonly columns?: Record<string, unknown>;
    readonly fields?: Record<string, { readonly column: string }>;
  }): readonly string[] {
    const fields = input.fields ?? { id: { column: 'id' } };
    const domainNamespace: ApplicationDomainNamespace = {
      models: {
        Widget: {
          storage: { table: 'Widget', namespaceId: 'public', fields },
          fields: Object.fromEntries(Object.keys(fields).map((name) => [name, INT_FIELD])),
          relations: {},
        },
      },
    };
    const json = createSqlContract({
      namespaces: { public: domainNamespace },
      storage: {
        namespaces: {
          public: {
            id: 'public',
            entries: {
              table: {
                Widget: table({
                  columns: input.columns ?? { id: INT_COLUMN },
                  primaryKey: { columns: ['id'] },
                }),
              },
              native_enum: Object.fromEntries(
                Object.entries(input.nativeEnums).map(([name, value]) => [
                  name,
                  { kind: 'postgres-enum', ...value },
                ]),
              ),
              valueSet: Object.fromEntries(
                Object.entries(input.valueSets).map(([name, value]) => [
                  name,
                  { kind: 'valueSet', ...value },
                ]),
              ),
            },
          },
        },
      },
    });
    const contract = new PostgresContractSerializer().deserializeContract(json);
    const ast = printPostgresPslContract(
      blindCast<Contract<SqlStorage>, 'the Postgres serializer yields a SQL contract'>(contract),
    );
    return ast.namespaces
      .flatMap((namespace) => namespacePslExtensionBlocks(namespace))
      .map(blockText);
  }

  it('names a mapped enum no column refers to after its value set, not its type', () => {
    expect(
      enumBlocks({
        nativeEnums: { user_role: { typeName: 'user_role', members: ['user', 'ADMIN'] } },
        valueSets: { Role: { values: ['user', 'ADMIN'] } },
      }),
    ).toEqual(['native_enum Role user = "user" ADMIN = "ADMIN" @@map("user_role")']);
  });

  it('leaves an unmapped enum no column refers to named after its type', () => {
    expect(
      enumBlocks({
        nativeEnums: { Unused: { typeName: 'Unused', members: ['A', 'B'] } },
        valueSets: { Unused: { values: ['A', 'B'] } },
      }),
    ).toEqual(['native_enum Unused A = "A" B = "B"']);
  });

  it('names a mapped enum a column refers to after the value set the column names', () => {
    expect(
      enumBlocks({
        nativeEnums: { user_role: { typeName: 'user_role', members: ['user', 'ADMIN'] } },
        valueSets: { Role: { values: ['user', 'ADMIN'] } },
        columns: {
          id: INT_COLUMN,
          role: {
            nativeType: 'user_role',
            codecId: 'pg/enum@1',
            nullable: false,
            valueSet: {
              plane: 'storage',
              namespaceId: 'public',
              entityKind: 'valueSet',
              entityName: 'Role',
            },
          },
        },
        fields: { id: { column: 'id' }, role: { column: 'role' } },
      }),
    ).toEqual(['native_enum Role user = "user" ADMIN = "ADMIN" @@map("user_role")']);
  });

  it('derives a block name from the type name when two unreferenced enums share their members', () => {
    expect(
      enumBlocks({
        nativeEnums: {
          user_role: { typeName: 'user_role', members: ['A', 'B'] },
          other_role: { typeName: 'other_role', members: ['A', 'B'] },
        },
        valueSets: { Role: { values: ['A', 'B'] }, OtherRole: { values: ['A', 'B'] } },
      }),
    ).toEqual([
      'native_enum UserRole A = "A" B = "B" @@map("user_role")',
      'native_enum OtherRole A = "A" B = "B" @@map("other_role")',
    ]);
  });

  it('writes a type name PSL cannot read as an identifier as a mapped block name', () => {
    expect(
      enumBlocks({
        nativeEnums: { 'order status': { typeName: 'order status', members: ['A'] } },
        valueSets: {},
      }),
    ).toEqual(['native_enum OrderStatus A = "A" @@map("order status")']);
  });

  it('keeps a derived block name apart from a block name a value set already claimed', () => {
    expect(
      enumBlocks({
        nativeEnums: {
          'order status': { typeName: 'order status', members: ['A'] },
          order_status: { typeName: 'order_status', members: ['B'] },
        },
        valueSets: { OrderStatus: { values: ['B'] } },
      }),
    ).toEqual([
      'native_enum OrderStatus2 A = "A" @@map("order status")',
      'native_enum OrderStatus B = "B" @@map("order_status")',
    ]);
  });
});
