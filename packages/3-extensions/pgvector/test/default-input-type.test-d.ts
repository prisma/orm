import { defineContract } from '@internal/postgres/contract-builder';
import { test } from 'vitest';
import { vector } from '../src/exports/column-types';
import pgvector from '../src/exports/pack';

test('.default() on a vector field takes the input type of pg/vector@1', () => {
  defineContract({ extensions: { pgvector } }, ({ field, model, type, gen }) => {
    const Embedding = field.column(type.pgvector.Vector(3));
    return {
      models: {
        Doc: model('Doc', {
          fields: {
            id: field.column(type.Char(36)).id().onCreate(gen.uuid()),
            column: field.column(vector(3)).default([1, 2, 3]),
            typeHelper: Embedding.default([1, 2, 3]),
            // @ts-expect-error pg/vector@1 takes an array of numbers, not a string
            refusedColumn: field.column(vector(3)).default('[1,2,3]'),
            // @ts-expect-error pg/vector@1 takes an array of numbers, not a string
            refusedTypeHelper: Embedding.default('[1,2,3]'),
          },
        }),
      },
    };
  });
});
