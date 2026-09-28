import { defineContract } from '@internal/postgres/contract-builder';
import { describe, expect, it } from 'vitest';
import { vector } from '../src/exports/column-types';
import pgvector from '../src/exports/pack';

function embeddingDefault(literal: number[], form: 'namedType' | 'column'): unknown {
  const contract = defineContract({ extensions: { pgvector } }, ({ field, model, type }) => {
    const types = { Embedding: type.pgvector.Vector(3) };
    const embedding =
      form === 'namedType' ? field.namedType(types.Embedding) : field.column(vector(3));
    return {
      types,
      models: {
        Doc: model('Doc', {
          fields: { id: field.id.uuidv4String(), embedding: embedding.default(literal) },
        }),
      },
    };
  });
  return contract.storage.namespaces['public']?.entries.table?.['Doc']?.columns['embedding']
    ?.default;
}

const lengthRefusal = expect.objectContaining({
  code: 'CONTRACT.DEFAULT_INVALID',
  message:
    'Field "Doc.embedding" has a default that its codec refuses: Vector length mismatch: expected 3, got 2',
  meta: {
    modelName: 'Doc',
    fieldName: 'embedding',
    codecId: 'pg/vector@1',
    reason: 'codec-refused-default',
  },
});

describe('literal defaults on a codec contributed through extensions', () => {
  describe('on a named type with type parameters', () => {
    it('stores a vector of the declared length', () => {
      expect(embeddingDefault([1, 2, 3], 'namedType')).toEqual({
        kind: 'literal',
        value: [1, 2, 3],
      });
    });

    it('refuses a vector of another length', () => {
      expect(() => embeddingDefault([1, 2], 'namedType')).toThrow(lengthRefusal);
    });
  });

  describe('on a plain column', () => {
    it('stores a vector of the declared length', () => {
      expect(embeddingDefault([1, 2, 3], 'column')).toEqual({ kind: 'literal', value: [1, 2, 3] });
    });

    it('refuses a vector of another length', () => {
      expect(() => embeddingDefault([1, 2], 'column')).toThrow(lengthRefusal);
    });
  });

  describe('on a column whose type parameters the codec does not accept', () => {
    it('reports the type parameters, not the default', () => {
      expect(() =>
        defineContract({ extensions: { pgvector } }, ({ field, model }) => ({
          models: {
            Doc: model('Doc', {
              fields: {
                id: field.id.uuidv4String(),
                embedding: field
                  .column({ codecId: 'pg/vector@1', nativeType: 'vector' } as const)
                  .default([1, 2, 3]),
              },
            }),
          },
        })),
      ).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.ARGUMENT_INVALID',
          message:
            'Field "Doc.embedding" has type parameters that its codec does not accept: Invalid typeParams for codec \'pg/vector@1\': length must be a number (was missing)',
          meta: {
            modelName: 'Doc',
            fieldName: 'embedding',
            codecId: 'pg/vector@1',
            reason: 'type-params-invalid',
          },
          cause: expect.objectContaining({ code: 'RUNTIME.TYPE_PARAMS_INVALID' }),
        }),
      );
    });
  });
});
