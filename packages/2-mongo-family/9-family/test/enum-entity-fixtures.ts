import type { JsonValue } from '@internal/contract/types';
import type {
  AuthoringDiagnosticSink,
  AuthoringEntityContext,
  ParsedPslExtensionBlock,
} from '@internal/framework-components/authoring';
import {
  type AnyCodecDescriptor,
  type Codec,
  type CodecLookupWithDescriptors,
  createDataTypeLookup,
} from '@internal/framework-components/codec';
import { mongoDataType } from '@internal/mongo-contract/data-type';
import { InternalError } from '@internal/utils/internal-error';
import { mongoFamilyEnumEntityDescriptor } from '../src/core/authoring-entity-types';

export const SPAN = {
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 0, line: 1, column: 1 },
};

export function enumBlock(input: {
  readonly name: string;
  readonly values: Record<string, JsonValue | undefined>;
  readonly typeCodecId?: string;
}): ParsedPslExtensionBlock<Record<string, JsonValue | undefined>> {
  return {
    kind: 'enum',
    keyword: 'enum',
    name: input.name,
    values: input.values,
    parameterSpans: Object.fromEntries(Object.keys(input.values).map((key) => [key, SPAN])),
    attributes:
      input.typeCodecId !== undefined
        ? { type: { args: { codecId: input.typeCodecId }, span: SPAN } }
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

export const textCodec: Codec = {
  id: TEXT_CODEC_ID,
  encode: async (v: unknown) => v,
  decode: async (w: unknown) => w,
  encodeJson: (value) => value as never,
  decodeJson(json) {
    if (typeof json !== 'string') throw new Error(`expected string, got ${typeof json}`);
    return json;
  },
};

export const intCodec: Codec = {
  id: INT_CODEC_ID,
  encode: async (v: unknown) => v,
  decode: async (w: unknown) => w,
  encodeJson: (value) => value as never,
  decodeJson(json) {
    if (typeof json !== 'number') throw new Error(`expected number, got ${typeof json}`);
    return json;
  },
};

export const jsonCodec: Codec = {
  id: JSON_CODEC_ID,
  encode: async (v: unknown) => v,
  decode: async (w: unknown) => w,
  encodeJson: (value) => value as never,
  decodeJson(json) {
    if (json === null) throw new Error('expected a non-null JSON value');
    return json;
  },
};

export const foldingCodec: Codec = {
  id: FOLDING_CODEC_ID,
  encode: async (v: unknown) => v,
  decode: async (w: unknown) => w,
  encodeJson: (value) => value as never,
  decodeJson(json) {
    if (typeof json !== 'string') throw new Error(`expected string, got ${typeof json}`);
    return json.toLowerCase();
  },
};

export const encodeFoldingCodec: Codec = {
  id: ENCODE_FOLDING_CODEC_ID,
  encode: async (v: unknown) => v,
  decode: async (w: unknown) => w,
  encodeJson: (value) => String(value).toLowerCase(),
  decodeJson(json) {
    if (typeof json !== 'string') throw new Error(`expected string, got ${typeof json}`);
    return json;
  },
};

export const brokenCodec: Codec = {
  ...textCodec,
  id: BROKEN_CODEC_ID,
  decodeJson() {
    throw new InternalError('a codec broke an invariant');
  },
};

export const UNEQUAL_CODEC_ID = 'test/unequal@1';

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
};

export const testDataTypes = createDataTypeLookup([
  mongoDataType('test/text', { bsonTypes: ['string'] }),
  mongoDataType('test/int', { bsonTypes: ['int'] }),
  mongoDataType('test/mongo-json', {
    bsonTypes: ['object', 'array', 'string', 'double', 'int', 'long', 'bool', 'null'],
  }),
  mongoDataType('test/mongo-bson', { bsonTypes: [] }),
  mongoDataType('test/json', { bsonTypes: ['object'] }),
  mongoDataType('test/folding-text', { bsonTypes: ['string'] }),
]);

export const testCodecLookup: CodecLookupWithDescriptors = {
  get(id: string): Codec | undefined {
    if (id === TEXT_CODEC_ID) return textCodec;
    if (id === INT_CODEC_ID) return intCodec;
    if (id === JSON_CODEC_ID) return jsonCodec;
    if (id === FOLDING_CODEC_ID) return foldingCodec;
    if (id === ENCODE_FOLDING_CODEC_ID) return encodeFoldingCodec;
    if (id === BROKEN_CODEC_ID) return brokenCodec;
    if (id === UNEQUAL_CODEC_ID) return jsonCodec;
    return undefined;
  },
  descriptorFor(id: string) {
    const dataTypeId = dataTypeIdByCodecId[id];
    if (dataTypeId === undefined) return undefined;
    const traits = id === UNEQUAL_CODEC_ID ? [] : ['equality'];
    return { codecId: id, dataType: dataTypeId, traits } as unknown as AnyCodecDescriptor;
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
    dataTypeLookup: testDataTypes,
    sourceId: 'schema.prisma',
    diagnostics: sink,
    enumInferenceCodecs: { text: TEXT_CODEC_ID, int: INT_CODEC_ID },
  };
}

export const factory = mongoFamilyEnumEntityDescriptor.output.factory;
