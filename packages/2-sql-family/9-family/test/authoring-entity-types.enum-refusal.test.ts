import type { AuthoringEntityContext } from '@internal/framework-components/authoring';
import type { AnyCodecDescriptor } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import {
  CODEC_ARG_SPAN,
  enumBlock,
  factory,
  jsonCodec,
  jsonType,
  makeContext,
  ORPHAN_CODEC_ID,
  testCodecLookup,
  textCodec,
  textType,
  VECTOR_CODEC_ID,
} from './enum-entity-fixtures';

describe('sqlFamilyEnumEntityDescriptor: a codec an enum cannot use', () => {
  it("a codec whose descriptor says an enum cannot use it is reported with the descriptor's reason", () => {
    const PRINTED_CODEC_ID = 'test/printed-text@1';
    const diagnostics: unknown[] = [];
    const context: AuthoringEntityContext = {
      ...makeContext(diagnostics),
      codecLookup: {
        ...testCodecLookup,
        get: (id) => (id === PRINTED_CODEC_ID ? textCodec : testCodecLookup.get(id)),
        descriptorFor: (id) =>
          id === PRINTED_CODEC_ID
            ? ({
                codecId: id,
                dataType: textType.id,
                traits: ['equality'],
                enumRefusal: 'A query reads its values as text the contract does not store.',
              } as unknown as AnyCodecDescriptor)
            : testCodecLookup.descriptorFor(id),
      },
    };
    const handle = factory(
      enumBlock({
        name: 'Stamp',
        values: { start: '2024-01-02T03:04:05' },
        typeCodecId: PRINTED_CODEC_ID,
      }),
      context,
    );

    expect({ handle, diagnostics }).toEqual({
      handle: undefined,
      diagnostics: [
        {
          code: 'PSL_EXTENSION_INVALID_VALUE',
          message:
            'enum "Stamp" cannot use the codec "test/printed-text@1". A query reads its values as text the contract does not store.',
          sourceId: 'schema.prisma',
          span: CODEC_ARG_SPAN,
        },
      ],
    });
  });

  it('a codec that does not declare the equality trait is reported, saying so', () => {
    const UNEQUAL_CODEC_ID = 'test/unequal@1';
    const diagnostics: unknown[] = [];
    const context: AuthoringEntityContext = {
      ...makeContext(diagnostics),
      codecLookup: {
        ...testCodecLookup,
        get: (id) => (id === UNEQUAL_CODEC_ID ? jsonCodec : testCodecLookup.get(id)),
        descriptorFor: (id) =>
          id === UNEQUAL_CODEC_ID
            ? ({ codecId: id, dataType: jsonType.id, traits: [] } as unknown as AnyCodecDescriptor)
            : testCodecLookup.descriptorFor(id),
      },
    };
    const handle = factory(
      enumBlock({ name: 'Shape', values: { round: 'round' }, typeCodecId: UNEQUAL_CODEC_ID }),
      context,
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

  it('refuses a codec whose data type requires a parameter, naming it', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({ name: 'Axis', values: { x: 'x' }, typeCodecId: VECTOR_CODEC_ID }),
      makeContext(diagnostics),
    );

    expect(handle).toBeUndefined();
    expect(diagnostics).toEqual([
      {
        code: 'PSL_ENUM_TYPE_NEEDS_PARAMETERS',
        message:
          'enum "Axis" @@type codec "test/vector@1" represents data type "test/vector", which requires the parameter "length"; an enum block gives it none',
        sourceId: 'schema.prisma',
        span: CODEC_ARG_SPAN,
      },
    ]);
  });

  it('reports a known codec whose data type no component registers', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({ name: 'Role', values: { admin: 'admin' }, typeCodecId: ORPHAN_CODEC_ID }),
      makeContext(diagnostics),
    );

    expect(handle).toBeUndefined();
    expect(diagnostics).toEqual([
      {
        code: 'PSL_EXTENSION_INVALID_VALUE',
        message:
          'enum "Role" @@type codec "test/orphan@1" represents data type "test/unregistered", which no component registers',
        sourceId: 'schema.prisma',
        span: CODEC_ARG_SPAN,
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
});
