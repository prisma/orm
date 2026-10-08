import { dataType } from '@internal/framework-components/codec';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import { describe, expect, it } from 'vitest';
import { sqlTypeLookupsOf } from '../src/core/migrations/sql-type-lookups';

const instant = dataType('demo/instant', {
  read: (json) => json,
  toCanonicalForm: (value) => value,
});
const point = dataType('geo/point', { read: (json) => json });

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

describe('sqlTypeLookupsOf', () => {
  const types = sqlTypeLookupsOf([
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
  const resolve = (codecId: string) => {
    const dataTypeId = types.codecLookup.descriptorFor(codecId)?.dataType;
    return dataTypeId === undefined ? undefined : types.dataTypeLookup.get(dataTypeId);
  };

  it("finds the data type a codec's descriptor names, among every component's data types", () => {
    expect({
      targetCodec: resolve('demo/instant-text@1'),
      packCodecOfATargetType: resolve('geo/instant@1'),
      packCodecOfItsOwnType: resolve('geo/point@1'),
    }).toEqual({
      targetCodec: instant,
      packCodecOfATargetType: instant,
      packCodecOfItsOwnType: point,
    });
  });

  it('finds nothing for a codec no component contributes', () => {
    expect(resolve('demo/unknown@1')).toBeUndefined();
  });

  it('refuses a codec id that two components contribute', () => {
    expect(() =>
      sqlTypeLookupsOf([
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
});
