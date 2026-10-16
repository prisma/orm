import type { ParameterizedOutputTypesFunction } from '@internal/contract/types';
import { describe, expectTypeOf, test } from 'vitest';
import type { ColumnTypesFromStorage } from '../src/exports/types';

type CodecTypes = {
  readonly 'test/text@1': { readonly input: string; readonly output: string };
  readonly 'test/char@1': { readonly input: string; readonly output: string };
  readonly 'test/json@1': { readonly input: unknown; readonly output: unknown };
};

type Char<N extends number> = string & { readonly __length: N };

type CharOutputTypeMap<TypeParams> = {
  readonly 'test/char@1': TypeParams extends { readonly length: infer N extends number }
    ? Char<N>
    : never;
};

interface CharOutputTypes extends ParameterizedOutputTypesFunction {
  readonly outputTypes: CharOutputTypeMap<this['typeParams']>;
}

type Storage = {
  readonly types: {
    readonly Code: {
      readonly codecId: 'test/char@1';
      readonly typeParams: { readonly length: 8 };
    };
  };
  readonly namespaces: {
    readonly public: {
      readonly entries: {
        readonly table: {
          readonly users: {
            readonly columns: {
              readonly id: {
                readonly codecId: 'test/char@1';
                readonly nullable: false;
                readonly typeParams: { readonly length: 24 };
                readonly many: false;
              };
              readonly code: {
                readonly codecId: 'test/char@1';
                readonly nullable: true;
                readonly typeRef: 'Code';
                readonly many: false;
              };
              readonly mood: {
                readonly codecId: 'test/text@1';
                readonly nullable: false;
                readonly many: false;
              };
            };
          };
        };
      };
    };
  };
};

type KnownColumns = {
  readonly public: {
    readonly users: {
      readonly mood: { readonly output: 'happy' | 'sad'; readonly input: 'happy' | 'sad' };
    };
  };
};

type ColumnOutput = ColumnTypesFromStorage<
  Storage,
  CodecTypes,
  CharOutputTypes,
  KnownColumns,
  'output'
>;

describe('storage column types from a contract storage', () => {
  test('a column takes its own type parameters, or those of its named type', () => {
    expectTypeOf<ColumnOutput['public']['users']['id']>().toEqualTypeOf<Char<24>>();
    expectTypeOf<ColumnOutput['public']['users']['code']>().toEqualTypeOf<Char<8> | null>();
  });

  test('a known type replaces the codec type', () => {
    expectTypeOf<ColumnOutput['public']['users']['mood']>().toEqualTypeOf<'happy' | 'sad'>();
  });
});
