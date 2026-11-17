import { describe, expectTypeOf, test } from 'vitest';
import type { CreateInput } from '../src/types';
import type { Contract } from './fixtures/on-update-only/generated/contract';

type EventCreate = CreateInput<Contract, 'Event'>;

type Flat<T> = { [K in keyof T]: T[K] };

describe('create input of a field with only @onUpdate', () => {
  test('requires the field, because the runtime generates no value for it on create', () => {
    expectTypeOf<Flat<EventCreate>>().toEqualTypeOf<{
      id: number;
      revision: string;
      touchedBy?: string;
    }>();
  });

  test('rejects a row that leaves the field out', () => {
    // @ts-expect-error revision has no create default
    const row: EventCreate = { id: 1 };
    void row;
  });

  test('accepts a row that leaves out the field with both @onCreate and @onUpdate', () => {
    const row: EventCreate = { id: 1, revision: 'r1' };
    void row;
  });
});
