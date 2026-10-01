import type { Contract, StorageHashBase } from '@internal/contract/types';
import { expectTypeOf, test } from 'vitest';
import type { CreateInput } from '../src/types';

type CreateInputStorage = {
  storageHash: StorageHashBase<string>;
  namespaces: {
    __unbound__: {
      id: '__unbound__';
      kind: 'schema';
      entries: {
        table: {
          user: {
            columns: {
              id: {
                nativeType: 'int4';
                codecId: 'pg/int4@1';
                nullable: false;
                default: {
                  kind: 'function';
                  expression: "nextval('user_id_seq'::regclass)";
                };
              };
              email: { nativeType: 'text'; codecId: 'pg/text@1'; nullable: false };
              name: { nativeType: 'text'; codecId: 'pg/text@1'; nullable: true };
              slug: { nativeType: 'text'; codecId: 'pg/text@1'; nullable: false };
              created_at: {
                nativeType: 'timestamptz';
                codecId: 'pg/text@1';
                nullable: false;
                default: {
                  kind: 'function';
                  expression: 'now()';
                };
              };
            };
            primaryKey: { columns: ['id'] };
            uniques: [];
            indexes: [];
            foreignKeys: [];
          };
        };
      };
    };
  };
};

type CreateInputModels = {
  User: {
    storage: {
      table: 'user';
      fields: {
        id: { column: 'id' };
        email: { column: 'email' };
        name: { column: 'name' };
        slug: { column: 'slug' };
        createdAt: { column: 'created_at' };
      };
    };
    fields: {
      id: { type: { kind: 'scalar'; codecId: 'pg/int4@1' }; nullable: false };
      email: { type: { kind: 'scalar'; codecId: 'pg/text@1' }; nullable: false };
      name: { type: { kind: 'scalar'; codecId: 'pg/text@1' }; nullable: true };
      slug: { type: { kind: 'scalar'; codecId: 'pg/text@1' }; nullable: false };
      createdAt: { type: { kind: 'scalar'; codecId: 'pg/text@1' }; nullable: false };
    };
    relations: Record<string, never>;
  };
};

type CreateInputContract = Omit<Contract<CreateInputStorage>, 'domain'> & {
  readonly domain: {
    readonly namespaces: {
      readonly __unbound__: { readonly models: CreateInputModels };
    };
  };
} & {
  readonly execution: {
    readonly mutations: {
      readonly defaults: [
        {
          readonly ref: { readonly entry: 'user'; readonly field: 'slug' };
          readonly onCreate: {
            readonly kind: 'generator';
            readonly id: 'uuidv4';
          };
        },
      ];
    };
  };
};

type Input = CreateInput<CreateInputContract, 'User'>;

type RequiredKeys<T> = {
  [K in keyof T]-?: Record<never, never> extends Pick<T, K> ? never : K;
}[keyof T];

type OptionalKeys<T> = Exclude<keyof T, RequiredKeys<T>>;

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type Assert<T extends true> = T;

export type CreateInputTypeAssertions = [
  Assert<Equal<RequiredKeys<Input>, 'email'>>,
  Assert<Equal<OptionalKeys<Input>, 'id' | 'name' | 'slug' | 'createdAt'>>,
];

test('create input type assertions compile', () => {
  expectTypeOf<CreateInputTypeAssertions>().toMatchTypeOf<readonly true[]>();
});
