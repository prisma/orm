import type {
  AuthoringDiagnosticSink,
  AuthoringEntityContext,
  PslExtensionBlock,
  PslExtensionBlockParamValue,
} from '@internal/framework-components/authoring';
import type { Codec, CodecLookup } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { mongoFamilyEnumEntityDescriptor } from '../src/core/authoring-entity-types';

const SPAN = {
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 0, line: 1, column: 1 },
};

function bareMember(): PslExtensionBlockParamValue {
  return { kind: 'bare', span: SPAN };
}

function valueMember(raw: string): PslExtensionBlockParamValue {
  return { kind: 'value', raw, span: SPAN };
}

function typeAttr(codecId: string) {
  return {
    name: 'type',
    args: [{ kind: 'positional' as const, value: `"${codecId}"`, span: SPAN }],
    span: SPAN,
  };
}

function enumBlock(input: {
  readonly name: string;
  readonly parameters: Record<string, PslExtensionBlockParamValue>;
  readonly typeCodecId?: string;
}): PslExtensionBlock {
  return {
    kind: 'enum',
    keyword: 'enum',
    name: input.name,
    parameters: input.parameters,
    blockAttributes: input.typeCodecId !== undefined ? [typeAttr(input.typeCodecId)] : [],
    attributes:
      input.typeCodecId !== undefined
        ? { type: { args: { codecId: input.typeCodecId }, span: SPAN } }
        : {},
    span: SPAN,
  };
}

const MONGO_STRING_CODEC_ID = 'mongo/string@1';
const MONGO_INT_CODEC_ID = 'mongo/int32@1';

const mongoStringCodec: Codec = {
  id: MONGO_STRING_CODEC_ID,
  encode: async (v: unknown) => v,
  decode: async (w: unknown) => w,
  encodeJson: (value) => value as never,
  decodeJson(json) {
    if (typeof json !== 'string') throw new Error(`expected string, got ${typeof json}`);
    return json;
  },
};

const mongoIntCodec: Codec = {
  id: MONGO_INT_CODEC_ID,
  encode: async (v: unknown) => v,
  decode: async (w: unknown) => w,
  encodeJson: (value) => value as never,
  decodeJson(json) {
    if (typeof json !== 'number') throw new Error(`expected number, got ${typeof json}`);
    return json;
  },
};

const testCodecLookup: CodecLookup = {
  get(id: string): Codec | undefined {
    if (id === MONGO_STRING_CODEC_ID) return mongoStringCodec;
    if (id === MONGO_INT_CODEC_ID) return mongoIntCodec;
    return undefined;
  },
  targetTypesFor(id: string): readonly string[] | undefined {
    if (id === MONGO_STRING_CODEC_ID) return ['string'];
    if (id === MONGO_INT_CODEC_ID) return ['int'];
    return undefined;
  },
  renderOutputTypeFor: () => undefined,
};

function makeContext(diagnostics: unknown[]): AuthoringEntityContext {
  const sink: AuthoringDiagnosticSink = {
    push: (d) => diagnostics.push(d),
  };
  return {
    family: 'mongo',
    target: 'mongo',
    codecLookup: testCodecLookup,
    sourceId: 'schema.prisma',
    diagnostics: sink,
    enumInferenceCodecs: { text: MONGO_STRING_CODEC_ID, int: MONGO_INT_CODEC_ID },
  };
}

const factory = mongoFamilyEnumEntityDescriptor.output.factory;

describe('mongoFamilyEnumEntityDescriptor: @@type omitted, inferred from members', () => {
  it('bare members infer the string codec', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({ name: 'Role', parameters: { admin: bareMember(), user: bareMember() } }),
      makeContext(diagnostics),
    );

    expect(diagnostics).toEqual([]);
    expect(handle).toMatchObject({
      codecId: MONGO_STRING_CODEC_ID,
      nativeType: 'string',
      members: { admin: 'admin', user: 'user' },
    });
  });

  it('integer-value members infer the int codec', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({
        name: 'Priority',
        parameters: { low: valueMember('1'), high: valueMember('2') },
      }),
      makeContext(diagnostics),
    );

    expect(diagnostics).toEqual([]);
    expect(handle).toMatchObject({
      codecId: MONGO_INT_CODEC_ID,
      nativeType: 'int',
      members: { low: 1, high: 2 },
    });
  });

  it('a float member cannot be inferred', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({ name: 'Priority', parameters: { low: valueMember('1.5') } }),
      makeContext(diagnostics),
    );

    expect(handle).toBeUndefined();
    expect(diagnostics).toEqual([expect.objectContaining({ code: 'PSL_ENUM_CANNOT_INFER_TYPE' })]);
  });

  it('a mix of string and integer members cannot be inferred', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({
        name: 'Mixed',
        parameters: { low: valueMember('"low"'), high: valueMember('2') },
      }),
      makeContext(diagnostics),
    );

    expect(handle).toBeUndefined();
    expect(diagnostics).toEqual([expect.objectContaining({ code: 'PSL_ENUM_CANNOT_INFER_TYPE' })]);
  });
});

describe('mongoFamilyEnumEntityDescriptor: explicit @@type is unchanged', () => {
  it('an explicit @@type resolving to string lowers exactly as before', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({
        name: 'Role',
        parameters: { admin: valueMember('"admin"') },
        typeCodecId: MONGO_STRING_CODEC_ID,
      }),
      makeContext(diagnostics),
    );

    expect(diagnostics).toEqual([]);
    expect(handle).toMatchObject({ codecId: MONGO_STRING_CODEC_ID, nativeType: 'string' });
  });
});
