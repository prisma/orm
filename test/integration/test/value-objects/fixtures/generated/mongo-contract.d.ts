import type { CodecTypes as MongoCodecTypes } from '@internal/target-mongo/codec-types';

import type { MongoContractWithTypeMaps, MongoTypeMaps } from '@internal/mongo-contract';
import type { NamespaceId, ProfileHashBase, StorageHashBase } from '@internal/contract/types';

export type StorageHash =
  StorageHashBase<'vo-test-storage-hash'>;
export type ProfileHash =
  ProfileHashBase<'vo-test-profile-hash'>;

export type CodecTypes = MongoCodecTypes;
export type Location = {
  readonly street: CodecTypes['mongo/string@1']['output'];
  readonly city: CodecTypes['mongo/string@1']['output'];
  readonly zip: CodecTypes['mongo/string@1']['output'];
};
export type FieldOutputTypes = {
  readonly __unbound__: {
    readonly Shop: {
      readonly _id: CodecTypes['mongo/objectId@1']['output'];
      readonly name: CodecTypes['mongo/string@1']['output'];
      readonly location: { street: string; city: string; zip: string };
      readonly notes: { street: string; city: string; zip: string } | null;
    };
  };
};
export type FieldInputTypes = {
  readonly __unbound__: {
    readonly Shop: {
      readonly _id: CodecTypes['mongo/objectId@1']['output'];
      readonly name: CodecTypes['mongo/string@1']['output'];
      readonly location: { street: string; city: string; zip: string };
      readonly notes: { street: string; city: string; zip: string } | null;
    };
  };
};
export type TypeMaps = MongoTypeMaps<CodecTypes, FieldOutputTypes, FieldInputTypes>;

type ContractBase = {
  readonly target: 'mongo';
  readonly targetFamily: 'mongo';
  readonly profileHash: ProfileHash;
  readonly capabilities: {};
  readonly extensions: {};
  readonly meta: {};
  readonly roots: { readonly shop: { readonly model: 'Shop'; readonly namespace: NamespaceId } };
  readonly domain: {
    readonly namespaces: {
      readonly __unbound__: {
        readonly models: {
          readonly Shop: {
            readonly fields: {
              readonly _id: {
                readonly nullable: false;
                readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/objectId@1' };
              };
              readonly name: {
                readonly nullable: false;
                readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
              };
              readonly location: {
                readonly nullable: false;
                readonly type: { readonly kind: 'valueObject'; readonly name: 'Location' };
              };
              readonly notes: {
                readonly nullable: true;
                readonly type: { readonly kind: 'valueObject'; readonly name: 'Location' };
              };
            };
            readonly relations: Record<string, never>;
            readonly storage: { readonly collection: 'shops' };
          };
        };
        readonly valueObjects: {
          readonly Location: {
            readonly fields: {
              readonly street: {
                readonly nullable: false;
                readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
              };
              readonly city: {
                readonly nullable: false;
                readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
              };
              readonly zip: {
                readonly nullable: false;
                readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
              };
            };
          };
        };
      };
    };
  };
  readonly storage: {
    readonly namespaces: {
      readonly __unbound__: {
        readonly id: '__unbound__';
        readonly kind: 'mongo-namespace';
        readonly entries: {
          readonly collection: {
            readonly shops: { readonly kind: 'mongo-collection' };
          };
        };
      };
    };
    readonly storageHash: StorageHash;
  };
};

export type Contract = MongoContractWithTypeMaps<ContractBase, TypeMaps>;
