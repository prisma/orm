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
import { describe, expect, it } from 'vitest';
import { mongoFamilyEnumEntityDescriptor } from '../src/core/authoring-entity-types';

const SPAN = {
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 0, line: 1, column: 1 },
};

function enumBlock(input: {
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

const TEXT_CODEC_ID = 'mongo/string@1';
const INT_CODEC_ID = 'mongo/int32@1';
const JSON_CODEC_ID = 'test/json@1';
const FOLDING_CODEC_ID = 'test/folding-text@1';
const ENCODE_FOLDING_CODEC_ID = 'test/encode-folding-text@1';
const BROKEN_CODEC_ID = 'test/broken@1';

const textCodec: Codec = {
  id: TEXT_CODEC_ID,
  encode: async (v: unknown) => v,
  decode: async (w: unknown) => w,
  encodeJson: (value) => value as never,
  decodeJson(json) {
    if (typeof json !== 'string') throw new Error(`expected string, got ${typeof json}`);
    return json;
  },
};

const intCodec: Codec = {
  id: INT_CODEC_ID,
  encode: async (v: unknown) => v,
  decode: async (w: unknown) => w,
  encodeJson: (value) => value as never,
  decodeJson(json) {
    if (typeof json !== 'number') throw new Error(`expected number, got ${typeof json}`);
    return json;
  },
};

const jsonCodec: Codec = {
  id: JSON_CODEC_ID,
  encode: async (v: unknown) => v,
  decode: async (w: unknown) => w,
  encodeJson: (value) => value as never,
  decodeJson(json) {
    if (json === null) throw new Error('expected a non-null JSON value');
    return json;
  },
};

const foldingCodec: Codec = {
  id: FOLDING_CODEC_ID,
  encode: async (v: unknown) => v,
  decode: async (w: unknown) => w,
  encodeJson: (value) => value as never,
  decodeJson(json) {
    if (typeof json !== 'string') throw new Error(`expected string, got ${typeof json}`);
    return json.toLowerCase();
  },
};

const encodeFoldingCodec: Codec = {
  id: ENCODE_FOLDING_CODEC_ID,
  encode: async (v: unknown) => v,
  decode: async (w: unknown) => w,
  encodeJson: (value) => String(value).toLowerCase(),
  decodeJson(json) {
    if (typeof json !== 'string') throw new Error(`expected string, got ${typeof json}`);
    return json;
  },
};

const brokenCodec: Codec = {
  ...textCodec,
  id: BROKEN_CODEC_ID,
  decodeJson() {
    throw new InternalError('a codec broke an invariant');
  },
};

const dataTypeIdByCodecId: Record<string, string> = {
  [TEXT_CODEC_ID]: 'test/text',
  [INT_CODEC_ID]: 'test/int',
  'mongo/json@1': 'test/mongo-json',
  'mongo/bson@1': 'test/mongo-bson',
  [JSON_CODEC_ID]: 'test/json',
  [FOLDING_CODEC_ID]: 'test/folding-text',
  [ENCODE_FOLDING_CODEC_ID]: 'test/folding-text',
  [BROKEN_CODEC_ID]: 'test/folding-text',
  'test/orphan@1': 'test/unregistered',
};

const testDataTypes = createDataTypeLookup([
  mongoDataType('test/text', { bsonTypes: ['string'] }),
  mongoDataType('test/int', { bsonTypes: ['int'] }),
  mongoDataType('test/mongo-json', {
    bsonTypes: ['object', 'array', 'string', 'double', 'int', 'long', 'bool', 'null'],
  }),
  mongoDataType('test/mongo-bson', { bsonTypes: [] }),
  mongoDataType('test/json', { bsonTypes: ['object'] }),
  mongoDataType('test/folding-text', { bsonTypes: ['string'] }),
]);

const testCodecLookup: CodecLookupWithDescriptors = {
  get(id: string): Codec | undefined {
    if (id === TEXT_CODEC_ID) return textCodec;
    if (id === INT_CODEC_ID) return intCodec;
    if (id === JSON_CODEC_ID) return jsonCodec;
    if (id === FOLDING_CODEC_ID) return foldingCodec;
    if (id === ENCODE_FOLDING_CODEC_ID) return encodeFoldingCodec;
    if (id === BROKEN_CODEC_ID) return brokenCodec;
    return undefined;
  },
  descriptorFor(id: string) {
    const dataTypeId = dataTypeIdByCodecId[id];
    if (dataTypeId === undefined) return undefined;
    return { codecId: id, dataType: dataTypeId } as unknown as AnyCodecDescriptor;
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
    dataTypeLookup: testDataTypes,
    sourceId: 'schema.prisma',
    diagnostics: sink,
    enumInferenceCodecs: { text: TEXT_CODEC_ID, int: INT_CODEC_ID },
  };
}

const factory = mongoFamilyEnumEntityDescriptor.output.factory;

describe('mongoFamilyEnumEntityDescriptor: @@type omitted, inferred from members', () => {
  it('bare members infer the text codec and decode from their key', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({ name: 'Role', values: { admin: undefined, user: undefined } }),
      makeContext(diagnostics),
    );

    expect(diagnostics).toEqual([]);
    expect(handle).toMatchObject({
      codecId: TEXT_CODEC_ID,
      members: { admin: 'admin', user: 'user' },
    });
  });

  it('string members infer the text codec', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({ name: 'Role', values: { admin: 'admin', user: 'user' } }),
      makeContext(diagnostics),
    );

    expect(diagnostics).toEqual([]);
    expect(handle).toMatchObject({
      codecId: TEXT_CODEC_ID,
      members: { admin: 'admin', user: 'user' },
    });
  });

  it('a mix of bare and string members still infers the text codec', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({ name: 'Role', values: { admin: undefined, user: 'user' } }),
      makeContext(diagnostics),
    );

    expect(diagnostics).toEqual([]);
    expect(handle).toMatchObject({ codecId: TEXT_CODEC_ID });
  });

  it('integer members infer the int codec', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({ name: 'Priority', values: { low: 1, high: 2 } }),
      makeContext(diagnostics),
    );

    expect(diagnostics).toEqual([]);
    expect(handle).toMatchObject({
      codecId: INT_CODEC_ID,
      members: { low: 1, high: 2 },
    });
  });

  it('a float member cannot be inferred', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({ name: 'Priority', values: { low: 1.5 } }),
      makeContext(diagnostics),
    );

    expect(handle).toBeUndefined();
    expect(diagnostics).toEqual([expect.objectContaining({ code: 'PSL_ENUM_CANNOT_INFER_TYPE' })]);
  });

  it('a boolean member cannot be inferred', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({ name: 'Flag', values: { on: true } }),
      makeContext(diagnostics),
    );

    expect(handle).toBeUndefined();
    expect(diagnostics).toEqual([expect.objectContaining({ code: 'PSL_ENUM_CANNOT_INFER_TYPE' })]);
  });

  it('an explicit null member cannot be inferred and is not a bare member', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({ name: 'Odd', values: { none: null } }),
      makeContext(diagnostics),
    );

    expect(handle).toBeUndefined();
    expect(diagnostics).toEqual([expect.objectContaining({ code: 'PSL_ENUM_CANNOT_INFER_TYPE' })]);
  });

  it('a mix of string and integer members cannot be inferred', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({ name: 'Mixed', values: { low: 'low', high: 2 } }),
      makeContext(diagnostics),
    );

    expect(handle).toBeUndefined();
    expect(diagnostics).toEqual([expect.objectContaining({ code: 'PSL_ENUM_CANNOT_INFER_TYPE' })]);
  });

  it('the diagnostic names the enum and suggests an explicit @@type', () => {
    const diagnostics: { code: string; message: string }[] = [];
    factory(enumBlock({ name: 'Priority', values: { low: 1.5 } }), makeContext(diagnostics));

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_ENUM_CANNOT_INFER_TYPE',
        message: expect.stringMatching(/Priority/),
      }),
    ]);
    expect(diagnostics[0]?.message).toMatch(/@@type/);
  });

  it('an empty enum cannot be inferred', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(enumBlock({ name: 'Empty', values: {} }), makeContext(diagnostics));

    expect(handle).toBeUndefined();
    expect(diagnostics).toEqual([expect.objectContaining({ code: 'PSL_ENUM_CANNOT_INFER_TYPE' })]);
  });
});

describe('mongoFamilyEnumEntityDescriptor: explicit @@type bypasses inference, never validation', () => {
  it('an explicit @@type is used verbatim, skipping inference entirely', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({ name: 'Priority', values: { low: 1.5 }, typeCodecId: TEXT_CODEC_ID }),
      makeContext(diagnostics),
    );

    expect(diagnostics).toEqual([expect.objectContaining({ code: 'PSL_EXTENSION_INVALID_VALUE' })]);
    expect(handle).toBeUndefined();
  });

  it('an explicit @@type resolving to text lowers exactly as before', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({ name: 'Role', values: { admin: 'admin' }, typeCodecId: TEXT_CODEC_ID }),
      makeContext(diagnostics),
    );

    expect(diagnostics).toEqual([]);
    expect(handle).toMatchObject({ codecId: TEXT_CODEC_ID });
  });

  it('an explicit codec receives structured JSON media through the shared grammar', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({
        name: 'Config',
        values: { region: { zone: 'a', replicas: [1, 2] }, tags: ['x', 'y'] },
        typeCodecId: JSON_CODEC_ID,
      }),
      makeContext(diagnostics),
    );

    expect(diagnostics).toEqual([]);
    expect(handle).toMatchObject({
      codecId: JSON_CODEC_ID,
      members: { region: { zone: 'a', replicas: [1, 2] }, tags: ['x', 'y'] },
    });
  });

  it('an explicit null member reaches the codec and its rejection is reported', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({ name: 'Odd', values: { none: null }, typeCodecId: JSON_CODEC_ID }),
      makeContext(diagnostics),
    );

    expect(handle).toBeUndefined();
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_EXTENSION_INVALID_VALUE',
        message: expect.stringContaining('rejected by codec'),
      }),
    ]);
  });

  it('a bare member under a non-string codec is its own diagnostic', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({ name: 'Priority', values: { low: undefined }, typeCodecId: INT_CODEC_ID }),
      makeContext(diagnostics),
    );

    expect(handle).toBeUndefined();
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: 'PSL_ENUM_BARE_MEMBER_NON_STRING_CODEC' }),
    ]);
  });

  it('reports a known codec whose data type no component registers', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({ name: 'Role', values: { admin: 'admin' }, typeCodecId: 'test/orphan@1' }),
      makeContext(diagnostics),
    );

    expect(handle).toBeUndefined();
    expect(diagnostics).toEqual([
      {
        code: 'PSL_EXTENSION_INVALID_VALUE',
        message:
          'enum "Role" @@type codec "test/orphan@1" represents data type "test/unregistered", which no component registers',
        sourceId: 'schema.prisma',
        span: SPAN,
      },
    ]);
  });

  it('an unknown codec id is reported', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({ name: 'Role', values: { admin: 'admin' }, typeCodecId: 'nope/missing@1' }),
      makeContext(diagnostics),
    );

    expect(handle).toBeUndefined();
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_EXTENSION_INVALID_VALUE',
        message: expect.stringContaining('unknown codec'),
      }),
    ]);
  });

  it('collides on DECODED values, not raw literals', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({
        name: 'Folded',
        values: { first: 'Admin', second: 'admin' },
        typeCodecId: FOLDING_CODEC_ID,
      }),
      makeContext(diagnostics),
    );

    expect(handle).toBeUndefined();
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_ENUM_DUPLICATE_MEMBER_VALUE',
        message: expect.stringContaining('"admin"'),
      }),
    ]);
  });

  it('collides on the values the contract stores, naming both members', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({
        name: 'Folded',
        values: { first: 'Admin', second: 'admin' },
        typeCodecId: ENCODE_FOLDING_CODEC_ID,
      }),
      makeContext(diagnostics),
    );

    expect(handle).toBeUndefined();
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_ENUM_DUPLICATE_MEMBER_VALUE',
        message: 'enum "Folded": members "first" and "second" both store "admin"',
      }),
    ]);
  });

  it('an explicit-codec empty enum is reported as missing members', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({ name: 'Empty', values: {}, typeCodecId: TEXT_CODEC_ID }),
      makeContext(diagnostics),
    );

    expect(handle).toBeUndefined();
    expect(diagnostics).toEqual([expect.objectContaining({ code: 'PSL_ENUM_MISSING_TYPE' })]);
  });
});

describe('mongoFamilyEnumEntityDescriptor: a codec without exactly one storage type', () => {
  it.each([
    ['mongo/json@1', 8],
    ['mongo/bson@1', 0],
  ])('refuses @@type("%s"), which declares %i BSON types', (codecId, count) => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({ name: 'Shape', values: { a: undefined }, typeCodecId: codecId }),
      makeContext(diagnostics),
    );

    expect(handle).toBeUndefined();
    expect(diagnostics).toEqual([
      expect.objectContaining({
        message: `enum "Shape" @@type codec "${codecId}" declares ${count} BSON types; an enum needs exactly one. Use a codec with one BSON type, such as mongo/string@1.`,
        span: SPAN,
      }),
    ]);
  });
});

describe('mongoFamilyEnumEntityDescriptor: a codec internal error', () => {
  it.each([
    ['a member with a value', { low: 'low' }],
    ['a bare member', { low: undefined }],
  ])('passes through for %s, instead of becoming a diagnostic', (_label, values) => {
    const diagnostics: unknown[] = [];
    expect(() =>
      factory(
        enumBlock({ name: 'Level', values, typeCodecId: BROKEN_CODEC_ID }),
        makeContext(diagnostics),
      ),
    ).toThrow(InternalError);
    expect(diagnostics).toEqual([]);
  });
});
