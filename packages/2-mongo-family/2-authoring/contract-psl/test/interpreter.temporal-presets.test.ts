import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import { computeExecutionHash } from '@internal/contract/hashing';
import {
  type AuthoringContributions,
  temporalAuthoringPresets,
  temporalCodecPreset,
} from '@internal/framework-components/authoring';
import type { CodecLookup } from '@internal/framework-components/codec';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { interpretPslDocumentToMongoContract } from '../src/interpreter';

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

const codecLookup: CodecLookup = {
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
};

function interpret(
  schema: string,
  options?: {
    readonly composedExtensions?: readonly string[];
    readonly authoringContributions?: AuthoringContributions;
  },
) {
  const { document, sources } = parse(schema, 'schema.prisma');
  const { symbolTable } = buildSymbolTable({
    documents: [document],
    sources,
    pslBlockDescriptors: {},
  });
  return interpretPslDocumentToMongoContract({
    documents: [document],
    symbolTable,
    sources,
    scalarTypeCodecIds,
    controlMutationDefaults: { dataTypeEntries: {}, defaultFunctionRegistry: new Map() },
    codecLookup,
    authoringContributions: options?.authoringContributions ?? authoringContributions,
    ...(options?.composedExtensions ? { composedExtensions: options.composedExtensions } : {}),
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

  it('rejects a misspelled preset with PSL_UNKNOWN_FIELD_PRESET', () => {
    expect(
      diagnosticsOf(`model Post {
  id        ObjectId              @id @map("_id")
  createdAt temporal.createdAtt()
}
`),
    ).toEqual([
      expect.objectContaining({
        code: 'PSL_UNKNOWN_FIELD_PRESET',
        data: { namespace: 'temporal', helperPath: 'temporal.createdAtt' },
      }),
    ]);
  });

  it('rejects an uncomposed extension namespace with PSL_EXTENSION_NAMESPACE_NOT_COMPOSED', () => {
    expect(
      diagnosticsOf(`model Post {
  id ObjectId            @id @map("_id")
  ts weather.updatedAt()
}
`),
    ).toEqual([
      expect.objectContaining({
        code: 'PSL_EXTENSION_NAMESPACE_NOT_COMPOSED',
        data: { namespace: 'weather', suggestedPack: 'weather' },
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

  it('rejects an option value the preset does not list with PSL_INVALID_ATTRIBUTE_ARGUMENT', () => {
    expect(
      diagnosticsOf(`model Post {
  id        ObjectId                            @id @map("_id")
  touchedAt temporal.timestamp(onUpdate: later)
}
`),
    ).toEqual([expect.objectContaining({ code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT' })]);
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
