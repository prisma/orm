import type { FieldAccessor } from '@internal/mongo-orm';
import { expectTypeOf, test } from 'vitest';
import { defineContract, field, model } from '../src/exports/contract-builder';

const noEmit = defineContract({
  models: {
    Note: model('Note', {
      collection: 'notes',
      fields: { _id: field.objectId(), title: field.string() },
    }),
  },
});

test('a String or ObjectId field of a TypeScript contract has no inc or mul', () => {
  type NoteFields = FieldAccessor<typeof noEmit, 'Note'>;
  expectTypeOf<NoteFields['title']>().not.toHaveProperty('inc');
  expectTypeOf<NoteFields['title']>().not.toHaveProperty('mul');
  expectTypeOf<NoteFields['_id']>().not.toHaveProperty('inc');
  expectTypeOf<NoteFields['_id']>().not.toHaveProperty('mul');
});
