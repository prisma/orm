import type { JsonValue } from '@internal/contract/types';
import type {
  AuthoringDiagnosticSink,
  AuthoringEntityContext,
  ParsedPslExtensionBlock,
} from '@internal/framework-components/authoring';
import type {
  AnyCodecDescriptor,
  Codec,
  CodecLookupWithDescriptors,
  DataType,
} from '@internal/framework-components/codec';
import {
  createDataTypeLookup,
  dataType,
  dataTypeValueFor,
} from '@internal/framework-components/codec';
import { sqlDataType } from '@internal/sql-contract/data-type';
import { InternalError } from '@internal/utils/internal-error';
import { type } from 'arktype';
import { sqlFamilyEnumEntityDescriptor } from '../src/core/authoring-entity-types';

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

export const TEXT_CODEC_ID = 'pg/text@1';
export const INT_CODEC_ID = 'pg/int@1';
export const JSON_CODEC_ID = 'test/json@1';
export const FOLDING_CODEC_ID = 'test/folding-text@1';
export const ENCODE_FOLDING_CODEC_ID = 'test/encode-folding-text@1';
export const BROKEN_CODEC_ID = 'test/broken@1';

export const textType = sqlDataType('test/text', {
  read: (json) => json,
  texts: [{ text: 'text', written: true }],
});
export const intType = sqlDataType('test/int', {
  read: (json) => json,
  texts: [{ text: 'int', written: true }],
});
export const jsonType = sqlDataType('test/json', {
  read: (json) => json,
  texts: [{ text: 'json', written: true }],
});
export const vectorType = sqlDataType('test/vector', {
  read: (json) => json,
  params: type({ length: 'number.integer >= 1' }),
  texts: [{ text: 'vector({length})', written: true }],
});
const unregisteredType = dataType('test/unregistered', { read: (json) => json });

function fixtureCodec(
  id: string,
  type: DataType,
  fromJson: (json: JsonValue) => unknown,
  toJson: (value: unknown) => JsonValue = (value) => value as JsonValue,
): Codec {
  return {
    id,
    dataType: type,
    toWire: async (v: unknown) => v,
    fromWire: async (w: unknown) => w,
    toDataTypeValue: (value) => dataTypeValueFor(type, {}, toJson(value)),
    fromDataTypeValue: (value) => fromJson(value.value),
  };
}

const readText = (json: JsonValue): string => {
  if (typeof json !== 'string') throw new Error(`expected string, got ${typeof json}`);
  return json;
};

export const textCodec: Codec = fixtureCodec(TEXT_CODEC_ID, textType, readText);

export const intCodec: Codec = fixtureCodec(INT_CODEC_ID, intType, (json) => {
  if (typeof json !== 'number') throw new Error(`expected number, got ${typeof json}`);
  return json;
});

export const jsonCodec: Codec = fixtureCodec(JSON_CODEC_ID, jsonType, (json) => {
  if (json === null) throw new Error('expected a non-null JSON value');
  return json;
});

export const foldingCodec: Codec = fixtureCodec(FOLDING_CODEC_ID, textType, (json) =>
  readText(json).toLowerCase(),
);

export const encodeFoldingCodec: Codec = fixtureCodec(
  ENCODE_FOLDING_CODEC_ID,
  textType,
  readText,
  (value) => String(value).toLowerCase(),
);

export const brokenCodec: Codec = fixtureCodec(BROKEN_CODEC_ID, textType, () => {
  throw new InternalError('a codec broke an invariant');
});

export const VECTOR_CODEC_ID = 'test/vector@1';
export const vectorCodec: Codec = fixtureCodec(VECTOR_CODEC_ID, vectorType, readText);

export const ORPHAN_CODEC_ID = 'test/orphan@1';
export const orphanCodec: Codec = fixtureCodec(ORPHAN_CODEC_ID, unregisteredType, readText);

export const dataTypeOfCodec: Readonly<Record<string, DataType>> = {
  [TEXT_CODEC_ID]: textType,
  [INT_CODEC_ID]: intType,
  [JSON_CODEC_ID]: jsonType,
  [FOLDING_CODEC_ID]: textType,
  [VECTOR_CODEC_ID]: vectorType,
  [ENCODE_FOLDING_CODEC_ID]: textType,
  [BROKEN_CODEC_ID]: textType,
};

export const testCodecLookup: CodecLookupWithDescriptors = {
  get(id: string): Codec | undefined {
    if (id === TEXT_CODEC_ID) return textCodec;
    if (id === INT_CODEC_ID) return intCodec;
    if (id === JSON_CODEC_ID) return jsonCodec;
    if (id === FOLDING_CODEC_ID) return foldingCodec;
    if (id === ENCODE_FOLDING_CODEC_ID) return encodeFoldingCodec;
    if (id === BROKEN_CODEC_ID) return brokenCodec;
    if (id === VECTOR_CODEC_ID) return vectorCodec;
    if (id === ORPHAN_CODEC_ID) return orphanCodec;
    return undefined;
  },
  descriptorFor(id: string): AnyCodecDescriptor | undefined {
    if (id === ORPHAN_CODEC_ID) {
      return {
        codecId: id,
        dataType: 'test/unregistered',
        traits: ['equality'],
      } as unknown as AnyCodecDescriptor;
    }
    const dataType = dataTypeOfCodec[id];
    return dataType === undefined
      ? undefined
      : ({
          codecId: id,
          dataType: dataType.id,
          traits: ['equality'],
        } as unknown as AnyCodecDescriptor);
  },
  renderOutputTypeFor: () => undefined,
};

export const testDataTypes = createDataTypeLookup([textType, intType, jsonType, vectorType]);

export function makeContext(diagnostics: unknown[]): AuthoringEntityContext {
  const sink: AuthoringDiagnosticSink = {
    push: (d) => diagnostics.push(d),
  };
  return {
    family: 'sql',
    target: 'postgres',
    codecLookup: testCodecLookup,
    dataTypeLookup: testDataTypes,
    sourceId: 'schema.prisma',
    diagnostics: sink,
    enumInferenceCodecs: { text: TEXT_CODEC_ID, int: INT_CODEC_ID },
  };
}

export const factory = sqlFamilyEnumEntityDescriptor.output.factory;
