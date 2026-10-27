import {
  assembleGeneratorFunctions,
  singleGeneratorBinding,
} from '@internal/framework-components/components';
import { mongoCodecLookup } from '@internal/mongo-contract/test';
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

function interpret(schema: string) {
  return interpretMongoContract(schema, {
    scalarTypes: new Map([
      ['ObjectId', 'mongo/objectId@1'],
      ['String', 'mongo/string@1'],
      ['DateTime', 'mongo/date@1'],
    ]),
    defaultFunctionRegistry: new Map(),
    generatorFunctions,
    codecLookup: mongoCodecLookup,
    dataTypes: mongoDataTypeSupport,
  });
}

function diagnostics(schema: string) {
  const result = interpret(schema);
  if (result.ok) throw new Error('expected the schema to be refused');
  return result.failure.diagnostics.map(({ code, message }) => ({ code, message }));
}

const timestampNow = { kind: 'generator', id: 'timestampNow' } as const;

describe('Mongo PSL @onCreate and @onUpdate', () => {
  it('lower now() on DateTime to timestampNow for both phases', () => {
    const result = interpret(`model Post {
  id        ObjectId @id @map("_id")
  updatedAt DateTime @onCreate(now()) @onUpdate(now())
}`);
    expect(result.ok && result.value.execution?.mutations.defaults).toEqual([
      {
        ref: { namespace: '__unbound__', entry: 'Post', field: 'updatedAt' },
        onCreate: timestampNow,
        onUpdate: timestampNow,
      },
    ]);
  });

  it('build an optional field', () => {
    const result = interpret(`model Post {
  id     ObjectId  @id @map("_id")
  seenAt DateTime? @onUpdate(now())
}`);
    if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));

    expect({
      field: result.value.domain.namespaces['__unbound__']?.models['Post']?.fields['seenAt'],
      defaults: result.value.execution?.mutations.defaults,
    }).toEqual({
      field: { type: { kind: 'scalar', codecId: 'mongo/date@1' }, nullable: true, many: false },
      defaults: [
        {
          ref: { namespace: '__unbound__', entry: 'Post', field: 'seenAt' },
          onUpdate: { kind: 'generator', id: 'timestampNow' },
        },
      ],
    });
  });

  it('refuse the same generator attribute twice on one field', () => {
    expect(
      diagnostics(`model Post {
  id     ObjectId @id @map("_id")
  seenAt DateTime @onUpdate(now()) @onUpdate(now())
}`),
    ).toEqual([
      {
        code: 'PSL_DUPLICATE_ATTRIBUTE',
        message: '`@onUpdate` declared more than once on field "Post.seenAt".',
      },
    ]);
  });

  it('refuse a variant field', () => {
    expect(
      diagnostics(`model Event {
  id   ObjectId @id @map("_id")
  kind String
  @@discriminator(kind)
}

model Click {
  seenAt DateTime @onCreate(now())
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

  it('refuse a function the codec does not bind', () => {
    expect(
      diagnostics(`model Post {
  id   ObjectId @id @map("_id")
  name String   @onCreate(now())
}`),
    ).toEqual([
      {
        code: 'PSL_GENERATOR_NOT_APPLICABLE',
        message:
          'Field "Post.name": now() does not apply to codec "mongo/string@1". No generator function applies to this codec.',
      },
    ]);
  });

  it('name @onCreate(now()) when @default(now()) is written', () => {
    expect(
      diagnostics(`model Post {
  id        ObjectId @id @map("_id")
  createdAt DateTime @default(now())
}`),
    ).toEqual([
      {
        code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
        message:
          'Field "Post.createdAt" uses unsupported attribute "@default". Use @onCreate(now()) instead; MongoDB has no database defaults.',
      },
    ]);
  });
});

describe('Mongo PSL generated values keyed by collection', () => {
  it('emit one ref for a generator on the base model, shared by its variants', () => {
    const result = interpret(`model Event {
  id        ObjectId @id @map("_id")
  kind      String
  createdAt DateTime @onCreate(now())
  @@discriminator(kind)
  @@map("events")
}

model Click {
  url String
  @@base(Event, "click")
}

model View {
  path String
  @@base(Event, "view")
}`);
    expect(result.ok && result.value.execution?.mutations.defaults).toEqual([
      {
        ref: { namespace: '__unbound__', entry: 'events', field: 'createdAt' },
        onCreate: timestampNow,
      },
    ]);
  });

  it('merge identical generators two models declare for the same collection field', () => {
    const result = interpret(`model Post {
  id        ObjectId @id @map("_id")
  createdAt DateTime @onCreate(now())
  @@map("entries")
}

model Page {
  id        ObjectId @id @map("_id")
  createdAt DateTime @onCreate(now())
  @@map("entries")
}`);
    expect(result.ok && result.value.execution?.mutations.defaults).toEqual([
      {
        ref: { namespace: '__unbound__', entry: 'entries', field: 'createdAt' },
        onCreate: timestampNow,
      },
    ]);
  });

  it('refuse different generators two models declare for the same collection field', () => {
    expect(
      diagnostics(`model Post {
  id    ObjectId @id @map("_id")
  stamp DateTime @onCreate(now())
  @@map("entries")
}

model Page {
  id    ObjectId @id @map("_id")
  stamp DateTime @onCreate(now()) @onUpdate(now())
  @@map("entries")
}`),
    ).toEqual([
      {
        code: 'PSL_GENERATOR_CONFLICT',
        message:
          'Generated value on "Page.stamp" sets different execution defaults than "Post.stamp" for field "stamp" of collection "entries". Generate the same values on both models.',
      },
    ]);
  });
});
