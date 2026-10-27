import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import type { Contract } from '@internal/contract/types';
import sqlFamilyPack from '@internal/family-sql/pack';
import { assembleDataTypes } from '@internal/framework-components/codec';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  autoincrement,
  createComposedAuthoringHelpers,
  defineContract,
  field,
  model,
} from '@internal/sql-contract-ts/contract-builder';
import { assemblePostgresCodecRegistryWithBuiltins } from '@internal/target-postgres/codecs';
import postgresPack from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { describe, expectTypeOf, test } from 'vitest';
import type { Db } from '../../src/exports/types';

const dataTypeLookup = assembleDataTypes([postgresPack]).lookup;
const lookups = {
  codecLookup: assemblePostgresCodecRegistryWithBuiltins([], dataTypeLookup),
  dataTypeLookup,
};

const { gen, type } = createComposedAuthoringHelpers({
  ...lookups,
  family: sqlFamilyPack,
  target: postgresPack,
});

const Account = model('Account', {
  fields: {
    id: field.column(int4Column).default(autoincrement()).id(),
    email: field.column(textColumn),
    nickname: field.column(textColumn).optional(),
    plan: field.column(textColumn).default('free'),
    token: field.column(textColumn).onCreate(gen.uuid()),
    slug: field.column(textColumn).default('none').onCreate(gen.uuid()),
    revision: field.column(textColumn).onUpdate(gen.uuid()),
  },
}).sql({ table: 'account' });

const PublicThing = model('PublicThing', {
  fields: {
    id: field.column(int4Column).id(),
    code: field.column(textColumn),
  },
}).sql({ table: 'thing' });

const ShadowThing = model('ShadowThing', {
  namespace: 'shadow',
  fields: {
    id: field.column(int4Column).id(),
    code: field.column(textColumn).onCreate(gen.uuid()),
  },
}).sql({ table: 'thing' });

const Stamp = model('Stamp', {
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
}).sql({ table: 'stamp' });

const contract = defineContract({
  ...lookups,
  family: sqlFamilyPack,
  target: postgresPack,
  createNamespace: postgresCreateNamespace,
  namespaces: ['shadow'],
  models: { Account, PublicThing, ShadowThing, Stamp },
});

declare const db: Db<typeof contract>;
declare const widened: Db<Contract<SqlStorage>>;

type AccountRow = Parameters<typeof db.public.account.insert>[0][number];
type StampRow = Parameters<typeof db.public.stamp.insert>[0][number];

type RequiredKeys<T> = {
  [K in keyof T]-?: Record<never, never> extends Pick<T, K> ? never : K;
}[keyof T];

declare const instant: StampRow['updatedOnly'];

describe('insert row of a contract-bound table', () => {
  test('requires each column that is not nullable and has no create default, by name', () => {
    expectTypeOf<AccountRow>().toEqualTypeOf<{
      readonly email: string;
      readonly revision: string;
      readonly id?: number;
      readonly nickname?: string | null;
      readonly plan?: string;
      readonly token?: string;
      readonly slug?: string;
    }>();
  });

  test('rejects a row that leaves out a required column', () => {
    // @ts-expect-error email is required
    db.public.account.insert([{ revision: 'r1' }]);
  });

  test('rejects a row that leaves out a column with only an onUpdate generator', () => {
    // @ts-expect-error revision has no create default
    db.public.account.insert([{ email: 'a@example.com' }]);
  });

  test('accepts rows that each set different optional columns', () => {
    db.public.account.insert([
      { email: 'a@example.com', revision: 'r1' },
      { email: 'b@example.com', revision: 'r1', nickname: 'b', plan: 'pro' },
      { email: 'c@example.com', revision: 'r1', id: 3, token: 't', slug: 's' },
    ]);
  });

  test('an onCreate generator in another namespace does not make a same-named column optional', () => {
    expectTypeOf<Parameters<typeof db.public.thing.insert>[0][number]>().toEqualTypeOf<{
      readonly id: number;
      readonly code: string;
    }>();
    expectTypeOf<Parameters<typeof db.shadow.thing.insert>[0][number]>().toEqualTypeOf<{
      readonly id: number;
      readonly code?: string;
    }>();
  });
});

describe('insert row with generated timestamp columns', () => {
  test('requires a timestamp column that generates only on update, and no other generated column', () => {
    expectTypeOf<RequiredKeys<StampRow>>().toEqualTypeOf<'id' | 'updatedOnly'>();
  });

  test('rejects a row that leaves out the timestamp column that generates only on update', () => {
    // @ts-expect-error updatedOnly has no create default
    db.public.stamp.insert([{ id: 1 }]);
  });

  test('accepts a row that leaves out every timestamp column that generates on create', () => {
    db.public.stamp.insert([{ id: 1, updatedOnly: instant }]);
  });
});

describe('insert row of a widened contract', () => {
  test('requires no column', () => {
    widened['public']?.['any_table']?.insert([{}]);
  });
});

describe('update values', () => {
  test('are all optional', () => {
    db.public.account.update({ email: 'a@example.com' });
    db.public.account.update({});
  });
});
