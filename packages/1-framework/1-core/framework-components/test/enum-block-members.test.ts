import type { JsonValue } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import type { Codec } from '../src/shared/codec';
import type { CodecDescriptor } from '../src/shared/codec-descriptor';
import { emptyCodecLookup } from '../src/shared/codec-types';
import { createDataTypeLookup, dataType } from '../src/shared/data-type';
import { readEnumBlockMembers } from '../src/shared/enum-block-members';
import type {
  AuthoringEntityContext,
  DataTypeAuthoringEntry,
} from '../src/shared/framework-authoring';
import type { ParsedPslExtensionBlock } from '../src/shared/psl-extension-block';
import type { DataTypeSupport, WrittenValue } from '../src/shared/written-value';

const SPAN = {
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 0, line: 1, column: 1 },
};

/** Where the member at `index` is written: line `index + 2`, distinct from the block and every other member. */
function memberSpan(index: number) {
  return {
    start: { offset: 10 * (index + 1), line: index + 2, column: 3 },
    end: { offset: 10 * (index + 1) + 5, line: index + 2, column: 8 },
  };
}

function enumBlock(
  values: Record<string, JsonValue | undefined>,
  writtenValues?: Record<string, WrittenValue>,
): ParsedPslExtensionBlock<Readonly<Record<string, JsonValue | undefined>>> {
  return {
    kind: 'enum',
    keyword: 'enum',
    name: 'Key',
    values,
    parameterSpans: Object.fromEntries(
      Object.keys(values).map((key, index) => [key, memberSpan(index)]),
    ),
    ...(writtenValues === undefined ? {} : { writtenValues }),
    attributes: {},
    span: SPAN,
  };
}

const textType = dataType('test/text', {
  read(json) {
    if (typeof json !== 'string') throw new Error(`expected text, got ${typeof json}`);
    return json;
  },
});

/** Reads any text unchanged and stores it in lower case, so two members can differ as read and store the same value; refuses the text "forbidden". */
const lowerCasingCodec: Codec = {
  id: 'test/lower-casing@1',
  dataType: textType,
  toWire: async (v: unknown) => v,
  fromWire: async (w: unknown) => w,
  toDataTypeValue: (value) => textType.valueFrom(String(value).toLowerCase(), {}),
  fromDataTypeValue: (value) => {
    if (value.value === 'forbidden') throw new Error('"forbidden" is not a key');
    return value.value;
  },
};

const digitsType = dataType('test/digits', {
  read(json) {
    if (typeof json !== 'string' || !/^-?\d+$/.test(json)) throw new Error('expected digits');
    return json;
  },
});

/** Keeps a whole number as its digit text, as a 64-bit integer codec does. */
const digitsCodec: Codec = {
  id: 'test/digits@1',
  dataType: digitsType,
  toWire: async (v: unknown) => v,
  fromWire: async (w: unknown) => w,
  toDataTypeValue: (value) => digitsType.valueFrom(String(value), {}),
  fromDataTypeValue: (value) => value.value,
};

const entries: Readonly<Record<string, DataTypeAuthoringEntry>> = {
  [textType.id]: {
    written: { kind: 'plain', syntax: 'string', parse: (value) => value },
    print: (value) => String(value),
    documentation: 'Text.',
  },
  [digitsType.id]: {
    written: {
      kind: 'plain',
      syntax: 'number',
      types: [digitsType.id],
      classify: (value) => (/^-?\d+$/.test(value) ? { type: digitsType.id, value } : undefined),
    },
    print: (value) => String(value),
    documentation: 'A whole number.',
  },
};

const dataTypes: DataTypeSupport = {
  entries,
  lookup: createDataTypeLookup([textType, digitsType]),
  dataTypeOfCodec: () => undefined,
};

function descriptorOf(codec: Codec): CodecDescriptor<void> {
  return {
    codecId: codec.id,
    dataType: codec.dataType.id,
    traits: ['equality'],
    paramsSchema: undefined,
    isParameterized: false,
    factory: () => () => codec,
  };
}

function contextFor(codec: Codec, diagnostics: unknown[] = []): AuthoringEntityContext {
  return {
    family: 'test',
    target: 'test',
    codecLookup: {
      ...emptyCodecLookup,
      descriptorFor: (id) => (id === codec.id ? descriptorOf(codec) : undefined),
    },
    dataTypes,
    sourceId: 'schema.prisma',
    diagnostics: { push: (d) => diagnostics.push(d) },
  };
}

function read(
  values: Record<string, JsonValue | undefined>,
  writtenValues?: Record<string, WrittenValue>,
  codec: Codec = lowerCasingCodec,
) {
  const diagnostics: unknown[] = [];
  const members = readEnumBlockMembers(
    enumBlock(values, writtenValues),
    codec.id,
    codec,
    contextFor(codec, diagnostics),
  );
  return { members, diagnostics };
}

describe('readEnumBlockMembers', () => {
  it('reads each member as it is written, and a bare member from its name, as text', () => {
    expect(
      read(
        { A: 'A0EE', B: '{b0ee}', c: undefined },
        { A: { kind: 'string', text: 'A0EE' }, B: { kind: 'string', text: '{b0ee}' } },
      ),
    ).toEqual({
      members: [
        { name: 'A', value: 'A0EE' },
        { name: 'B', value: '{b0ee}' },
        { name: 'c', value: 'c' },
      ],
      diagnostics: [],
    });
  });

  it('throws for a member with a value the block holds no written value for, because the block reader records every value', () => {
    expect(() => read({ Low: 'low' })).toThrow(
      expect.objectContaining({
        name: 'InternalError',
        message:
          'enum "Key" member "Low" has a value, but the block holds no written value for it.',
      }),
    );
  });

  it('keeps every digit of a number member, read from its source text', () => {
    expect(
      read(
        { Big: 9007199254740992 },
        { Big: { kind: 'number', text: '9007199254740993' } },
        digitsCodec,
      ),
    ).toEqual({ members: [{ name: 'Big', value: '9007199254740993' }], diagnostics: [] });
  });

  it('refuses two members that store the same value, naming both, at the later member', () => {
    expect(
      read(
        { Upper: 'A0EE', Other: 'b0ee', Lower: 'a0ee' },
        {
          Upper: { kind: 'string', text: 'A0EE' },
          Other: { kind: 'string', text: 'b0ee' },
          Lower: { kind: 'string', text: 'a0ee' },
        },
      ),
    ).toEqual({
      members: undefined,
      diagnostics: [
        {
          code: 'PSL_ENUM_DUPLICATE_MEMBER_VALUE',
          message: 'enum "Key": members "Upper" and "Lower" both store "a0ee"',
          sourceId: 'schema.prisma',
          span: memberSpan(2),
        },
      ],
    });
  });

  it('reports a member the codec refuses, at the member', () => {
    expect(read({ A: 'forbidden' }, { A: { kind: 'string', text: 'forbidden' } })).toEqual({
      members: undefined,
      diagnostics: [
        {
          code: 'PSL_VALUE_REFUSED',
          message: 'enum "Key" member "A": "forbidden" is not a key',
          sourceId: 'schema.prisma',
          span: memberSpan(0),
        },
      ],
    });
  });

  it("reports a member written in a form the codec's data type does not take, at the member", () => {
    expect(read({ A: 1 }, { A: { kind: 'number', text: '1' } })).toEqual({
      members: undefined,
      diagnostics: [
        {
          code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
          message: 'enum "Key" member "A": Expected a quoted string',
          sourceId: 'schema.prisma',
          span: memberSpan(0),
        },
      ],
    });
  });

  it('reports a bare member the codec does not take as a bare member', () => {
    expect(read({ Low: undefined }, {}, digitsCodec)).toEqual({
      members: undefined,
      diagnostics: [
        {
          code: 'PSL_ENUM_BARE_MEMBER_NON_STRING_CODEC',
          message:
            'enum "Key" member "Low" has no value and codec "test/digits@1" does not accept a bare name as input',
          sourceId: 'schema.prisma',
          span: memberSpan(0),
        },
      ],
    });
  });

  it('lets an error from storing a member it has read propagate, because that is a codec bug', () => {
    const failure = new TypeError('codec bug');
    const codec: Codec = {
      ...lowerCasingCodec,
      toDataTypeValue: () => {
        throw failure;
      },
    };
    expect(() =>
      readEnumBlockMembers(enumBlock({ A: undefined }), codec.id, codec, contextFor(codec)),
    ).toThrow(failure);
  });

  it('reports an enum with no members', () => {
    expect(read({})).toEqual({
      members: undefined,
      diagnostics: [
        {
          code: 'PSL_ENUM_MISSING_TYPE',
          message: 'enum "Key" must have at least one member',
          sourceId: 'schema.prisma',
          span: SPAN,
        },
      ],
    });
  });
});
