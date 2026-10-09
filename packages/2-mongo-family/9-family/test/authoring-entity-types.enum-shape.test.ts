import type { JsonValue } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import {
  ARRAY_CODEC_ID,
  enumBlock,
  factory,
  LENIENT_OBJECT_CODEC_ID,
  makeContext,
  SPAN,
} from './enum-entity-fixtures';

function authorEnum(codecId: string, values: Record<string, JsonValue>) {
  const diagnostics: unknown[] = [];
  const handle = factory(
    enumBlock({ name: 'Shape', values, typeCodecId: codecId }),
    makeContext(diagnostics),
  );
  return { handle, diagnostics };
}

describe('mongoFamilyEnumEntityDescriptor: a member stored in the shape of its BSON type', () => {
  it('accepts JSON objects on an object enum and JSON arrays on an array enum', () => {
    expect({
      object: authorEnum(LENIENT_OBJECT_CODEC_ID, {
        round: { sides: 0 },
        square: { sides: 4 },
      }),
      array: authorEnum(ARRAY_CODEC_ID, { pair: [1, 2], triple: [1, 2, 3] }),
    }).toEqual({
      object: {
        handle: expect.objectContaining({
          codecId: LENIENT_OBJECT_CODEC_ID,
          members: { round: { sides: 0 }, square: { sides: 4 } },
        }),
        diagnostics: [],
      },
      array: {
        handle: expect.objectContaining({
          codecId: ARRAY_CODEC_ID,
          members: { pair: [1, 2], triple: [1, 2, 3] },
        }),
        diagnostics: [],
      },
    });
  });

  it('refuses two object members stored as the same object, at the later member', () => {
    expect(
      authorEnum(LENIENT_OBJECT_CODEC_ID, {
        wide: { width: 2, height: 1 },
        alsoWide: { height: 1, width: 2 },
      }),
    ).toEqual({
      handle: undefined,
      diagnostics: [
        {
          code: 'PSL_ENUM_DUPLICATE_MEMBER_VALUE',
          message: 'enum "Shape": members "wide" and "alsoWide" both store {"height":1,"width":2}',
          sourceId: 'schema.prisma',
          span: SPAN,
        },
      ],
    });
  });

  it.each([
    [LENIENT_OBJECT_CODEC_ID, 'object', [1, 2], '[1,2]', 'a JSON object'],
    [LENIENT_OBJECT_CODEC_ID, 'object', null, 'null', 'a JSON object'],
    [ARRAY_CODEC_ID, 'array', { sides: 0 }, '{"sides":0}', 'a JSON array'],
    [ARRAY_CODEC_ID, 'array', null, 'null', 'a JSON array'],
  ] as const)(
    'refuses on %s a member stored as %s %s',
    (codecId, bsonType, value, written, shape) => {
      expect(authorEnum(codecId, { odd: value })).toEqual({
        handle: undefined,
        diagnostics: [
          {
            code: 'PSL_EXTENSION_INVALID_VALUE',
            message: `enum "Shape" member "odd" is stored as ${written}, which a collection validator cannot list as a ${bsonType}. A member of a ${bsonType} enum must be ${shape}.`,
            sourceId: 'schema.prisma',
            span: SPAN,
          },
        ],
      });
    },
  );
});
