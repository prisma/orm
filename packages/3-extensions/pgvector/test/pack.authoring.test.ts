import {
  instantiateAuthoringTypeConstructor,
  validateAuthoringTypeParams,
} from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { pgVectorDescriptor } from '../src/core/codecs';
import pgvectorPack from '../src/exports/pack';

describe('pgvector pack authoring contributions', () => {
  it('exposes a namespaced pgvector.Vector type constructor', () => {
    expect(pgvectorPack.authoring?.type).toMatchObject({
      pgvector: {
        Vector: {
          kind: 'typeConstructor',
          args: [{ kind: 'number', name: 'length', integer: true }],
          output: {
            codecId: 'pg/vector@1',
            typeParams: {
              length: {
                kind: 'arg',
                index: 0,
              },
            },
          },
        },
      },
    });
  });

  describe('pgvector.Vector arguments are bounded by the data type', () => {
    const descriptor = pgvectorPack.authoring.type.pgvector.Vector;
    const check = (args: readonly number[]) => {
      const output = instantiateAuthoringTypeConstructor(descriptor, args);
      validateAuthoringTypeParams(
        'pgvector.Vector',
        descriptor.output,
        output.typeParams,
        pgVectorDescriptor.paramsSchema,
      );
    };

    it.each([[0], [16001]])('refuses %s', (...args) => {
      expect(() => check(args)).toThrow(
        expect.objectContaining({ code: 'CONTRACT.ARGUMENT_INVALID' }),
      );
    });

    it.each([[1], [16000]])('accepts %s', (...args) => {
      expect(() => check(args)).not.toThrow();
    });
  });
});
