import type { CreateInput, ScalarUpdateInput } from '@internal/sql-orm-client';
import { expectTypeOf, test } from 'vitest';
import { defineContract } from '../../src/exports/contract-builder';

test('the field presets and field.generated are not on the field the callback receives', () => {
  defineContract({}, ({ field }) => {
    expectTypeOf(field).not.toHaveProperty('uuidString');
    expectTypeOf(field).not.toHaveProperty('nanoid');
    expectTypeOf(field).not.toHaveProperty('id');
    expectTypeOf(field).not.toHaveProperty('temporal');
    expectTypeOf(field).not.toHaveProperty('generated');
    return { models: {} };
  });
});

const contract = defineContract({}, ({ field, model, type, gen }) => ({
  models: {
    Event: model('Event', {
      fields: {
        id: field.column(type.sql.Char(36)).id().onCreate(gen.uuid()),
        code: field.column(type.sql.Char(12)),
        seenAt: field.column(type.DateTime()).onUpdate(gen.now()),
        createdAt: field.column(type.temporal.CreatedAt()),
        updatedAt: field.column(type.temporal.UpdatedAt()),
        slug: field.column(type.sql.Char(16)).onCreate(gen.nanoid(16)),
      },
    }),
  },
}));

type Scalars = {
  id: string;
  code: string;
  seenAt: Date;
  createdAt: Date;
  updatedAt: Date;
  slug: string;
};

test('a replacement field takes the create input the preset it replaces took', () => {
  type Create = CreateInput<typeof contract, 'Event'>;
  expectTypeOf<{ [K in keyof Create]: Create[K] }>().toEqualTypeOf<{
    id?: string;
    code: string;
    seenAt: Date;
    createdAt?: Date;
    updatedAt?: Date;
    slug?: string;
  }>();
});

test('a replacement field takes the update input the preset it replaces took', () => {
  expectTypeOf<ScalarUpdateInput<typeof contract, 'Event'>>().toEqualTypeOf<Partial<Scalars>>();
});
