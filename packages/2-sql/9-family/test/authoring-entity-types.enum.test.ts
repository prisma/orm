import type {
  AuthoringDiagnosticSink,
  AuthoringEntityContext,
  PslExtensionBlock,
  PslExtensionBlockParamValue,
} from '@internal/framework-components/authoring';
import type { Codec, CodecLookup } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { sqlFamilyEnumEntityDescriptor } from '../src/core/authoring-entity-types';

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

const PG_TEXT_CODEC_ID = 'pg/text@1';
const PG_INT_CODEC_ID = 'pg/int@1';

const pgTextCodec: Codec = {
  id: PG_TEXT_CODEC_ID,
  encode: async (v: unknown) => v,
  decode: async (w: unknown) => w,
  encodeJson: (value) => value as never,
  decodeJson(json) {
    if (typeof json !== 'string') throw new Error(`expected string, got ${typeof json}`);
    return json;
  },
};

const pgIntCodec: Codec = {
  id: PG_INT_CODEC_ID,
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
    if (id === PG_TEXT_CODEC_ID) return pgTextCodec;
    if (id === PG_INT_CODEC_ID) return pgIntCodec;
    return undefined;
  },
  targetTypesFor(id: string): readonly string[] | undefined {
    if (id === PG_TEXT_CODEC_ID) return ['text'];
    if (id === PG_INT_CODEC_ID) return ['int'];
    return undefined;
  },
  renderOutputTypeFor: () => undefined,
};

function makeContext(diagnostics: unknown[]): AuthoringEntityContext {
  const sink: AuthoringDiagnosticSink = {
    push: (d) => diagnostics.push(d),
  };
  return {
    family: 'sql',
    target: 'postgres',
    codecLookup: testCodecLookup,
    sourceId: 'schema.prisma',
    diagnostics: sink,
    enumInferenceCodecs: { text: PG_TEXT_CODEC_ID, int: PG_INT_CODEC_ID },
  };
}

const factory = sqlFamilyEnumEntityDescriptor.output.factory;

describe('sqlFamilyEnumEntityDescriptor: @@type omitted, inferred from members', () => {
  it('bare members infer the text codec', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({ name: 'Role', parameters: { admin: bareMember(), user: bareMember() } }),
      makeContext(diagnostics),
    );

    expect(diagnostics).toEqual([]);
    expect(handle).toMatchObject({
      codecId: PG_TEXT_CODEC_ID,
      nativeType: 'text',
      members: { admin: 'admin', user: 'user' },
    });
  });

  it('string-value members infer the text codec', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({
        name: 'Role',
        parameters: { admin: valueMember('"admin"'), user: valueMember('"user"') },
      }),
      makeContext(diagnostics),
    );

    expect(diagnostics).toEqual([]);
    expect(handle).toMatchObject({
      codecId: PG_TEXT_CODEC_ID,
      nativeType: 'text',
      members: { admin: 'admin', user: 'user' },
    });
  });

  it('a mix of bare and string-value members still infers the text codec', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({
        name: 'Role',
        parameters: { admin: bareMember(), user: valueMember('"user"') },
      }),
      makeContext(diagnostics),
    );

    expect(diagnostics).toEqual([]);
    expect(handle).toMatchObject({ codecId: PG_TEXT_CODEC_ID, nativeType: 'text' });
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
      codecId: PG_INT_CODEC_ID,
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

  it('a boolean member cannot be inferred', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({ name: 'Flag', parameters: { on: valueMember('true') } }),
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

  it('the diagnostic names the enum and suggests an explicit @@type', () => {
    const diagnostics: { code: string; message: string }[] = [];
    factory(
      enumBlock({ name: 'Priority', parameters: { low: valueMember('1.5') } }),
      makeContext(diagnostics),
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_ENUM_CANNOT_INFER_TYPE',
        message: expect.stringMatching(/Priority/),
      }),
    ]);
    expect(diagnostics[0]?.message).toMatch(/@@type/);
  });
});

describe('sqlFamilyEnumEntityDescriptor: explicit @@type is unchanged', () => {
  it('an explicit @@type is used verbatim, skipping inference entirely', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({
        name: 'Priority',
        parameters: { low: valueMember('1.5') },
        typeCodecId: PG_TEXT_CODEC_ID,
      }),
      makeContext(diagnostics),
    );

    // A float member would fail inference, but an explicit @@type("pg/text@1")
    // bypasses the classifier and hits the codec's own decodeJson instead.
    expect(diagnostics).toEqual([expect.objectContaining({ code: 'PSL_EXTENSION_INVALID_VALUE' })]);
    expect(handle).toBeUndefined();
  });

  it('an explicit @@type resolving to text lowers exactly as before', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({
        name: 'Role',
        parameters: { admin: valueMember('"admin"') },
        typeCodecId: PG_TEXT_CODEC_ID,
      }),
      makeContext(diagnostics),
    );

    expect(diagnostics).toEqual([]);
    expect(handle).toMatchObject({ codecId: PG_TEXT_CODEC_ID, nativeType: 'text' });
  });
});
