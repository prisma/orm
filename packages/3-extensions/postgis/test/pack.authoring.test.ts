import {
  instantiateAuthoringTypeConstructor,
  validateAuthoringTypeParams,
} from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { postgisGeometryDescriptor } from '../src/core/codecs';
import postgisPack from '../src/exports/pack';

describe('postgis pack authoring contributions', () => {
  it('exposes a namespaced postgis.Geometry type constructor', () => {
    expect(postgisPack.authoring?.type).toMatchObject({
      postgis: {
        Geometry: {
          kind: 'typeConstructor',
          args: [{ kind: 'number', name: 'srid', integer: true, optional: true }],
          output: {
            codecId: 'pg/geometry@1',
            typeParams: { srid: { kind: 'arg', index: 0 } },
          },
        },
      },
    });
  });

  describe('postgis.Geometry arguments are bounded by the data type', () => {
    const descriptor = postgisPack.authoring.type.postgis.Geometry;
    const check = (args: readonly number[]) => {
      const output = instantiateAuthoringTypeConstructor(descriptor, args);
      validateAuthoringTypeParams(
        'postgis.Geometry',
        descriptor.output,
        output.typeParams,
        postgisGeometryDescriptor.paramsSchema,
      );
    };

    it.each([[0]])('refuses %s', (...args) => {
      expect(() => check(args)).toThrow(
        expect.objectContaining({ code: 'CONTRACT.ARGUMENT_INVALID' }),
      );
    });

    it.each([[1], [4326]])('accepts %s', (...args) => {
      expect(() => check(args)).not.toThrow();
    });

    it('accepts no srid', () => {
      expect(() => check([])).not.toThrow();
    });
  });
});
