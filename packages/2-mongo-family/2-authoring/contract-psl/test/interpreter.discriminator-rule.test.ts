import { enumType } from '@internal/contract-authoring';
import { mongoCodecLookup } from '@internal/mongo-contract/test';
import { jsonValue, mapBlock } from '@internal/psl-parser';
import { describe, expect, it } from 'vitest';
import { interpretMongoContract } from './interpreter-test-helpers';
import { mongoDataTypeSupport } from './mongo-type-lookups';

const kindEnum = enumType(
  'Kind',
  { codecId: 'mongo/string@1' },
  { name: 'Photo', value: 'photo' },
  { name: 'Video', value: 'video' },
);

function interpret(schema: string) {
  return interpretMongoContract(schema, {
    scalarTypes: new Map([
      ['ObjectId', 'mongo/objectId@1'],
      ['String', 'mongo/string@1'],
      ['Int32', 'mongo/int32@1'],
    ]),
    defaultFunctionRegistry: new Map(),
    codecLookup: mongoCodecLookup,
    dataTypes: mongoDataTypeSupport,
    authoringContributions: {
      type: {},
      modelAttributes: {},
      entityTypes: {
        enum: { kind: 'entity', discriminator: 'enum', output: { factory: () => kindEnum } },
      },
      pslBlockDescriptors: {
        enum: {
          kind: 'pslBlock',
          keyword: 'enum',
          discriminator: 'enum',
          name: { required: true },
          spec: () =>
            mapBlock({
              value: { type: jsonValue(), documentation: 'The member value.' },
              allowBare: true,
            }),
        },
      },
    },
  });
}

function diagnosticsOf(schema: string) {
  const result = interpret(schema);
  return result.ok
    ? []
    : result.failure.diagnostics.map(({ code, message }) => ({ code, message }));
}

/** A base `Asset` whose discriminator field is declared as `kind`, and a variant `Photo` with the base value `value`. */
function hierarchy(kind: string, value = '"photo"', preamble = '') {
  return `${preamble}
model Asset {
  id   ObjectId @id @map("_id")
  kind ${kind}

  @@discriminator(kind)
}

model Photo {
  width Int32

  @@base(Asset, ${value})
}
`;
}

const KIND_ENUM_BLOCK = 'enum Kind {\n  Photo = "photo"\n  Video = "video"\n}\n';

describe('the discriminator rule in MongoDB PSL', () => {
  it('refuses an optional discriminator field', () => {
    expect(diagnosticsOf(hierarchy('String?'))).toEqual([
      {
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        message:
          'Discriminator field "kind" on model "Asset" must be required, but it is optional. Remove the "?"',
      },
    ]);
  });

  it('refuses a list discriminator field', () => {
    expect(diagnosticsOf(hierarchy('String[]'))).toEqual([
      {
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        message:
          'Discriminator field "kind" on model "Asset" must hold one value, but it is a list. Remove the "[]"',
      },
    ]);
  });

  it('accepts a discriminator by its data type, through a type alias of String', () => {
    const result = interpret(hierarchy('Label', '"photo"', 'types {\n  Label = String\n}\n'));
    expect(result.ok ? [] : result.failure.diagnostics).toEqual([]);
    expect(
      result.ok && result.value.domain.namespaces['__unbound__']?.models['Asset'],
    ).toMatchObject({ discriminator: { field: 'kind' }, variants: { photo: { model: 'Photo' } } });
  });

  it('accepts an enum-typed discriminator whose @@base values are members', () => {
    const result = interpret(hierarchy('Kind', '"photo"', KIND_ENUM_BLOCK));
    expect(
      result.ok && result.value.domain.namespaces['__unbound__']?.models['Asset'],
    ).toMatchObject({ discriminator: { field: 'kind' }, variants: { photo: { model: 'Photo' } } });
  });

  it('refuses a @@base value that is not a member of the enum typing the discriminator', () => {
    expect(diagnosticsOf(hierarchy('Kind', '"audio"', KIND_ENUM_BLOCK))).toEqual([
      {
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        message:
          'Model "Photo" declares @@base value "audio", which is not a member of enum "Kind", the type of discriminator field "Asset.kind". Write one of: "photo", "video"',
      },
    ]);
  });
});

/** Each diagnostic's code and where its span starts and ends, as offsets into the schema text. */
function positionsOf(schema: string) {
  const result = interpret(schema);
  return result.ok
    ? []
    : result.failure.diagnostics.map(({ code, span }) => ({
        code,
        start: span?.start.offset,
        end: span?.end.offset,
      }));
}

describe('where MongoDB PSL reports a discriminator refusal', () => {
  it('reports a list discriminator field at its @@discriminator attribute', () => {
    const schema = hierarchy('String[]');
    const start = schema.indexOf('@@discriminator(kind)');
    expect(positionsOf(schema)).toEqual([
      {
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        start,
        end: start + '@@discriminator(kind)'.length,
      },
    ]);
  });

  it('reports a @@base value that is not a member at the value', () => {
    const schema = hierarchy('Kind', '"audio"', KIND_ENUM_BLOCK);
    const start = schema.indexOf('"audio"');
    expect(positionsOf(schema)).toEqual([
      { code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT', start, end: start + '"audio"'.length },
    ]);
  });
});

describe('a @@discriminator or @@base that does not parse', () => {
  it('gets no orphaned-base diagnostic for a discriminator naming no field', () => {
    expect(
      diagnosticsOf(hierarchy('String').replace('@@discriminator(kind)', '@@discriminator(nope)')),
    ).toEqual([expect.objectContaining({ code: 'PSL_UNRESOLVED_REFERENCE' })]);
  });

  it('gets no orphaned-discriminator diagnostic for a @@base whose value is not a string', () => {
    expect(diagnosticsOf(hierarchy('String', '1'))).toEqual([
      expect.objectContaining({ code: 'PSL_INVALID_ATTRIBUTE_SYNTAX' }),
    ]);
  });
});
