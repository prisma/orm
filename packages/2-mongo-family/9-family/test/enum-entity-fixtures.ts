import type { JsonValue } from '@internal/contract/types';
import type {
  AuthoringDiagnosticSink,
  AuthoringEntityContext,
  DataTypeAuthoringEntry,
  DataTypeSupport,
  WrittenScalar,
  WrittenValue,
} from '@internal/framework-components/authoring';
import {
  type AnyCodecDescriptor,
  type Codec,
  type CodecLookupWithDescriptors,
  createDataTypeLookup,
  type DataType,
  type DataTypeValue,
  readJsonString,
  refuseJsonValue,
} from '@internal/framework-components/codec';
import { mongoDataType } from '@internal/mongo-contract/data-type';
import { InternalError } from '@internal/utils/internal-error';
import { mongoFamilyEnumEntityDescriptor } from '../src/core/authoring-entity-types';

export const SPAN = {
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 0, line: 1, column: 1 },
};

/** Where an enum block's `@@type` argument is written, distinct from the block and the attribute. */
export const CODEC_ARG_SPAN = {
  start: { offset: 30, line: 2, column: 10 },
  end: { offset: 41, line: 2, column: 21 },
};

export const TYPE_ATTRIBUTE_SPAN = {
  start: { offset: 22, line: 2, column: 3 },
  end: { offset: 42, line: 2, column: 22 },
};

type EnumBlock = Parameters<typeof mongoFamilyEnumEntityDescriptor.output.factory>[0];
type MemberValue = EnumBlock['values'][string];

/** A fixture member as PSL writes it: a scalar as itself, and a JSON document, `null` included, as a `json` tagged literal. */
function writtenScalarOf(value: JsonValue): WrittenScalar {
  if (typeof value === 'string') return { kind: 'string', text: value };
  if (typeof value === 'number') return { kind: 'number', text: String(value) };
  if (typeof value === 'boolean') return { kind: 'boolean', value };
  return { kind: 'tag', tag: 'json', text: JSON.stringify(value) };
}

/** What the enum block grammar yields for a written member: a string, number or boolean as itself, a tagged literal as its written value. */
function memberValueOf(written: WrittenScalar): MemberValue {
  if (written.kind === 'tag') return written;
  if (written.kind === 'boolean') return written.value;
  return written.kind === 'number' ? Number(written.text) : written.text;
}

export function enumBlock(input: {
  readonly name: string;
  readonly values: Record<string, JsonValue | undefined>;
  readonly typeCodecId?: string;
}): EnumBlock {
  const values: Record<string, MemberValue> = {};
  const writtenValues: Record<string, WrittenValue> = {};
  for (const [name, value] of Object.entries(input.values)) {
    if (value === undefined) {
      values[name] = undefined;
      continue;
    }
    const written = writtenScalarOf(value);
    values[name] = memberValueOf(written);
    writtenValues[name] = written;
  }
  return {
    kind: 'enum',
    keyword: 'enum',
    name: input.name,
    values,
    writtenValues,
    parameterSpans: Object.fromEntries(Object.keys(input.values).map((key) => [key, SPAN])),
    attributes:
      input.typeCodecId !== undefined
        ? {
            type: {
              args: { codecId: input.typeCodecId },
              argSpans: { codecId: CODEC_ARG_SPAN },
              span: TYPE_ATTRIBUTE_SPAN,
            },
          }
        : {},
    span: SPAN,
  };
}

export const TEXT_CODEC_ID = 'mongo/string@1';
export const INT_CODEC_ID = 'mongo/int32@1';
export const JSON_CODEC_ID = 'test/json@1';
export const FOLDING_CODEC_ID = 'test/folding-text@1';
export const ENCODE_FOLDING_CODEC_ID = 'test/encode-folding-text@1';
export const BROKEN_CODEC_ID = 'test/broken@1';
export const LENIENT_OBJECT_CODEC_ID = 'test/lenient-object@1';
export const ARRAY_CODEC_ID = 'test/array@1';

const textType = mongoDataType('test/text', {
  read: (json) => readJsonString('test/text', json),
  bsonTypes: ['string'],
});
const intType = mongoDataType('test/int', {
  read: (json) => (typeof json === 'number' ? json : refuseJsonValue('test/int', 'a number', json)),
  bsonTypes: ['int'],
});
const jsonType = mongoDataType('test/json', { read: (json) => json, bsonTypes: ['object'] });
const foldingTextType = mongoDataType('test/folding-text', {
  read: (json) => readJsonString('test/folding-text', json),
  bsonTypes: ['string'],
  casts: { [textType.id]: (value) => value },
});
const arrayType = mongoDataType('test/array', {
  read: (json) => json,
  bsonTypes: ['array'],
  casts: { [jsonType.id]: (value) => value },
});

function fakeCodec(
  id: string,
  type: DataType,
  fromDataTypeValue: (value: DataTypeValue) => unknown,
  toJson: (value: unknown) => JsonValue = (value) => value as JsonValue,
): Codec {
  return {
    id,
    dataType: type,
    toWire: async (v: unknown) => v,
    fromWire: async (w: unknown) => w,
    toDataTypeValue: (value) => type.valueFrom(toJson(value), {}),
    fromDataTypeValue,
  };
}

export const textCodec = fakeCodec(TEXT_CODEC_ID, textType, (value) => value.value);

export const intCodec = fakeCodec(INT_CODEC_ID, intType, (value) => value.value);

export const jsonCodec = fakeCodec(JSON_CODEC_ID, jsonType, (value) => {
  if (value.value === null) throw new Error('expected a non-null JSON value');
  return value.value;
});

export const lenientJsonCodec = fakeCodec(
  LENIENT_OBJECT_CODEC_ID,
  jsonType,
  (value) => value.value,
);

export const foldingCodec = fakeCodec(FOLDING_CODEC_ID, foldingTextType, (value) =>
  String(value.value).toLowerCase(),
);

export const encodeFoldingCodec = fakeCodec(
  ENCODE_FOLDING_CODEC_ID,
  foldingTextType,
  (value) => value.value,
  (value) => String(value).toLowerCase(),
);

export const brokenCodec = fakeCodec(BROKEN_CODEC_ID, foldingTextType, () => {
  throw new InternalError('a codec broke an invariant');
});

export const UNEQUAL_CODEC_ID = 'test/unequal@1';
export const UNEQUAL_MANY_BSON_TYPES_CODEC_ID = 'test/unequal-many-bson-types@1';

export const dataTypeIdByCodecId: Record<string, string> = {
  [TEXT_CODEC_ID]: 'test/text',
  [INT_CODEC_ID]: 'test/int',
  'mongo/json@1': 'test/mongo-json',
  'mongo/bson@1': 'test/mongo-bson',
  [JSON_CODEC_ID]: 'test/json',
  [FOLDING_CODEC_ID]: 'test/folding-text',
  [ENCODE_FOLDING_CODEC_ID]: 'test/folding-text',
  [BROKEN_CODEC_ID]: 'test/folding-text',
  'test/orphan@1': 'test/unregistered',
  [UNEQUAL_CODEC_ID]: 'test/json',
  [UNEQUAL_MANY_BSON_TYPES_CODEC_ID]: 'test/mongo-json',
  [LENIENT_OBJECT_CODEC_ID]: 'test/json',
  [ARRAY_CODEC_ID]: 'test/array',
};

export const testDataTypes = createDataTypeLookup([
  textType,
  intType,
  mongoDataType('test/mongo-json', {
    read: (json) => json,
    bsonTypes: ['object', 'array', 'string', 'double', 'int', 'long', 'bool', 'null'],
  }),
  mongoDataType('test/mongo-bson', { read: (json) => json, bsonTypes: [] }),
  jsonType,
  arrayType,
  foldingTextType,
]);

const testEntries: Readonly<Record<string, DataTypeAuthoringEntry>> = {
  [textType.id]: {
    written: { kind: 'plain', syntax: 'string', parse: (text) => text },
    print: (value) => String(value),
    documentation: 'Text.',
  },
  [intType.id]: {
    written: {
      kind: 'plain',
      syntax: 'number',
      types: [intType.id],
      classify: (text) => ({ type: intType.id, value: Number(text) }),
    },
    print: (value) => String(value),
    documentation: 'A number.',
  },
  [jsonType.id]: {
    written: { kind: 'tag', tag: 'json', parse: (text) => JSON.parse(text) },
    print: (value) => JSON.stringify(value),
    documentation: 'A JSON document.',
  },
};

export const testDataTypeSupport: DataTypeSupport = {
  entries: testEntries,
  lookup: testDataTypes,
  dataTypeOfCodec: (codecId) => testCodecLookup.descriptorFor(codecId)?.dataType,
};

export const testCodecLookup: CodecLookupWithDescriptors = {
  get(id: string): Codec | undefined {
    if (id === TEXT_CODEC_ID) return textCodec;
    if (id === INT_CODEC_ID) return intCodec;
    if (id === JSON_CODEC_ID) return jsonCodec;
    if (id === FOLDING_CODEC_ID) return foldingCodec;
    if (id === ENCODE_FOLDING_CODEC_ID) return encodeFoldingCodec;
    if (id === BROKEN_CODEC_ID) return brokenCodec;
    if (id === UNEQUAL_CODEC_ID) return jsonCodec;
    if (id === LENIENT_OBJECT_CODEC_ID || id === ARRAY_CODEC_ID) return lenientJsonCodec;
    return undefined;
  },
  descriptorFor(id: string) {
    const dataTypeId = dataTypeIdByCodecId[id];
    if (dataTypeId === undefined) return undefined;
    const traits =
      id === UNEQUAL_CODEC_ID || id === UNEQUAL_MANY_BSON_TYPES_CODEC_ID ? [] : ['equality'];
    const codec = testCodecLookup.get(id);
    return {
      codecId: id,
      dataType: dataTypeId,
      traits,
      paramsSchema: undefined,
      isParameterized: false,
      factory: () => () => {
        if (codec === undefined) throw new InternalError(`the fixture has no codec ${id}`);
        return codec;
      },
    } as unknown as AnyCodecDescriptor;
  },
  renderOutputTypeFor: () => undefined,
};

export function makeContext(diagnostics: unknown[]): AuthoringEntityContext {
  const sink: AuthoringDiagnosticSink = {
    push: (d) => diagnostics.push(d),
  };
  return {
    family: 'mongo',
    target: 'mongo',
    codecLookup: testCodecLookup,
    dataTypes: testDataTypeSupport,
    sourceId: 'schema.prisma',
    diagnostics: sink,
    enumInferenceCodecs: { text: TEXT_CODEC_ID, int: INT_CODEC_ID },
  };
}

export const factory = mongoFamilyEnumEntityDescriptor.output.factory;
