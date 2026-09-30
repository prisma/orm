import { defineContract } from '@internal/postgres/contract-builder';
import { test } from 'vitest';
import { vector } from '../src/exports/column-types';
import pgvector from '../src/exports/pack';

test('.default() on a vector field takes the input type of pg/vector@1', () => {
  defineContract({ extensions: { pgvector } }, ({ field, model, type }) => {
    const types = { Embedding: type.pgvector.Vector(3) };
    return {
      types,
      models: {
        Doc: model('Doc', {
          fields: {
            id: field.id.uuidv4String(),
            column: field.column(vector(3)).default([1, 2, 3]),
            namedType: field.namedType(types.Embedding).default([1, 2, 3]),
            // @ts-expect-error pg/vector@1 takes an array of numbers, not a string
            refusedColumn: field.column(vector(3)).default('[1,2,3]'),
            // @ts-expect-error pg/vector@1 takes an array of numbers, not a string
            refusedNamedType: field.namedType(types.Embedding).default('[1,2,3]'),
          },
        }),
      },
    };
  });
});
