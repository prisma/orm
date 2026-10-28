import type { JsonValue } from '@internal/contract/types';
import type { CreateInput, ScalarUpdateInput } from '@internal/sql-orm-client';
import type { Temporal } from 'temporal-spec';
import { expectTypeOf, test } from 'vitest';
import { defineContract, field as importedField } from '../../src/exports/contract-builder';

test('the field presets and field.generated are not on the field the callback receives', () => {
  defineContract({}, ({ field }) => {
    expectTypeOf(field).not.toHaveProperty('text');
    expectTypeOf(field).not.toHaveProperty('uuidString');
    expectTypeOf(field).not.toHaveProperty('id');
    expectTypeOf(field).not.toHaveProperty('temporal');
    expectTypeOf(field).not.toHaveProperty('generated');
    return { models: {} };
  });
});

test('the field presets and field.generated are not on the field contract-builder exports', () => {
  expectTypeOf(importedField).not.toHaveProperty('text');
  expectTypeOf(importedField).not.toHaveProperty('id');
  expectTypeOf(importedField).not.toHaveProperty('temporal');
  expectTypeOf(importedField).not.toHaveProperty('generated');
});

const contract = defineContract({}, ({ field, model, type, gen }) => ({
  models: {
    Event: model('Event', {
      fields: {
        id: field.column(type.Char(36)).id().onCreate(gen.uuid()),
        code: field.column(type.Char(12)),
        seenAt: field.column(type.Time(3)).onUpdate(gen.now()),
        createdAt: field.column(type.temporal.CreatedAt()),
        updatedAt: field.column(type.temporal.UpdatedAt()),
        payload: field.column(type.Jsonb()).optional(),
        slug: field.column(type.Char(16)).onCreate(gen.nanoid(16)),
        title: field.column(type.String()),
      },
    }),
  },
}));

type Scalars = {
  id: string;
  code: string;
  seenAt: Temporal.PlainTime;
  createdAt: Temporal.Instant;
  updatedAt: Temporal.Instant;
  payload: JsonValue;
  slug: string;
  title: string;
};

test('a replacement field takes the create input the preset it replaces took', () => {
  type Create = CreateInput<typeof contract, 'Event'>;
  expectTypeOf<{ [K in keyof Create]: Create[K] }>().toEqualTypeOf<{
    id?: string;
    code: string;
    seenAt: Temporal.PlainTime;
    createdAt?: Temporal.Instant;
    updatedAt?: Temporal.Instant;
    payload?: JsonValue;
    slug?: string;
    title: string;
  }>();
});

test('a replacement field takes the update input the preset it replaces took', () => {
  expectTypeOf<ScalarUpdateInput<typeof contract, 'Event'>>().toEqualTypeOf<Partial<Scalars>>();
});
