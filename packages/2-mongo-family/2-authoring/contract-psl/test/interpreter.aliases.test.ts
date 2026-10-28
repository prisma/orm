import type { Contract } from '@internal/contract/types';
import { enumType, member } from '@internal/contract-authoring';
import {
  type AuthoringContributions,
  temporalTypeAliases,
} from '@internal/framework-components/authoring';
import {
  assembleGeneratorFunctions,
  singleGeneratorBinding,
} from '@internal/framework-components/components';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { mongoCodecLookup } from '@internal/mongo-contract/test';
import { jsonValue, mapBlock } from '@internal/psl-parser';
import { describe, expect, it } from 'vitest';
import { interpretMongoContract } from './interpreter-test-helpers';
import { mongoDataTypeSupport } from './mongo-type-lookups';

const generatorFunctions = assembleGeneratorFunctions([
  {
    id: 'mongo',
    generatorFunctions: [
      {
        name: 'now',
        signature: { documentation: 'Writes the current time.' },
        bindings: [
          singleGeneratorBinding({ codecIds: ['mongo/date@1'], generatorId: 'timestampNow' }),
        ],
      },
    ],
    controlMutationDefaults: { generatorDescriptors: [{ id: 'timestampNow' }] },
  },
]);

const mongoDate = { codecId: 'mongo/date@1' } as const;

const authoringContributions: AuthoringContributions = {
  type: { temporal: temporalTypeAliases(mongoDate, 'a JavaScript Date') },
  entityTypes: {
    enum: {
      kind: 'entity',
      discriminator: 'enum',
      output: {
        factory: () => enumType('Role', { codecId: 'mongo/string@1' }, member('USER')),
      },
    },
  },
  pslBlockDescriptors: {
    enum: {
      kind: 'pslBlock',
      keyword: 'enum',
      discriminator: 'enum',
      name: { required: true },
      spec: () =>
        mapBlock({
          value: { type: jsonValue(), documentation: 'Member value' },
          allowBare: true,
        }),
    },
  },
};

function interpret(schema: string) {
  return interpretMongoContract(schema, {
    scalarTypes: new Map([
      ['ObjectId', 'mongo/objectId@1'],
      ['String', 'mongo/string@1'],
      ['Date', 'mongo/date@1'],
    ]),
    defaultFunctionRegistry: new Map(),
    generatorFunctions,
    codecLookup: mongoCodecLookup,
    dataTypes: mongoDataTypeSupport,
    authoringContributions,
  });
}

function contractOf(schema: string): Contract {
  const result = interpret(schema);
  if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
  return result.value;
}

function diagnostics(schema: string) {
  const result = interpret(schema);
  if (result.ok) throw new Error('expected the schema to be refused');
  return result.failure.diagnostics.map(({ code, message }) => ({ code, message }));
}

const timestampNow = { kind: 'generator', id: 'timestampNow' } as const;

describe('Mongo PSL types {} aliases', () => {
  it('expand into each field typed by them, as if the field wrote the type and attributes', () => {
    const aliased = contractOf(`types {
  Key   = ObjectId
  Stamp = Date @onCreate(now()) @onUpdate(now())
}

model Post {
  id        Key   @id @map("_id")
  authorId  Key
  updatedAt Stamp @map("updated_at")
}`);
    const written = contractOf(`model Post {
  id        ObjectId @id @map("_id")
  authorId  ObjectId
  updatedAt Date     @map("updated_at") @onCreate(now()) @onUpdate(now())
}`);
    expect(aliased).toEqual(written);
  });

  it('key the generators of a @map-ped field by its stored name', () => {
    const contract = contractOf(`types {
  Stamp = Date @onCreate(now()) @onUpdate(now())
}

model Post {
  id        ObjectId @id @map("_id")
  updatedAt Stamp    @map("updated_at")
}`);
    expect(contract.execution?.mutations.defaults).toEqual([
      {
        ref: { namespace: UNBOUND_NAMESPACE_ID, entry: 'Post', field: 'updated_at' },
        onCreate: timestampNow,
        onUpdate: timestampNow,
      },
    ]);
  });

  it('expand an enum alias into its codec and value set', () => {
    const contract = contractOf(`enum Role {
  USER
}

types {
  Kind = Role
}

model Item {
  id   ObjectId @id @map("_id")
  kind Kind
}`);
    expect(
      contract.domain.namespaces[UNBOUND_NAMESPACE_ID]?.models['Item']?.fields['kind'],
    ).toEqual({
      type: { kind: 'scalar', codecId: 'mongo/string@1' },
      nullable: false,
      many: false,
      valueSet: {
        plane: 'domain',
        entityKind: 'enum',
        namespaceId: UNBOUND_NAMESPACE_ID,
        entityName: 'Role',
      },
    });
  });

  it('expand into a composite type member that takes no generator', () => {
    const contract = contractOf(`types {
  Key = ObjectId
}

type Ref {
  target Key
}

model Item {
  id  ObjectId @id @map("_id")
  ref Ref
}`);
    expect(
      JSON.parse(
        JSON.stringify(contract.storage.namespaces[UNBOUND_NAMESPACE_ID]?.entries['valueObject']),
      )['Ref'],
    ).toEqual({
      fields: {
        target: {
          type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
          nullable: false,
          many: false,
        },
      },
    });
  });

  it('refuse @default at the alias with the MongoDB hint, and keep the alias for its fields', () => {
    expect(
      diagnostics(`types {
  Stamp = Date @default(now())
}

model Post {
  id        ObjectId @id @map("_id")
  createdAt Stamp
  updatedAt Stamp
}`),
    ).toEqual([
      {
        code: 'PSL_UNSUPPORTED_NAMED_TYPE_ATTRIBUTE',
        message:
          'Type alias "Stamp" uses unsupported attribute "@default". Use @onCreate(now()) instead; MongoDB has no database defaults.',
      },
    ]);
  });

  it('refuse @id and @unique at the alias', () => {
    expect(
      diagnostics(`types {
  Key = ObjectId @id @unique
}

model Post {
  id Key @map("_id")
}`),
    ).toEqual([
      {
        code: 'PSL_UNSUPPORTED_NAMED_TYPE_ATTRIBUTE',
        message:
          'Type alias "Key" cannot carry @id. @id and @unique belong to a model\'s field, not to its type; write them on the field.',
      },
      {
        code: 'PSL_UNSUPPORTED_NAMED_TYPE_ATTRIBUTE',
        message:
          'Type alias "Key" cannot carry @unique. @id and @unique belong to a model\'s field, not to its type; write them on the field.',
      },
    ]);
  });

  it('report a generator that does not apply once, at the alias', () => {
    expect(
      diagnostics(`types {
  Label = String @onCreate(now())
}

model Post {
  id    ObjectId @id @map("_id")
  title Label
  slug  Label
}`),
    ).toEqual([
      {
        code: 'PSL_GENERATOR_NOT_APPLICABLE',
        message:
          'Type alias "Label": now() does not apply to codec "mongo/string@1". No generator function applies to this codec.',
      },
    ]);
  });

  it('refuse a field that repeats an attribute its alias sets', () => {
    expect(
      diagnostics(`types {
  Stamp = Date @onCreate(now()) @onUpdate(now())
}

model Post {
  id        ObjectId @id @map("_id")
  updatedAt Stamp    @onUpdate(now())
}`),
    ).toEqual([
      {
        code: 'PSL_DUPLICATE_ATTRIBUTE',
        message:
          'Field "Post.updatedAt" writes @onUpdate, which its type alias "Stamp" already sets. Remove one of them.',
      },
    ]);
  });

  it('let a field add a generator its alias does not set', () => {
    const contract = contractOf(`types {
  Stamp = Date @onCreate(now())
}

model Post {
  id        ObjectId @id @map("_id")
  updatedAt Stamp    @onUpdate(now())
}`);
    expect(contract.execution?.mutations.defaults).toEqual([
      {
        ref: { namespace: UNBOUND_NAMESPACE_ID, entry: 'Post', field: 'updatedAt' },
        onCreate: timestampNow,
        onUpdate: timestampNow,
      },
    ]);
  });

  it('build an optional field typed by an alias that generates a value', () => {
    const result = interpret(`types {
  Stamp = Date @onCreate(now())
}

model Post {
  id        ObjectId @id @map("_id")
  createdAt Stamp?
}`);
    if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));

    expect({
      field: result.value.domain.namespaces['__unbound__']?.models['Post']?.fields['createdAt'],
      defaults: result.value.execution?.mutations.defaults,
    }).toEqual({
      field: { type: { kind: 'scalar', codecId: 'mongo/date@1' }, nullable: true, many: false },
      defaults: [
        {
          ref: { namespace: '__unbound__', entry: 'Post', field: 'createdAt' },
          onCreate: { kind: 'generator', id: 'timestampNow' },
        },
      ],
    });
  });

  it('refuse a list field typed by an alias that generates a value', () => {
    expect(
      diagnostics(`types {
  Stamp = Date @onCreate(now())
}

model Post {
  id     ObjectId @id @map("_id")
  stamps Stamp[]
}`),
    ).toEqual([
      {
        code: 'PSL_LIST_EXECUTION_DEFAULT_UNSUPPORTED',
        message:
          'Field "Post.stamps" is a list, and its type alias "Stamp" generates a value. Lists have no per-element generated values; remove "[]" or type the field without the alias.',
      },
    ]);
  });

  it('refuse a variant field typed by an alias that generates a value', () => {
    expect(
      diagnostics(`types {
  Stamp = Date @onCreate(now())
}

model Event {
  id   ObjectId @id @map("_id")
  kind String
  @@discriminator(kind)
}

model Click {
  seenAt Stamp
  @@base(Event, "click")
}`),
    ).toEqual([
      {
        code: 'PSL_GENERATOR_ON_VARIANT_FIELD',
        message:
          'Generated value on variant "Click" field "seenAt": execution defaults apply to every document in collection "Event", so declare them on the base model.',
      },
    ]);
  });

  it('refuse a composite type member typed by an alias that generates a value', () => {
    expect(
      diagnostics(`types {
  Stamp = Date @onCreate(now())
}

type Audit {
  at Stamp
}

model Post {
  id    ObjectId @id @map("_id")
  audit Audit
}`),
    ).toEqual([
      {
        code: 'PSL_UNSUPPORTED_FIELD_TYPE',
        message:
          'Member "at" of composite type "Audit" is typed by the type alias "Stamp", which generates a value; a composite type member has no generated values.',
      },
    ]);
  });

  it('refuse a generator written twice on the alias, and any other attribute', () => {
    expect(
      diagnostics(`types {
  Stamp = Date @onCreate(now()) @onCreate(now()) @map("x")
}

model Post {
  id        ObjectId @id @map("_id")
  createdAt Stamp
}`),
    ).toEqual([
      {
        code: 'PSL_UNSUPPORTED_NAMED_TYPE_ATTRIBUTE',
        message: 'Type alias "Stamp" uses unsupported attribute "map"',
      },
      {
        code: 'PSL_DUPLICATE_ATTRIBUTE',
        message: '`@onCreate` declared more than once on type alias "Stamp".',
      },
    ]);
  });

  it('refuse arguments on a field typed by an alias', () => {
    expect(
      diagnostics(`types {
  Key = ObjectId
}

model Post {
  id     ObjectId @id @map("_id")
  author Key(3)
}`),
    ).toEqual([
      {
        code: 'PSL_UNSUPPORTED_FIELD_TYPE',
        message:
          'Field "Post.author" calls "Key", which is a type alias, not a type constructor. Remove the arguments.',
      },
    ]);
  });

  it('refuse an alias of another alias, and of a contributed alias', () => {
    expect(
      diagnostics(`types {
  A = Date
  B = A
  X = temporal.UpdatedAt
}

model Post {
  id ObjectId @id @map("_id")
}`),
    ).toEqual([
      {
        code: 'PSL_UNSUPPORTED_NAMED_TYPE_BASE',
        message:
          'Type alias "B" is written as the type alias "A", and a type alias cannot be written as another one. Write what "A" is written as instead: B = Date',
      },
      {
        code: 'PSL_UNSUPPORTED_NAMED_TYPE_BASE',
        message:
          'Type alias "X" is written as the type alias "temporal.UpdatedAt", and a type alias cannot be written as another one. Type the fields temporal.UpdatedAt instead, or write: X = Date @onCreate(now()) @onUpdate(now())',
      },
    ]);
  });

  it('refuse an alias chain, a cycle and an alias with a comment, suggesting what each stands for', () => {
    expect(
      diagnostics(`types {
  A = Date // the day
    @onCreate(now())
  B = A
  C = B
  X = Y
  Y = X
}

model Post {
  id ObjectId @id @map("_id")
}`),
    ).toEqual([
      {
        code: 'PSL_UNSUPPORTED_NAMED_TYPE_BASE',
        message:
          'Type alias "B" is written as the type alias "A", and a type alias cannot be written as another one. Write what "A" is written as instead: B = Date @onCreate(now())',
      },
      {
        code: 'PSL_UNSUPPORTED_NAMED_TYPE_BASE',
        message:
          'Type alias "C" is written as the type alias "B", and a type alias cannot be written as another one. Write what "B" stands for instead: C = Date @onCreate(now())',
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
});

describe('Mongo PSL contributed type aliases', () => {
  it('store what the matching generator attributes store', () => {
    const aliased = contractOf(`model Post {
  id        ObjectId           @id @map("_id")
  createdAt temporal.CreatedAt
  updatedAt temporal.UpdatedAt @map("updated_at")
}`);
    const attributes = contractOf(`model Post {
  id        ObjectId @id @map("_id")
  createdAt Date     @onCreate(now())
  updatedAt Date     @onCreate(now()) @onUpdate(now()) @map("updated_at")
}`);
    expect(aliased).toEqual(attributes);
  });

  it('resolve once for every field typed by them', () => {
    const contract = contractOf(`model Post {
  id        ObjectId           @id @map("_id")
  createdAt temporal.CreatedAt
  updatedAt temporal.CreatedAt
}`);
    expect(contract.execution?.mutations.defaults).toEqual([
      {
        ref: { namespace: UNBOUND_NAMESPACE_ID, entry: 'Post', field: 'createdAt' },
        onCreate: timestampNow,
      },
      {
        ref: { namespace: UNBOUND_NAMESPACE_ID, entry: 'Post', field: 'updatedAt' },
        onCreate: timestampNow,
      },
    ]);
  });

  it('refuse arguments', () => {
    expect(
      diagnostics(`model Post {
  id        ObjectId @id @map("_id")
  createdAt temporal.CreatedAt(3)
}`),
    ).toEqual([
      {
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        message: 'temporal.CreatedAt is a type alias and takes no arguments.',
      },
    ]);
  });

  it('refuse a field that repeats a generator the alias sets', () => {
    expect(
      diagnostics(`model Post {
  id        ObjectId           @id @map("_id")
  createdAt temporal.CreatedAt @onCreate(now())
}`),
    ).toEqual([
      {
        code: 'PSL_DUPLICATE_ATTRIBUTE',
        message:
          'Field "Post.createdAt" writes @onCreate, which its type alias "temporal.CreatedAt" already sets. Remove one of them.',
      },
    ]);
  });

  it('build an optional field', () => {
    const result = interpret(`model Post {
  id        ObjectId            @id @map("_id")
  updatedAt temporal.UpdatedAt?
}`);
    if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));

    expect({
      field: result.value.domain.namespaces['__unbound__']?.models['Post']?.fields['updatedAt'],
      defaults: result.value.execution?.mutations.defaults,
    }).toEqual({
      field: { type: { kind: 'scalar', codecId: 'mongo/date@1' }, nullable: true, many: false },
      defaults: [
        {
          ref: { namespace: '__unbound__', entry: 'Post', field: 'updatedAt' },
          onCreate: { kind: 'generator', id: 'timestampNow' },
          onUpdate: { kind: 'generator', id: 'timestampNow' },
        },
      ],
    });
  });
});
