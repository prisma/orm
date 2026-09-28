import {
  type AuthoringContributions,
  temporalAuthoringPresets,
} from '@internal/framework-components/authoring';
import type { CodecLookup } from '@internal/framework-components/codec';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { interpretPslDocumentToMongoContract } from '../src/interpreter';

const scalarTypeCodecIds: ReadonlyMap<string, string> = new Map([
  ['ObjectId', 'mongo/objectId@1'],
  ['Money', 'money/cents@1'],
]);

const targetTypes: Record<string, readonly string[]> = {
  'mongo/objectId@1': ['objectId'],
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

function interpret(schema: string, authoringContributions?: AuthoringContributions) {
  const { document, sources } = parse(schema, 'unknown-codec.prisma');
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
    ...(authoringContributions ? { authoringContributions } : {}),
  });
}

describe('field types whose codec the codec lookup does not know', () => {
  it('reports a model field', () => {
    const result = interpret(`model Order {
  id    ObjectId @id @map("_id")
  price Money
}
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_UNKNOWN_FIELD_CODEC',
        message:
          'Field "Order.price" type "Money" uses codec "money/cents@1", which is not registered by any composed component',
        sourceId: 'unknown-codec.prisma',
      }),
    ]);
  });

  it('reports a composite type field', () => {
    const result = interpret(`type Line {
  total Money
}

model Order {
  id   ObjectId @id @map("_id")
  line Line
}
`);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_UNKNOWN_FIELD_CODEC',
        message: expect.stringContaining('Field "Line.total" type "Money"'),
      }),
    ]);
  });

  it('reports a field preset', () => {
    const result = interpret(
      `model Order {
  id        ObjectId             @id @map("_id")
  createdAt temporal.createdAt()
}
`,
      {
        field: {
          temporal: temporalAuthoringPresets({ codecId: 'clock/instant@1', nativeType: 'date' }),
        },
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_UNKNOWN_FIELD_CODEC',
        message: expect.stringContaining('Field "Order.createdAt"'),
      }),
    ]);
  });
});
