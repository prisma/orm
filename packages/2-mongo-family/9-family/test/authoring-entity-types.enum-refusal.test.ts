import { describe, expect, it } from 'vitest';
import {
  CODEC_ARG_SPAN,
  enumBlock,
  factory,
  makeContext,
  UNEQUAL_CODEC_ID,
} from './enum-entity-fixtures';

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
        span: CODEC_ARG_SPAN,
      }),
    ]);
  });
});

describe('mongoFamilyEnumEntityDescriptor: a codec an enum cannot use', () => {
  it('refuses a codec that does not declare the equality trait, saying so', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({ name: 'Shape', values: { round: 'round' }, typeCodecId: UNEQUAL_CODEC_ID }),
      makeContext(diagnostics),
    );

    expect({ handle, diagnostics }).toEqual({
      handle: undefined,
      diagnostics: [
        {
          code: 'PSL_EXTENSION_INVALID_VALUE',
          message:
            'enum "Shape" cannot use the codec "test/unequal@1". The codec does not declare the equality trait, so no value can be compared with a member. Use a codec that declares it.',
          sourceId: 'schema.prisma',
          span: CODEC_ARG_SPAN,
        },
      ],
    });
  });
});
