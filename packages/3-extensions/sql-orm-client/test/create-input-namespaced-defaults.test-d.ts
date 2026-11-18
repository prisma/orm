import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import { describe, expectTypeOf, test } from 'vitest';
import type { CreateInput } from '../src/types';
import { defineContract } from './contract-builder';

const contract = defineContract({ namespaces: ['shadow'] }, ({ field, model, gen }) => ({
  models: {
    PublicThing: model('PublicThing', {
      fields: {
        id: field.column(int4Column).id(),
        code: field.column(textColumn),
      },
    }).sql({ table: 'thing' }),
    ShadowThing: model('ShadowThing', {
      namespace: 'shadow',
      fields: {
        id: field.column(int4Column).id(),
        code: field.column(textColumn).onCreate(gen.uuid()),
      },
    }).sql({ table: 'thing' }),
  },
}));

type Flat<T> = { [K in keyof T]: T[K] };

describe('create input when another namespace has a same-named table with an onCreate default', () => {
  test('the model in the namespace without the default requires the field', () => {
    expectTypeOf<Flat<CreateInput<typeof contract, 'PublicThing'>>>().toEqualTypeOf<{
      id: number;
      code: string;
    }>();
  });

  test('rejects a create row that leaves the field out', () => {
    // @ts-expect-error code has no create default in the public namespace
    const row: CreateInput<typeof contract, 'PublicThing'> = { id: 1 };
    void row;
  });

  test('the model in the namespace with the default leaves the field optional', () => {
    const row: CreateInput<typeof contract, 'ShadowThing'> = { id: 1 };
    void row;
  });
});
