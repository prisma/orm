import {
  type CrossReference,
  crossRef,
  type ProfileHashBase,
  type StorageHashBase,
} from '@internal/contract/types';
import type {
  MongoContract,
  MongoContractWithTypeMaps,
  MongoTypeMaps,
} from '@internal/mongo-contract';

type TestModels = {
  readonly Order: {
    readonly fields: {
      readonly _id: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/objectId@1' };
        readonly nullable: false;
        readonly many: false;
      };
      readonly status: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
        readonly nullable: false;
        readonly many: false;
      };
      readonly amount: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/double@1' };
        readonly nullable: false;
        readonly many: false;
      };
      readonly customerId: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/objectId@1' };
        readonly nullable: false;
        readonly many: false;
      };
      readonly notes: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
        readonly nullable: true;
        readonly many: false;
      };
      readonly tags: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
        readonly nullable: false;
        readonly many: { readonly elementNullable: false };
      };
    };
    readonly relations: Record<string, never>;
    readonly storage: { readonly collection: 'orders' };
  };
  readonly User: {
    readonly fields: {
      readonly _id: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/objectId@1' };
        readonly nullable: false;
        readonly many: false;
      };
      readonly firstName: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
        readonly nullable: false;
        readonly many: false;
      };
      readonly lastName: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
        readonly nullable: false;
        readonly many: false;
      };
      readonly email: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
        readonly nullable: false;
        readonly many: false;
      };
    };
    readonly relations: Record<string, never>;
    readonly storage: { readonly collection: 'users' };
  };
  /**
   * Fixture for value-object dot-path traversal (TML-2281). `address` is a
   * non-nullable `Address`, `workAddress` is a nullable `Address`, and
   * `stats` is a non-nullable `Stats`. `Address.geo` is itself a `GeoPoint`
   * value object, giving us a two-level nested path (`address.geo.lat`).
   */
  readonly Customer: {
    readonly fields: {
      readonly _id: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/objectId@1' };
        readonly nullable: false;
        readonly many: false;
      };
      readonly name: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
        readonly nullable: false;
        readonly many: false;
      };
      readonly address: {
        readonly type: { readonly kind: 'valueObject'; readonly name: 'Address' };
        readonly nullable: false;
        readonly many: false;
      };
      readonly workAddress: {
        readonly type: { readonly kind: 'valueObject'; readonly name: 'Address' };
        readonly nullable: true;
        readonly many: false;
      };
      readonly stats: {
        readonly type: { readonly kind: 'valueObject'; readonly name: 'Stats' };
        readonly nullable: false;
        readonly many: false;
      };
    };
    readonly relations: Record<string, never>;
    readonly storage: { readonly collection: 'customers' };
  };
};

type TestValueObjects = {
  readonly Address: {
    readonly fields: {
      readonly street: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
        readonly nullable: false;
        readonly many: false;
      };
      readonly city: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
        readonly nullable: false;
        readonly many: false;
      };
      readonly zip: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
        readonly nullable: true;
        readonly many: false;
      };
      readonly geo: {
        readonly type: { readonly kind: 'valueObject'; readonly name: 'GeoPoint' };
        readonly nullable: false;
        readonly many: false;
      };
    };
  };
  readonly GeoPoint: {
    readonly fields: {
      readonly lat: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/double@1' };
        readonly nullable: false;
        readonly many: false;
      };
      readonly lng: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/double@1' };
        readonly nullable: false;
        readonly many: false;
      };
    };
  };
  readonly Stats: {
    readonly fields: {
      readonly visits: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/double@1' };
        readonly nullable: false;
        readonly many: false;
      };
      readonly lastSeen: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/date@1' };
        readonly nullable: true;
        readonly many: false;
      };
    };
  };
};

type TestStorage = {
  readonly storageHash: StorageHashBase<'test-hash'>;
  readonly namespaces: {
    readonly __unbound__: {
      readonly id: '__unbound__';
      readonly kind: 'mongo-namespace';
      readonly entries: {
        readonly collection: {
          readonly orders: { readonly kind: 'mongo-collection' };
          readonly users: { readonly kind: 'mongo-collection' };
          readonly customers: { readonly kind: 'mongo-collection' };
        };
      };
    };
  };
};

export type TestContract = Omit<MongoContract<TestStorage>, 'domain'> & {
  readonly target: 'mongo';
  readonly targetFamily: 'mongo';
  readonly roots: {
    readonly orders: CrossReference & { readonly model: 'Order' };
    readonly users: CrossReference & { readonly model: 'User' };
    readonly customers: CrossReference & { readonly model: 'Customer' };
  };
  readonly domain: {
    readonly namespaces: {
      readonly __unbound__: {
        readonly models: TestModels;
        readonly valueObjects: TestValueObjects;
      };
    };
  };
  readonly profileHash: ProfileHashBase<'test-profile'>;
  readonly capabilities: Record<string, never>;
  readonly extensions: Record<string, never>;
  readonly meta: Record<string, never>;
};

export type TestCodecTypes = {
  readonly 'mongo/objectId@1': { readonly output: string };
  readonly 'mongo/string@1': { readonly output: string };
  readonly 'mongo/double@1': { readonly output: number };
  readonly 'mongo/array@1': { readonly output: unknown[] };
  readonly 'mongo/null@1': { readonly output: null };
  readonly 'mongo/bool@1': { readonly output: boolean };
  readonly 'mongo/date@1': { readonly output: Date };
};

type TestFieldOutputTypes = {
  readonly __unbound__: {
    readonly Order: {
      readonly _id: string;
      readonly status: string;
      readonly amount: number;
      readonly customerId: string;
      readonly notes: string | null;
      readonly tags: string[];
    };
    readonly User: {
      readonly _id: string;
      readonly firstName: string;
      readonly lastName: string;
      readonly email: string;
    };
    readonly Customer: {
      readonly _id: string;
      readonly name: string;
      readonly address: {
        street: string;
        city: string;
        zip: string | null;
        geo: { lat: number; lng: number };
      };
      readonly workAddress: {
        street: string;
        city: string;
        zip: string | null;
        geo: { lat: number; lng: number };
      } | null;
      readonly stats: { visits: number; lastSeen: Date | null };
    };
  };
};

type TestFieldInputTypes = TestFieldOutputTypes;

export type TestTypeMaps = MongoTypeMaps<TestCodecTypes, TestFieldOutputTypes, TestFieldInputTypes>;
export type TContract = MongoContractWithTypeMaps<TestContract, TestTypeMaps>;

export const testContractJson = {
  target: 'mongo',
  targetFamily: 'mongo',
  roots: {
    orders: crossRef('Order'),
    users: crossRef('User'),
    customers: crossRef('Customer'),
  },
  domain: {
    namespaces: {
      __unbound__: {
        models: {
          Order: {
            fields: {
              _id: {
                type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
                nullable: false,
                many: false,
              },
              status: {
                type: { kind: 'scalar', codecId: 'mongo/string@1' },
                nullable: false,
                many: false,
              },
              amount: {
                type: { kind: 'scalar', codecId: 'mongo/double@1' },
                nullable: false,
                many: false,
              },
              customerId: {
                type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
                nullable: false,
                many: false,
              },
              notes: {
                type: { kind: 'scalar', codecId: 'mongo/string@1' },
                nullable: true,
                many: false,
              },
              tags: {
                type: { kind: 'scalar', codecId: 'mongo/string@1' },
                nullable: false,
                many: { elementNullable: false },
              },
            },
            relations: {},
            storage: { collection: 'orders' },
          },
          User: {
            fields: {
              _id: {
                type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
                nullable: false,
                many: false,
              },
              firstName: {
                type: { kind: 'scalar', codecId: 'mongo/string@1' },
                nullable: false,
                many: false,
              },
              lastName: {
                type: { kind: 'scalar', codecId: 'mongo/string@1' },
                nullable: false,
                many: false,
              },
              email: {
                type: { kind: 'scalar', codecId: 'mongo/string@1' },
                nullable: false,
                many: false,
              },
            },
            relations: {},
            storage: { collection: 'users' },
          },
          Customer: {
            fields: {
              _id: {
                type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
                nullable: false,
                many: false,
              },
              name: {
                type: { kind: 'scalar', codecId: 'mongo/string@1' },
                nullable: false,
                many: false,
              },
              address: {
                type: { kind: 'valueObject', name: 'Address' },
                nullable: false,
                many: false,
              },
              workAddress: {
                type: { kind: 'valueObject', name: 'Address' },
                nullable: true,
                many: false,
              },
              stats: { type: { kind: 'valueObject', name: 'Stats' }, nullable: false, many: false },
            },
            relations: {},
            storage: { collection: 'customers' },
          },
        },
        valueObjects: {
          Address: {
            fields: {
              street: {
                type: { kind: 'scalar', codecId: 'mongo/string@1' },
                nullable: false,
                many: false,
              },
              city: {
                type: { kind: 'scalar', codecId: 'mongo/string@1' },
                nullable: false,
                many: false,
              },
              zip: {
                type: { kind: 'scalar', codecId: 'mongo/string@1' },
                nullable: true,
                many: false,
              },
              geo: {
                type: { kind: 'valueObject', name: 'GeoPoint' },
                nullable: false,
                many: false,
              },
            },
          },
          GeoPoint: {
            fields: {
              lat: {
                type: { kind: 'scalar', codecId: 'mongo/double@1' },
                nullable: false,
                many: false,
              },
              lng: {
                type: { kind: 'scalar', codecId: 'mongo/double@1' },
                nullable: false,
                many: false,
              },
            },
          },
          Stats: {
            fields: {
              visits: {
                type: { kind: 'scalar', codecId: 'mongo/double@1' },
                nullable: false,
                many: false,
              },
              lastSeen: {
                type: { kind: 'scalar', codecId: 'mongo/date@1' },
                nullable: true,
                many: false,
              },
            },
          },
        },
      },
    },
  },
  storage: {
    storageHash: 'test-hash',
    namespaces: {
      __unbound__: {
        id: '__unbound__',
        kind: 'mongo-namespace',
        collections: {
          orders: { kind: 'mongo-collection' },
          users: { kind: 'mongo-collection' },
          customers: { kind: 'mongo-collection' },
        },
      },
    },
  },
  capabilities: {},
  extensions: {},
  profileHash: 'test-profile',
  meta: {},
};
