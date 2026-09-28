import { test } from 'vitest';
import { defineContract } from '../../src/exports/contract-builder';

test('.default() takes the input type of the field codec', () => {
  defineContract({}, ({ field, model }) => ({
    models: {
      Event: model('Event', {
        fields: {
          id: field.id.uuidv4String(),
          at: field.temporal.datetime().default(new Date()),
          // @ts-expect-error sqlite/datetime@1 takes a Date, not a string
          refused: field.temporal.datetime().default('2024-01-01T00:00:00Z'),
        },
      }),
    },
  }));
});
