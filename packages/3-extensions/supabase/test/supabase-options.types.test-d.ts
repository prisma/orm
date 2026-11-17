import type {
  PostgresBinding,
  PostgresBindingOptions,
  PostgresCursorOptions,
  PostgresOptionsBase,
} from '@internal/postgres/runtime';
import type { Pool } from 'pg';
import { expectTypeOf, test } from 'vitest';
import type { SupabaseOptions } from '../src/exports/runtime';
import type { Contract } from './fixtures/example-app/contract';

type Options = SupabaseOptions<Contract>;

test('the execution and pool options are the options postgres() takes', () => {
  expectTypeOf<Pick<Options, keyof PostgresOptionsBase>>().toEqualTypeOf<
    Pick<PostgresOptionsBase, keyof PostgresOptionsBase>
  >();
});

test('the cursor option is the postgres() cursor option', () => {
  expectTypeOf<Options['cursor']>().toEqualTypeOf<PostgresCursorOptions | undefined>();
  expectTypeOf<{ batchSize: 500 }>().toExtend<NonNullable<Options['cursor']>>();
});

test('the binding option takes the url and pgPool forms of a postgres() binding', () => {
  expectTypeOf<Options['binding']>().toEqualTypeOf<
    Exclude<PostgresBinding, { readonly kind: 'pgClient' }> | undefined
  >();
});

test('every other database input is the postgres() input of the same name', () => {
  type Shared = Exclude<keyof PostgresBindingOptions, 'binding' | 'pg'>;
  expectTypeOf<Pick<Options, Shared>>().toEqualTypeOf<Pick<PostgresBindingOptions, Shared>>();
  expectTypeOf<Options['pg']>().toEqualTypeOf<Pool | undefined>();
});
