import type {
  MongoCollection,
  MongoContract,
  MongoContractWithTypeMaps,
  MongoTypeMaps,
} from '@internal/mongo-contract';

type UserModel = {
  readonly storage: { readonly collection: 'users' };
  readonly fields: {
    readonly _id: {
      readonly nullable: false;
      readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/objectId@1' };
    };
    readonly name: {
      readonly nullable: false;
      readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
    };
    readonly email: {
      readonly nullable: false;
      readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
    };
    readonly bio: {
      readonly nullable: true;
      readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
    };
    readonly createdAt: {
      readonly nullable: false;
      readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/date@1' };
    };
  };
  readonly relations: {
    readonly posts: {
      readonly to: { readonly namespace: '__unbound__'; readonly model: 'Post' };
      readonly cardinality: '1:N';
      readonly on: {
        readonly localFields: readonly ['_id'];
        readonly targetFields: readonly ['authorId'];
      };
    };
  };
};

type PostModel = {
  readonly storage: { readonly collection: 'posts' };
  readonly fields: {
    readonly _id: {
      readonly nullable: false;
      readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/objectId@1' };
    };
    readonly title: {
      readonly nullable: false;
      readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
    };
    readonly slug: {
      readonly nullable: false;
      readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
    };
    readonly content: {
      readonly nullable: false;
      readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
    };
    readonly status: {
      readonly nullable: false;
      readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
    };
    readonly authorId: {
      readonly nullable: false;
      readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/objectId@1' };
    };
    readonly viewCount: {
      readonly nullable: false;
      readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/int32@1' };
    };
    readonly publishedAt: {
      readonly nullable: true;
      readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/date@1' };
    };
    readonly updatedAt: {
      readonly nullable: false;
      readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/date@1' };
    };
  };
  readonly relations: {
    readonly author: {
      readonly to: { readonly namespace: '__unbound__'; readonly model: 'User' };
      readonly cardinality: 'N:1';
      readonly nullable: false;
      readonly on: {
        readonly localFields: readonly ['authorId'];
        readonly targetFields: readonly ['_id'];
      };
    };
  };
};

type BlogContract = MongoContract<
  {
    readonly users: 'User';
    readonly posts: 'Post';
  },
  {
    readonly collections: {
      readonly users: MongoCollection;
      readonly posts: Record<string, never>;
    };
  },
  {
    readonly User: UserModel;
    readonly Post: PostModel;
  }
>;

type BlogCodecTypes = {
  readonly 'mongo/objectId@1': { readonly input: string; readonly output: string };
  readonly 'mongo/string@1': { readonly input: string; readonly output: string };
  readonly 'mongo/int32@1': { readonly input: number; readonly output: number };
  readonly 'mongo/date@1': { readonly input: Date; readonly output: Date };
};

type BlogFieldOutputTypes = {
  readonly __unbound__: {
    readonly User: {
      readonly _id: string;
      readonly name: string;
      readonly email: string;
      readonly bio: string | null;
      readonly createdAt: Date;
    };
    readonly Post: {
      readonly _id: string;
      readonly title: string;
      readonly slug: string;
      readonly content: string;
      readonly status: string;
      readonly authorId: string;
      readonly viewCount: number;
      readonly publishedAt: Date | null;
      readonly updatedAt: Date;
    };
  };
};

type BlogFieldInputTypes = BlogFieldOutputTypes;
type BlogTypeMaps = MongoTypeMaps<BlogCodecTypes, BlogFieldOutputTypes, BlogFieldInputTypes>;

export type Contract = MongoContractWithTypeMaps<BlogContract, BlogTypeMaps>;
export type TypeMaps = BlogTypeMaps;
