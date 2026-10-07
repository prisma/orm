import { defineContract } from '@internal/postgres/contract-builder';
import { describe, expect, it } from 'vitest';
import { vector } from '../src/exports/column-types';
import pgvector from '../src/exports/pack';

function buildWithEmbedding(length: number) {
  return defineContract({ extensions: { pgvector } }, ({ field, model }) => ({
    models: {
      Doc: model('Doc', {
        fields: { id: field.id.uuidv4String(), embedding: field.column(vector(length)) },
      }),
    },
  }));
}

describe('vector column type parameters', () => {
  it('vector(0) fails when the contract is built', () => {
    expect(() => buildWithEmbedding(0)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.TYPE_PARAMS_INVALID',
        meta: {
          dataType: 'pgvector/vector',
          parameters: ['length'],
          modelName: 'Doc',
          fieldName: 'embedding',
        },
      }),
    );
  });

  it('builds a vector column whose length the data type accepts', () => {
    expect(() => buildWithEmbedding(1536)).not.toThrow();
  });
});
