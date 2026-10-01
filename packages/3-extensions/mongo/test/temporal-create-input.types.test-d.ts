import type { CreateInput } from '@internal/mongo-orm';
import { expectTypeOf, test } from 'vitest';
import { defineContract } from '../src/exports/contract-builder';

const contract = defineContract({}, ({ field, model }) => ({
  models: {
    Post: model('Post', {
      collection: 'posts',
      fields: {
        _id: field.objectId(),
        title: field.string(),
        createdAt: field.temporal.createdAt(),
        updatedAt: field.temporal.updatedAt(),
        touchedAt: field.temporal.timestamp(undefined, 'now'),
        publishedAt: field.date(),
      },
    }),
  },
}));

type PostCreate = CreateInput<typeof contract, 'Post'>;

test('fields generated on create are optional on the no-emit create input', () => {
  expectTypeOf<{ title: string; touchedAt: Date; publishedAt: Date }>().toExtend<PostCreate>();
  expectTypeOf<PostCreate['createdAt']>().toEqualTypeOf<Date | undefined>();
  expectTypeOf<PostCreate['updatedAt']>().toEqualTypeOf<Date | undefined>();
});

test('fields without a create-time generator stay required', () => {
  expectTypeOf<{ touchedAt: Date; publishedAt: Date }>().not.toExtend<PostCreate>();
  expectTypeOf<{ title: string; publishedAt: Date }>().not.toExtend<PostCreate>();
  expectTypeOf<{ title: string; touchedAt: Date }>().not.toExtend<PostCreate>();
});
