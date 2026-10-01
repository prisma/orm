import type { JsonValue } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import type { Codec } from '../src/shared/codec';
import { readEnumBlockMembers } from '../src/shared/enum-block-members';
import type { ParsedPslExtensionBlock } from '../src/shared/psl-extension-block';

const SPAN = {
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 0, line: 1, column: 1 },
};

function enumBlock(
  values: Record<string, JsonValue | undefined>,
): ParsedPslExtensionBlock<Readonly<Record<string, JsonValue | undefined>>> {
  return {
    kind: 'enum',
    keyword: 'enum',
    name: 'Key',
    values,
    parameterSpans: Object.fromEntries(Object.keys(values).map((key) => [key, SPAN])),
    attributes: {},
    span: SPAN,
  };
}

/** Reads any text unchanged and stores it in lower case, so two members can differ as read and store the same value. */
const lowerCasingCodec: Codec = {
  id: 'test/lower-casing@1',
  encode: async (v: unknown) => v,
  decode: async (w: unknown) => w,
  encodeJson: (value) => String(value).toLowerCase(),
  decodeJson(json) {
    if (typeof json !== 'string') throw new Error(`expected text, got ${typeof json}`);
    return json;
  },
};

function read(values: Record<string, JsonValue | undefined>, codec: Codec = lowerCasingCodec) {
  const diagnostics: unknown[] = [];
  const members = readEnumBlockMembers(enumBlock(values), codec.id, codec, {
    family: 'test',
    target: 'test',
    sourceId: 'schema.prisma',
    diagnostics: { push: (d) => diagnostics.push(d) },
  });
  return { members, diagnostics };
}

describe('readEnumBlockMembers', () => {
  it('reads each member as its codec reads it, and a bare member from its name', () => {
    expect(read({ A: 'A0EE', B: '{b0ee}', c: undefined })).toEqual({
      members: [
        { name: 'A', value: 'A0EE' },
        { name: 'B', value: '{b0ee}' },
        { name: 'c', value: 'c' },
      ],
      diagnostics: [],
    });
  });

  it('refuses two members that store the same value, naming both', () => {
    expect(read({ Upper: 'A0EE', Lower: 'a0ee' })).toEqual({
      members: undefined,
      diagnostics: [
        {
          code: 'PSL_ENUM_DUPLICATE_MEMBER_VALUE',
          message: 'enum "Key": members "Upper" and "Lower" both store "a0ee"',
          sourceId: 'schema.prisma',
          span: SPAN,
        },
      ],
    });
  });

  it('reports a member the codec refuses', () => {
    expect(read({ A: 1 })).toEqual({
      members: undefined,
      diagnostics: [
        {
          code: 'PSL_EXTENSION_INVALID_VALUE',
          message:
            'enum "Key" member "A" was rejected by codec "test/lower-casing@1": expected text, got number',
          sourceId: 'schema.prisma',
          span: SPAN,
        },
      ],
    });
  });

  it('lets an error from storing a member it has read propagate, because that is a codec bug', () => {
    const failure = new TypeError('codec bug');
    const codec: Codec = {
      ...lowerCasingCodec,
      encodeJson: () => {
        throw failure;
      },
    };
    expect(() =>
      readEnumBlockMembers(enumBlock({ A: 'a' }), 'test/lower-casing@1', codec, {
        family: 'test',
        target: 'test',
      }),
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
