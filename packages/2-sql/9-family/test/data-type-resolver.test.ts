import { dataType } from '@internal/framework-components/codec';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import { describe, expect, it } from 'vitest';
import { buildDataTypeResolver } from '../src/core/migrations/data-type-resolver';

const instant = dataType('demo/instant', { toCanonicalForm: (value) => value });
const point = dataType('geo/point', {});

function component(
  id: string,
  parts: {
    readonly dataTypes?: readonly ReturnType<typeof dataType>[];
    readonly codecs?: readonly { readonly codecId: string; readonly dataType: string }[];
  },
): TargetBoundComponentDescriptor<'sql', string> {
  return {
    kind: 'extension',
    id,
    familyId: 'sql',
    targetId: 'demo',
    version: '0.0.0',
    ...(parts.dataTypes === undefined ? {} : { dataTypes: parts.dataTypes }),
    ...(parts.codecs === undefined
      ? {}
      : {
          types: {
            codecTypes: {
              codecDescriptors: parts.codecs.map((codec) => ({
                ...codec,
                isParameterized: false,
                factory: () => () => ({ id: codec.codecId }),
              })),
            },
          },
        }),
  } as unknown as TargetBoundComponentDescriptor<'sql', string>;
}

describe('buildDataTypeResolver', () => {
  const resolve = buildDataTypeResolver([
    component('demo-adapter', {
      dataTypes: [instant],
      codecs: [{ codecId: 'demo/instant-text@1', dataType: 'demo/instant' }],
    }),
    component('geo', {
      dataTypes: [point],
      codecs: [
        { codecId: 'geo/point@1', dataType: 'geo/point' },
        { codecId: 'geo/instant@1', dataType: 'demo/instant' },
      ],
    }),
  ]);

  it("finds the data type a codec's descriptor names, among every component's data types", () => {
    expect({
      targetCodec: resolve?.('demo/instant-text@1'),
      packCodecOfATargetType: resolve?.('geo/instant@1'),
      packCodecOfItsOwnType: resolve?.('geo/point@1'),
    }).toEqual({
      targetCodec: instant,
      packCodecOfATargetType: instant,
      packCodecOfItsOwnType: point,
    });
  });

  it('finds nothing for a codec no component contributes', () => {
    expect(resolve?.('demo/unknown@1')).toBeUndefined();
  });

  it('refuses a codec id that two components contribute', () => {
    expect(() =>
      buildDataTypeResolver([
        component('demo-adapter', {
          dataTypes: [instant],
          codecs: [{ codecId: 'demo/instant-text@1', dataType: 'demo/instant' }],
        }),
        component('geo', {
          codecs: [{ codecId: 'demo/instant-text@1', dataType: 'demo/instant' }],
        }),
      ]),
    ).toThrow(
      'Duplicate codec descriptor for codecId "demo/instant-text@1". Descriptor "geo" conflicts with "demo-adapter".',
    );
  });

  it('is absent when no components are given', () => {
    expect(buildDataTypeResolver(undefined)).toBeUndefined();
  });
});
