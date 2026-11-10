import { test } from 'vitest';
import { defineContract } from '../../src/exports/contract-builder';

test('.default() takes the input type of the field codec', () => {
  defineContract({}, ({ field, model, gen, type }) => ({
    models: {
      Event: model('Event', {
        fields: {
          id: field.column(type.sql.Char(36)).id().onCreate(gen.uuid()),
          at: field.column(type.DateTime()).default(new Date()),
          // @ts-expect-error sqlite/datetime@1 takes a Date, not a string
          refused: field.column(type.DateTime()).default('2024-01-01T00:00:00Z'),
        },
      }),
    },
  }));
});
