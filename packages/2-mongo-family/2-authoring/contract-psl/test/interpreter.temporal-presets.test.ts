import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import { computeExecutionHash } from '@internal/contract/hashing';
import {
  type AuthoringContributions,
  temporalAuthoringPresets,
  temporalCodecPreset,
} from '@internal/framework-components/authoring';
import type { CodecLookup, CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { interpretMongoContract } from './interpreter-test-helpers';

const mongoDate = { codecId: 'mongo/date@1', nativeType: 'date' } as const;

const authoringContributions: AuthoringContributions = {
  field: {
    temporal: {
      ...temporalAuthoringPresets(mongoDate),
      timestamp: temporalCodecPreset(mongoDate),
    },
  },
};

const scalarTypeCodecIds: ReadonlyMap<string, string> = new Map([
  ['ObjectId', 'mongo/objectId@1'],
  ['String', 'mongo/string@1'],
  ['Date', 'mongo/date@1'],
]);

const targetTypes: Record<string, readonly string[]> = {
  'mongo/objectId@1': ['objectId'],
  'mongo/string@1': ['string'],
  'mongo/date@1': ['date'],
};

const codecLookup: CodecLookupWithDescriptors = {
  get(id: string) {
    if (!targetTypes[id]) return undefined;
    return {
      id,
      encode: async (v: unknown) => v,
      decode: async (w: unknown) => w,
      encodeJson: (v: unknown) => v,
      decodeJson: (j: unknown) => j,
    } as ReturnType<CodecLookup['get']>;
  },
  targetTypesFor: (id: string) => targetTypes[id],
  renderOutputTypeFor: () => undefined,
  descriptorFor: () => undefined,
};

function interpret(
  schema: string,
  options?: {
    readonly authoringContributions?: AuthoringContributions;
    readonly reportWarning?: (diagnostic: ContractSourceDiagnostic) => void;
  },
) {
  return interpretMongoContract(schema, {
    scalarTypeCodecIds,
    controlMutationDefaults: { defaultFunctionRegistry: new Map() },
    codecLookup,
    authoringContributions: options?.authoringContributions ?? authoringContributions,
    ...(options?.reportWarning ? { reportWarning: options.reportWarning } : {}),
  });
}

function diagnosticsOf(
  schema: string,
  options?: Parameters<typeof interpret>[1],
): readonly ContractSourceDiagnostic[] {
  const result = interpret(schema, options);
  if (result.ok) throw new Error('Expected interpretation to fail');
  return result.failure.diagnostics;
}

const timestampNow = { kind: 'generator', id: 'timestampNow' } as const;

describe('Mongo PSL temporal presets', () => {
  const schema = `model Post {
  id        ObjectId               @id @map("_id")
  title     String
  updatedAt temporal.updatedAt()   @map("updated_at")
  createdAt temporal.createdAt()
  touchedAt temporal.timestamp(onUpdate: now)
}
`;

  it('types each preset field as a mongo/date@1 scalar', () => {
    const result = interpret(schema);
    if (!result.ok) throw new Error(JSON.stringify(result.failure));
    const fields = result.value.domain.namespaces[UNBOUND_NAMESPACE_ID]?.models['Post']?.fields;
    const date = { nullable: false, type: { kind: 'scalar', codecId: 'mongo/date@1' } };
    expect(fields).toMatchObject({ updated_at: date, createdAt: date, touchedAt: date });
  });

  it('emits sorted execution defaults keyed by collection and stored field name', () => {
    const result = interpret(schema);
    if (!result.ok) throw new Error(JSON.stringify(result.failure));
    const mutations = {
      defaults: [
        {
          ref: { namespace: UNBOUND_NAMESPACE_ID, entry: 'Post', field: 'createdAt' },
          onCreate: timestampNow,
        },
        {
          ref: { namespace: UNBOUND_NAMESPACE_ID, entry: 'Post', field: 'touchedAt' },
          onUpdate: timestampNow,
        },
        {
          ref: { namespace: UNBOUND_NAMESPACE_ID, entry: 'Post', field: 'updated_at' },
          onCreate: timestampNow,
          onUpdate: timestampNow,
        },
      ],
    };
    expect(result.value.execution).toEqual({
      executionHash: computeExecutionHash({
        target: 'mongo',
        targetFamily: 'mongo',
        execution: { mutations },
      }),
      mutations,
    });
  });

  it('uses the mapped collection name as the entry', () => {
    const result = interpret(`model Post {
  id        ObjectId             @id @map("_id")
  createdAt temporal.createdAt()
  @@map("articles")
}
`);
    if (!result.ok) throw new Error(JSON.stringify(result.failure));
    expect(result.value.execution?.mutations.defaults.map((d) => d.ref.entry)).toEqual([
      'articles',
    ]);
  });

  it('preserves an unqualified contributed preset', () => {
    const result = interpret(
      `model Post {
  id ObjectId @id @map("_id")
  touchedAt timestamp()
}`,
      {
        authoringContributions: { field: { timestamp: temporalCodecPreset(mongoDate) } },
      },
    );
    if (!result.ok) throw new Error(JSON.stringify(result.failure));
    expect(result.value.domain.namespaces[UNBOUND_NAMESPACE_ID]?.models['Post']?.fields).toEqual({
      _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false, many: false },
      touchedAt: {
        type: { kind: 'scalar', codecId: 'mongo/date@1' },
        nullable: false,
        many: false,
      },
    });
  });

  it('omits the execution section when no field uses a preset', () => {
    const result = interpret(`model Post {
  id        ObjectId @id @map("_id")
  createdAt Date
}
`);
    if (!result.ok) throw new Error(JSON.stringify(result.failure));
    expect(result.value).not.toHaveProperty('execution');
  });
});

describe('Mongo PSL temporal preset misuse', () => {
  it('keeps a contributed type namespace error instead of dropping an unqualified preset field', () => {
    expect(
      diagnosticsOf(
        `model Post {
  id ObjectId @id @map("_id")
  touchedAt timestamp()
}`,
        {
          authoringContributions: {
            field: { timestamp: temporalCodecPreset(mongoDate) },
            type: { timestamp: { scalar: { kind: 'typeConstructor', output: mongoDate } } },
          },
        },
      ).map(({ code, message, sourceId }) => ({ code, message, sourceId })),
    ).toEqual([
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message:
          '"timestamp" is a namespace; a type reference must name a model, composite type, enum, or named type',
        sourceId: 'schema.prisma',
      },
    ]);
  });

  it.each([
    ['type', 'composite type', 'createdAtt'],
    ['type', 'composite type', 'createdAt'],
    ['model', 'model', 'createdAtt'],
    ['model', 'model', 'createdAt'],
  ])('keeps only the binder error for a %s (%s) qualifier with %s', (keyword, kind, member) => {
    expect(
      diagnosticsOf(`${keyword} temporal {
  ${keyword === 'model' ? 'id ObjectId @id @map("_id")' : 'value String'}
}
model Post {
  id ObjectId @id @map("_id")
  createdAt temporal.${member}()?
}`).map(({ code, message, sourceId }) => ({ code, message, sourceId })),
    ).toEqual([
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message: `"temporal" is a ${kind}, not a namespace`,
        sourceId: 'schema.prisma',
      },
    ]);
  });

  it('reports unresolved bare weather.updatedAt without a preset diagnostic', () => {
    expect(
      diagnosticsOf(
        `model Post {\n  id ObjectId @id @map("_id")\n  value weather.updatedAt\n}`,
      ).map(({ code, message, sourceId }) => ({ code, message, sourceId })),
    ).toEqual([
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message: 'Cannot find type "weather.updatedAt"',
        sourceId: 'schema.prisma',
      },
    ]);
  });

  it('rejects an optional preset field with PSL_PRESET_NOT_OPTIONAL', () => {
    expect(
      diagnosticsOf(`model Post {
  id        ObjectId              @id @map("_id")
  createdAt temporal.createdAt()?
}
`),
    ).toEqual([
      expect.objectContaining({ code: 'PSL_PRESET_NOT_OPTIONAL', sourceId: 'schema.prisma' }),
    ]);
  });

  it('rejects a preset as a list element type with PSL_PRESET_NOT_LIST', () => {
    expect(
      diagnosticsOf(`model Post {
  id        ObjectId               @id @map("_id")
  createdAt temporal.createdAt()[]
}
`),
    ).toEqual([expect.objectContaining({ code: 'PSL_PRESET_NOT_LIST' })]);
  });

  it('rejects a preset combined with @id with PSL_PRESET_AND_ID_CONFLICT at the @id attribute', () => {
    const schema = `model Post {
  id        ObjectId             @id @map("_id")
  createdAt temporal.createdAt() @id
}
`;
    const idOffset = schema.lastIndexOf('@id');
    const conflict = diagnosticsOf(schema).find((d) => d.code === 'PSL_PRESET_AND_ID_CONFLICT');
    expect(conflict?.span).toMatchObject({
      start: { offset: idOffset, line: 3 },
      end: { offset: idOffset + '@id'.length, line: 3 },
    });
  });

  it('rejects a field preset written without a call with PSL_PRESET_NOT_CALLED', () => {
    expect(
      diagnosticsOf(`model Post {
  id        ObjectId          @id @map("_id")
  createdAt temporal.createdAt
}
`).map(({ code, message }) => ({ code, message })),
    ).toEqual([
      {
        code: 'PSL_PRESET_NOT_CALLED',
        message:
          'Field "Post.createdAt" uses field preset "temporal.createdAt" without calling it. Write temporal.createdAt().',
      },
    ]);
  });

  it('rejects a type constructor with a required argument written without a call', () => {
    expect(
      diagnosticsOf(
        `model Post {
  id   ObjectId @id @map("_id")
  code Sized
}
`,
        {
          authoringContributions: {
            ...authoringContributions,
            type: {
              Sized: {
                kind: 'typeConstructor',
                args: [{ kind: 'number', name: 'length' }],
                output: { codecId: 'mongo/string@1', nativeType: 'string' },
              },
            },
          },
        },
      ).map(({ code, message }) => ({ code, message })),
    ).toEqual([
      {
        code: 'PSL_TYPE_CONSTRUCTOR_NOT_CALLED',
        message:
          'Field "Post.code" uses type constructor "Sized" without arguments. Write Sized(length).',
      },
    ]);
  });

  it('reports a misspelled preset name as a single unresolved reference', () => {
    expect(
      diagnosticsOf(`model Post {
  id        ObjectId              @id @map("_id")
  createdAt temporal.createdAtt()
}
`),
    ).toEqual([
      expect.objectContaining({
        code: 'PSL_UNRESOLVED_REFERENCE',
        message: 'Cannot find type "temporal.createdAtt"',
        data: { reference: 'type', name: 'temporal.createdAtt', constructorCall: true },
      }),
    ]);
  });

  it('rejects a field-preset call with an unregistered namespace with PSL_UNRESOLVED_REFERENCE', () => {
    expect(
      diagnosticsOf(`model Post {
  id ObjectId            @id @map("_id")
  ts weather.updatedAt()
}
`),
    ).toEqual([
      expect.objectContaining({
        code: 'PSL_UNRESOLVED_REFERENCE',
        message: 'Cannot find type "weather.updatedAt"',
        data: { reference: 'type', name: 'weather.updatedAt', constructorCall: true },
      }),
    ]);
  });

  it('rejects an argument the preset does not take with PSL_INVALID_ATTRIBUTE_ARGUMENT', () => {
    expect(
      diagnosticsOf(`model Post {
  id        ObjectId                @id @map("_id")
  createdAt temporal.createdAt(123)
}
`),
    ).toEqual([expect.objectContaining({ code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT' })]);
  });

  it('warns that temporal.timestamp() with no phase is the same as Date', () => {
    const warnings: ContractSourceDiagnostic[] = [];
    const result = interpret(
      `model Post {
  id        ObjectId             @id @map("_id")
  stampedAt temporal.timestamp()
}
`,
      { reportWarning: (diagnostic) => warnings.push(diagnostic) },
    );
    expect(result.ok).toBe(true);
    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'PSL_PRESET_WITHOUT_EFFECT',
        severity: 'warning',
        message:
          'Field "Post.stampedAt" uses temporal.timestamp() without onCreate or onUpdate, so nothing fills it and it is stored exactly like Date. Write Date, or pass onCreate: now or onUpdate: now.',
      }),
    ]);
  });

  it('rejects an option value the preset does not list with PSL_INVALID_ATTRIBUTE_ARGUMENT', () => {
    expect(
      diagnosticsOf(`model Post {
  id        ObjectId                            @id @map("_id")
  touchedAt temporal.timestamp(onUpdate: later)
}
`),
    ).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        message:
          'Field "Post.touchedAt": Argument "onUpdate" of temporal.timestamp must be "now"; received "later"',
      }),
    ]);
  });

  it('rejects a preset on a composite-type field with PSL_UNSUPPORTED_FIELD_TYPE', () => {
    expect(
      diagnosticsOf(`type Audit {
  createdAt temporal.createdAt()
}

model Post {
  id    ObjectId @id @map("_id")
  audit Audit
}
`),
    ).toEqual([
      expect.objectContaining({
        code: 'PSL_UNSUPPORTED_FIELD_TYPE',
        message: expect.stringContaining('not on fields of a composite type'),
      }),
    ]);
  });

  it.each([
    ['a storage default', { default: { kind: 'function', expression: 'now()' } }],
    ['id semantics', { id: true }],
    ['a unique constraint', { unique: true }],
  ] as const)(
    'rejects a preset that contributes %s with PSL_UNSUPPORTED_FIELD_TYPE',
    (contribution, output) => {
      const contributions: AuthoringContributions = {
        field: { custom: { stamp: { kind: 'fieldPreset', output: { ...mongoDate, ...output } } } },
      };
      expect(
        diagnosticsOf(
          `model Post {
  id    ObjectId      @id @map("_id")
  stamp custom.stamp()
}
`,
          { authoringContributions: contributions },
        ),
      ).toEqual([
        expect.objectContaining({
          code: 'PSL_UNSUPPORTED_FIELD_TYPE',
          message: expect.stringContaining(`contributes ${contribution}`),
        }),
      ]);
    },
  );
});

describe('Mongo PSL temporal presets on polymorphic models', () => {
  const base = `model Event {
  id        ObjectId             @id @map("_id")
  kind      String
  createdAt temporal.createdAt()
  @@discriminator(kind)
  @@map("events")
}
`;

  it('emits one ref for a preset on the base model, shared by its variants', () => {
    const result = interpret(`${base}
model Click {
  url String
  @@base(Event, "click")
}

model View {
  path String
  @@base(Event, "view")
}
`);
    if (!result.ok) throw new Error(JSON.stringify(result.failure));
    expect(result.value.execution?.mutations.defaults).toEqual([
      {
        ref: { namespace: UNBOUND_NAMESPACE_ID, entry: 'events', field: 'createdAt' },
        onCreate: timestampNow,
      },
    ]);
  });

  it('rejects a preset on a variant field with PSL_PRESET_ON_VARIANT_FIELD at the preset', () => {
    const schema = `${base}
model Click {
  url       String
  clickedAt temporal.createdAt()
  @@base(Event, "click")
}
`;
    const presetOffset = schema.lastIndexOf('temporal.createdAt()');
    expect(diagnosticsOf(schema)).toEqual([
      expect.objectContaining({
        code: 'PSL_PRESET_ON_VARIANT_FIELD',
        message:
          'Preset "temporal.createdAt" on variant "Click" field "clickedAt": execution defaults apply to every document in collection "events", so declare them on the base model.',
        span: expect.objectContaining({
          start: expect.objectContaining({ offset: presetOffset }),
          end: expect.objectContaining({ offset: presetOffset + 'temporal.createdAt()'.length }),
        }),
      }),
    ]);
  });
});

describe('Mongo PSL temporal presets on models sharing a collection', () => {
  it('merges identical execution defaults for the same collection field', () => {
    const result = interpret(`model Post {
  id        ObjectId             @id @map("_id")
  createdAt temporal.createdAt()
  @@map("entries")
}

model Page {
  id        ObjectId             @id @map("_id")
  createdAt temporal.createdAt()
  @@map("entries")
}
`);
    if (!result.ok) throw new Error(JSON.stringify(result.failure));
    expect(result.value.execution?.mutations.defaults).toEqual([
      {
        ref: { namespace: UNBOUND_NAMESPACE_ID, entry: 'entries', field: 'createdAt' },
        onCreate: timestampNow,
      },
    ]);
  });

  it('rejects differing execution defaults for the same collection field with PSL_PRESET_CONFLICT', () => {
    expect(
      diagnosticsOf(`model Post {
  id    ObjectId             @id @map("_id")
  stamp temporal.createdAt()
  @@map("entries")
}

model Page {
  id    ObjectId             @id @map("_id")
  stamp temporal.updatedAt()
  @@map("entries")
}
`),
    ).toEqual([
      expect.objectContaining({
        code: 'PSL_PRESET_CONFLICT',
        message: expect.stringContaining('"entries"'),
      }),
    ]);
  });
});
