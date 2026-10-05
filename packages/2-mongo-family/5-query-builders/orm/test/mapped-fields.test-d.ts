import type {
  MongoContractWithTypeMaps,
  MongoTypeMaps,
  MongoTypeMapsPhantomKey,
} from '@internal/mongo-contract';
import { expectTypeOf, test } from 'vitest';
import type {
  CodecTypes,
  Contract,
  FieldInputTypes,
  FieldOutputTypes,
} from '../../../1-foundation/mongo-contract/test/fixtures/orm-contract';
import type { CreateInput } from '../src/types';

type User = Contract['domain']['namespaces']['__unbound__']['models']['User'];
type MappedContract = MongoContractWithTypeMaps<
  Omit<Contract, 'domain' | 'execution' | MongoTypeMapsPhantomKey> & {
    readonly domain: {
      readonly namespaces: {
        readonly __unbound__: {
          readonly models: {
            readonly User: Omit<User, 'fields' | 'storage'> & {
              readonly fields: Omit<User['fields'], '_id'> & { readonly id: User['fields']['_id'] };
              readonly storage: {
                readonly collection: 'users';
                readonly fields: {
                  readonly id: { readonly field: '_id' };
                  readonly name: { readonly field: 'stored_name' };
                };
              };
            };
          };
        };
      };
    };
    readonly execution: {
      readonly executionHash: NonNullable<Contract['execution']>['executionHash'];
      readonly mutations: {
        readonly defaults: readonly [
          {
            readonly ref: {
              readonly namespace: '__unbound__';
              readonly entry: 'users';
              readonly field: 'stored_name';
            };
            readonly onCreate: { readonly kind: 'generator'; readonly id: 'anonymous' };
          },
        ];
      };
    };
  },
  MongoTypeMaps<
    CodecTypes,
    {
      __unbound__: {
        User: Omit<FieldOutputTypes['__unbound__']['User'], '_id'> & {
          id: CodecTypes['mongo/objectId@1']['output'];
        };
      };
    },
    {
      __unbound__: {
        User: Omit<FieldInputTypes['__unbound__']['User'], '_id'> & {
          id: CodecTypes['mongo/objectId@1']['input'];
        };
      };
    }
  >
>;

test('mapped identity and generated fields are optional under their application names', () => {
  expectTypeOf<{
    email: string;
    loginCount: number;
    tags: string[];
    homeAddress: null;
  }>().toExtend<CreateInput<MappedContract, 'User'>>();
  expectTypeOf<CreateInput<MappedContract, 'User'>>().toHaveProperty('id');
  expectTypeOf<CreateInput<MappedContract, 'User'>>().not.toHaveProperty('_id');
  expectTypeOf<CreateInput<MappedContract, 'User'>>().not.toHaveProperty('stored_name');
});
