import { fileURLToPath } from 'node:url';
import { enumType } from '@internal/contract-authoring';
import type {
  AuthoringEntityTypeDescriptor,
  ParsedPslExtensionBlock,
} from '@internal/framework-components/authoring';
import type {
  Codec,
  CodecLookupWithDescriptors,
  DataTypeValue,
} from '@internal/framework-components/codec';
import { prisma6MongoBinding } from '@internal/target-mongo/prisma6-binding';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { prisma6Contract } from '../src/provider';
import { fixturesDir, mongoSourceContext, mongoStack } from './support';

const enumSchema = join(fixturesDir, 'enums', 'schema.prisma');
const nativeTypeSchema = join(
  dirname(fileURLToPath(import.meta.url)),
  'enum-member-checks',
  'native-type',
  'schema.prisma',
);

function storedString(text: string): DataTypeValue {
  const stringCodec = mongoStack.codecLookup.get('mongo/string@1');
  if (stringCodec === undefined) throw new Error('the Mongo stack has no mongo/string@1 codec');
  return stringCodec.dataType.valueFrom(text, {});
}

function lookupWithStringCodec(overrides: Partial<Codec>): CodecLookupWithDescriptors {
  const stringCodec = Object.assign(
    Object.create(mongoStack.codecLookup.get('mongo/string@1') ?? null) as Codec,
    overrides,
  );
  return {
    ...mongoStack.codecLookup,
    get: (id) => (id === 'mongo/string@1' ? stringCodec : mongoStack.codecLookup.get(id)),
    renderOutputTypeFor: (id, params) => mongoStack.codecLookup.renderOutputTypeFor(id, params),
  };
}

/** An enum factory that reads each block its own way, as a third-party one may: the first member gets `value`, the others their lower-case names, typed by `codecId`. */
function enumFactory(codecId: string, value: string): AuthoringEntityTypeDescriptor {
  return {
    kind: 'entity',
    discriminator: 'enum',
    output: {
      factory: (block: ParsedPslExtensionBlock<Record<string, string>>) =>
        enumType(
          block.name,
          { codecId },
          ...Object.keys(block.values).map((name, index) => ({
            name,
            value: index === 0 ? value : name.toLowerCase(),
          })),
        ),
    },
  } as unknown as AuthoringEntityTypeDescriptor;
}

async function diagnosticsOf(
  options: {
    readonly codecLookup?: CodecLookupWithDescriptors;
    readonly enumEntity?: AuthoringEntityTypeDescriptor;
    readonly schema?: { readonly path: string; readonly sourceId: string };
  } = {},
) {
  const schema = options.schema ?? { path: enumSchema, sourceId: 'enums/schema.prisma' };
  const context = mongoSourceContext([schema.path]);
  const result = await prisma6Contract(schema.sourceId, {
    binding: prisma6MongoBinding,
  }).source.load({
    ...context,
    ...(options.codecLookup ? { codecLookup: options.codecLookup } : {}),
    ...(options.enumEntity
      ? {
          authoringContributions: {
            ...context.authoringContributions,
            entityTypes: {
              ...context.authoringContributions.entityTypes,
              enum: options.enumEntity,
            },
          },
        }
      : {}),
  });
  if (result.ok) throw new Error('Expected the load to fail');
  return result.failure.diagnostics.map(({ code, message, sourceId, span }) => ({
    code,
    message,
    sourceId,
    line: span?.start.line,
  }));
}

describe('Prisma 6 MongoDB enum members its codec cannot store as written', () => {
  it('reports each member the codec reads back as another value, with the value to write', async () => {
    const shouting = lookupWithStringCodec({
      toDataTypeValue: (v: unknown) => storedString(String(v).toUpperCase()),
    });
    expect(await diagnosticsOf({ codecLookup: shouting })).toEqual([
      {
        code: 'PSL_EXTENSION_INVALID_VALUE',
        message:
          'enum "Status" member "DRAFT" is written "draft", but its codec stores "DRAFT". Write the member as "DRAFT".',
        sourceId: 'enums/schema.prisma',
        line: 13,
      },
      {
        code: 'PSL_EXTENSION_INVALID_VALUE',
        message:
          'enum "Status" member "PUBLISHED" is written "published", but its codec stores "PUBLISHED". Write the member as "PUBLISHED".',
        sourceId: 'enums/schema.prisma',
        line: 14,
      },
    ]);
  });

  it('reports a member its codec refuses, at the member', async () => {
    const refusing = lookupWithStringCodec({
      toDataTypeValue: (v: unknown) => {
        if (v === 'bad') throw new Error('bad is not allowed');
        return storedString(String(v));
      },
    });
    const diagnostics = await diagnosticsOf({
      codecLookup: refusing,
      enumEntity: enumFactory('mongo/string@1', 'bad'),
    });
    expect(diagnostics[0]).toEqual({
      code: 'PSL_EXTENSION_INVALID_VALUE',
      message:
        'enum "Status" member "DRAFT" was rejected by codec "mongo/string@1": bad is not allowed',
      sourceId: 'enums/schema.prisma',
      line: 13,
    });
  });

  it('reports an enum codec no pack provides, at the enum', async () => {
    const diagnostics = await diagnosticsOf({ enumEntity: enumFactory('test/missing@1', 'x') });
    expect(diagnostics[0]).toEqual({
      code: 'PSL_EXTENSION_INVALID_VALUE',
      message: 'enum "Status" uses codec "test/missing@1", which no pack in the contract provides',
      sourceId: 'enums/schema.prisma',
      line: 12,
    });
  });

  it('still reports a native type on a field typed by a refused enum', async () => {
    const shouting = lookupWithStringCodec({
      toDataTypeValue: (v: unknown) => storedString(String(v).toUpperCase()),
    });
    expect(
      await diagnosticsOf({
        codecLookup: shouting,
        schema: { path: nativeTypeSchema, sourceId: 'native-type/schema.prisma' },
      }),
    ).toEqual([
      expect.objectContaining({ code: 'PSL.PRISMA6_MONGO_NATIVE_TYPE_UNSUPPORTED', line: 8 }),
      expect.objectContaining({ code: 'PSL_EXTENSION_INVALID_VALUE', line: 12 }),
    ]);
  });
});
