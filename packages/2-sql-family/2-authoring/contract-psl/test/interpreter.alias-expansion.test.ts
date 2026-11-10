import type { AuthoringContributions } from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import {
  documentScopedTypes,
  pgvectorAuthoringContributions,
  postgresNativeScalarTypeDescriptors,
  testEnumEntityContributions,
  testEnumPslBlockDescriptor,
  valueObjectsOf,
} from './fixtures';
import { sqlStorageFromSuccessfulSqlInterpretation } from './interpret-sql-contract-storage';
import {
  builtinControlMutationDefaults,
  interpretPostgresSchema,
} from './interpreter-defaults-support';
import { unboundTables } from './unbound-tables';

const authoringContributions = {
  entityTypes: testEnumEntityContributions,
  pslBlockDescriptors: { enum: testEnumPslBlockDescriptor },
  modelAttributes: {},
  valueObjectStorageType: 'Jsonb',
  type: {
    ...pgvectorAuthoringContributions.type,
    TimestampString: {
      kind: 'typeConstructor',
      args: [{ kind: 'value', dataType: 'pg/int4', name: 'precision', optional: true }],
      output: {
        codecId: 'pg/timestamp-string@1',
        typeParams: { precision: { kind: 'arg', index: 0 } },
      },
    },
  },
} satisfies AuthoringContributions;

function interpret(schema: string) {
  return interpretPostgresSchema(schema, {
    scalarColumnDescriptors: postgresNativeScalarTypeDescriptors,
    controlMutationDefaults: builtinControlMutationDefaults,
    composedExtensions: ['pgvector'],
    authoringContributions,
  });
}

function interpreted(schema: string) {
  const result = interpret(schema);
  if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics, null, 2));
  return result.value;
}

function tablesOf(schema: string) {
  return unboundTables(sqlStorageFromSuccessfulSqlInterpretation(interpreted(schema)));
}

function diagnostics(schema: string) {
  const result = interpret(schema);
  if (result.ok) throw new Error('expected the schema to be refused');
  return result.failure.diagnostics.map(({ code, message }) => ({ code, message }));
}

function ref(field: string, entry = 'Post') {
  return { namespace: 'public', entry, field };
}

describe('a types {} alias is expanded into each column typed by it', () => {
  it('stores each column with the inline params and attributes of its alias, and no storage types', () => {
    const contract = interpreted(`types {
  Slug      = VarChar(64)
  UpdatedAt = TimestampString(3) @onCreate(now()) @onUpdate(now())
}

model Post {
  id        String    @id @onCreate(uuid())
  slug      Slug
  updatedAt UpdatedAt @default(now())
}`);
    expect({
      types: documentScopedTypes(contract),
      post: unboundTables(sqlStorageFromSuccessfulSqlInterpretation(contract))['Post'],
      defaults: contract.execution?.mutations.defaults,
    }).toEqual({
      types: undefined,
      post: {
        columns: {
          id: { codecId: 'pg/text@1', dataType: 'pg/text', nullable: false, many: false },
          slug: {
            codecId: 'sql/varchar@1',
            dataType: 'pg/varchar',
            nullable: false,
            many: false,
            typeParams: { length: 64 },
          },
          updatedAt: {
            codecId: 'pg/timestamp-string@1',
            dataType: 'pg/timestamp',
            nullable: false,
            many: false,
            typeParams: { precision: 3 },
            default: { kind: 'function', expression: 'now()' },
          },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
      defaults: [
        { ref: ref('id'), onCreate: { kind: 'generator', id: 'uuidv4' } },
        {
          ref: ref('updatedAt'),
          onCreate: { kind: 'generator', id: 'timestampStringNow', params: { precision: 3 } },
          onUpdate: { kind: 'generator', id: 'timestampStringNow', params: { precision: 3 } },
        },
      ],
    });
  });

  it('stores the length of a pgvector alias on the column', () => {
    expect(
      tablesOf(`types {
  Embedding = pgvector.Vector(1536)
}

model Post {
  id        Int       @id
  embedding Embedding
}`)['Post']?.columns['embedding'],
    ).toEqual({
      codecId: 'pg/vector@1',
      dataType: 'pgvector/vector',
      nullable: false,
      many: false,
      typeParams: { length: 1536 },
    });
  });

  it('stores an enum alias as the enum codec and value set, as a field typed by the enum is stored', () => {
    const contract = interpreted(`enum Role {
  @@type("pg/text@1")
  User  = "user"
  Admin = "admin"
}

types {
  Membership = Role
}

model Post {
  id      Int        @id
  direct  Role
  aliased Membership
}`);
    const columns = unboundTables(sqlStorageFromSuccessfulSqlInterpretation(contract))['Post']
      ?.columns;
    const fields = contract.domain.namespaces['public']?.models?.['Post']?.fields;
    expect({ column: columns?.['aliased'], field: fields?.['aliased'] }).toEqual({
      column: columns?.['direct'],
      field: fields?.['direct'],
    });
    expect(columns?.['direct']).toMatchObject({ valueSet: expect.anything() });
  });

  it('gives each field typed by an enum alias the member its @default names', () => {
    const contract = interpreted(`enum Role {
  @@type("pg/text@1")
  User  = "user"
  Admin = "admin"
}

types {
  Membership = Role @default(User)
}

model Post {
  id      Int        @id
  direct  Role       @default(User)
  aliased Membership
}`);
    const columns = unboundTables(sqlStorageFromSuccessfulSqlInterpretation(contract))['Post']
      ?.columns;
    expect(columns?.['aliased']).toEqual(columns?.['direct']);
    expect(columns?.['direct']).toMatchObject({ default: { kind: 'literal', value: 'user' } });
  });

  it('refuses an alias whose base is a block that is not an enum', () => {
    expect(
      diagnostics(`types {
  P = Post
}

model Post {
  id Int @id
}`),
    ).toEqual([
      {
        code: 'PSL_UNSUPPORTED_NAMED_TYPE_BASE',
        message: 'Type alias "P" references unsupported base type "Post"',
      },
    ]);
  });

  it('stores the params of an alias on a value-object member and a discriminator column', () => {
    const contract = interpreted(`types {
  Code = VarChar(8)
}

type Label {
  code Code
}

model Post {
  id    Int    @id
  kind  Code
  label Label

  @@discriminator(kind)
}

model Note {
  body String

  @@base(Post, "note")
}`);
    expect({
      member: valueObjectsOf(contract)?.['Label']?.fields['code'],
      discriminator: unboundTables(sqlStorageFromSuccessfulSqlInterpretation(contract))['Post']
        ?.columns['kind'],
      types: documentScopedTypes(contract),
    }).toEqual({
      member: {
        nullable: false,
        many: false,
        type: { kind: 'scalar', codecId: 'sql/varchar@1', typeParams: { length: 8 } },
      },
      discriminator: {
        codecId: 'sql/varchar@1',
        dataType: 'pg/varchar',
        nullable: false,
        many: false,
        typeParams: { length: 8 },
        valueSet: {
          plane: 'storage',
          entityKind: 'valueSet',
          namespaceId: 'public',
          entityName: 'Post.kind',
        },
      },
      types: undefined,
    });
  });

  it('refuses an alias whose base is another alias', () => {
    expect(
      diagnostics(`types {
  A = VarChar(8)
  B = A
}

model Post {
  id Int @id
}`),
    ).toEqual([
      {
        code: 'PSL_UNSUPPORTED_NAMED_TYPE_BASE',
        message:
          'Type alias "B" is written as the type alias "A", and a type alias cannot be written as another one. Write what "A" is written as instead: B = VarChar(8)',
      },
    ]);
  });

  it('refuses an alias chain, a cycle and an alias with a comment, suggesting what each stands for', () => {
    expect(
      diagnostics(`types {
  A = VarChar(8) // the short one
    @default("x")
  B = A
  C = B
  X = Y
  Y = X
}

model Post {
  id Int @id
}`),
    ).toEqual([
      {
        code: 'PSL_UNSUPPORTED_NAMED_TYPE_BASE',
        message:
          'Type alias "B" is written as the type alias "A", and a type alias cannot be written as another one. Write what "A" is written as instead: B = VarChar(8) @default("x")',
      },
      {
        code: 'PSL_UNSUPPORTED_NAMED_TYPE_BASE',
        message:
          'Type alias "C" is written as the type alias "B", and a type alias cannot be written as another one. Write what "B" stands for instead: C = VarChar(8) @default("x")',
      },
      {
        code: 'PSL_UNSUPPORTED_NAMED_TYPE_BASE',
        message:
          'Type alias "X" is written as the type alias "Y", and a type alias cannot be written as another one.',
      },
      {
        code: 'PSL_UNSUPPORTED_NAMED_TYPE_BASE',
        message:
          'Type alias "Y" is written as the type alias "X", and a type alias cannot be written as another one.',
      },
    ]);
  });

  it('refuses an alias whose base is a contributed name that is not a type constructor', () => {
    expect(
      diagnostics(`types {
  X = temporal.UpdatedAt
}

model Post {
  id Int @id
}`),
    ).toEqual([
      {
        code: 'PSL_UNSUPPORTED_NAMED_TYPE_BASE',
        message: 'Type alias "X" references unsupported base type "temporal.UpdatedAt"',
      },
    ]);
  });

  it('refuses arguments on a field typed by an alias', () => {
    expect(
      diagnostics(`types {
  Key = VarChar(8)
}

model Post {
  id  Int @id
  key Key(3)
}`),
    ).toEqual([
      {
        code: 'PSL_UNSUPPORTED_FIELD_TYPE',
        message:
          'Field "Post.key" calls "Key", which is a type alias, not a type constructor. Remove the arguments.',
      },
    ]);
  });
});
