import { int4Column } from '@internal/adapter-postgres/column-types';
import { describe, expectTypeOf, test } from 'vitest';
import type { CreateInput } from '../src/types';
import { defineContract } from './contract-builder';

const contract = defineContract({}, ({ field, model, type, gen }) => ({
  models: {
    Stamp: model('Stamp', {
      fields: {
        id: field.column(int4Column).id(),
        updatedOnly: field.column(type.TimestamptzTemporal()).onUpdate(gen.now()),
        createdOnly: field.column(type.TimestamptzTemporal()).onCreate(gen.now()),
        createdAndUpdated: field
          .column(type.TimestamptzTemporal())
          .onCreate(gen.now())
          .onUpdate(gen.now()),
        createdWithPrecision: field.column(type.TimestamptzTemporal(3)).onCreate(gen.now()),
      },
    }).sql({ table: 'stamp' }),
  },
}));

type StampCreate = CreateInput<typeof contract, 'Stamp'>;

type RequiredKeys<T> = {
  [K in keyof T]-?: Record<never, never> extends Pick<T, K> ? never : K;
}[keyof T];

declare const instant: StampCreate['updatedOnly'];

describe('create input of generated timestamp fields in a contract that is not emitted', () => {
  test('requires the field that generates only on update, and no other generated field', () => {
    expectTypeOf<RequiredKeys<StampCreate>>().toEqualTypeOf<'id' | 'updatedOnly'>();
  });

  test('rejects a row that leaves out the field that generates only on update', () => {
    // @ts-expect-error updatedOnly has no create default
    const row: StampCreate = { id: 1 };
    void row;
  });

  test('accepts a row that leaves out every field that generates on create', () => {
    const row: StampCreate = { id: 1, updatedOnly: instant };
    void row;
  });
});
