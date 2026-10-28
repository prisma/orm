import type { CreateInput, UpdateInput } from '@internal/mongo-orm';
import { expectTypeOf, test } from 'vitest';
import { defineContract, field as importedField } from '../../src/exports/contract-builder';

test('the temporal presets are not on the field the callback receives', () => {
  defineContract({}, ({ field }) => {
    expectTypeOf(field).not.toHaveProperty('temporal');
    return { models: {} };
  });
});

test('the temporal presets are not on the field contract-builder exports', () => {
  expectTypeOf(importedField).not.toHaveProperty('temporal');
});

const contract = defineContract({}, ({ field, model, gen }) => ({
  models: {
    Post: model('Post', {
      collection: 'posts',
      fields: {
        _id: field.objectId(),
        createdAt: field.date().onCreate(gen.now()),
        updatedAt: field.date().onCreate(gen.now()).onUpdate(gen.now()),
        touchedAt: field.date().onUpdate(gen.now()),
      },
    }),
  },
}));

test('a replacement field takes the create input the preset it replaces took', () => {
  type Create = CreateInput<typeof contract, 'Post'>;
  expectTypeOf<{ [K in keyof Create]: Create[K] }>().toEqualTypeOf<{
    _id?: string;
    createdAt?: Date;
    updatedAt?: Date;
    touchedAt: Date;
  }>();
});

test('a replacement field takes the update input the preset it replaces took', () => {
  type Update = UpdateInput<typeof contract, 'Post'>;
  expectTypeOf<{ [K in keyof Update]: Update[K] }>().toEqualTypeOf<{
    _id?: string;
    createdAt?: Date;
    updatedAt?: Date;
    touchedAt?: Date;
  }>();
});
