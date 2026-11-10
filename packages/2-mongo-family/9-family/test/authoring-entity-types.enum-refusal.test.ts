import { describe, expect, it } from 'vitest';
import {
  CODEC_ARG_SPAN,
  enumBlock,
  factory,
  makeContext,
  UNEQUAL_CODEC_ID,
  UNEQUAL_MANY_BSON_TYPES_CODEC_ID,
} from './enum-entity-fixtures';

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

describe('mongoFamilyEnumEntityDescriptor: a codec both checks refuse', () => {
  it("reports the codec's own reason, not the BSON types a collection validator cannot list", () => {
    const diagnostics: unknown[] = [];
    factory(
      enumBlock({
        name: 'Shape',
        values: { round: 'round' },
        typeCodecId: UNEQUAL_MANY_BSON_TYPES_CODEC_ID,
      }),
      makeContext(diagnostics),
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        message: `enum "Shape" cannot use the codec "${UNEQUAL_MANY_BSON_TYPES_CODEC_ID}". The codec does not declare the equality trait, so no value can be compared with a member. Use a codec that declares it.`,
      }),
    ]);
  });
});
