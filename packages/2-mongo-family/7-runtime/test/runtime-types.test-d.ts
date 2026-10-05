import type { CrossReference, StorageHashBase } from '@internal/contract/types';
import type { AsyncIterableResult } from '@internal/framework-components/runtime';
import type {
  MongoContract,
  MongoContractWithTypeMaps,
  MongoTypeMaps,
} from '@internal/mongo-contract';
import type { MongoQueryPlan } from '@internal/mongo-query-ast/execution';
import { mongoQuery } from '@internal/mongo-query-builder';
import { expectTypeOf } from 'vitest';
import type { MongoRuntime } from '../src/mongo-runtime';

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
    };
    readonly relations: Record<string, never>;
    readonly storage: { readonly collection: 'orders' };
  };
};

type TestStorage = {
  readonly storageHash: StorageHashBase<'test-hash'>;
  readonly namespaces: {
    readonly __unbound__: {
      readonly id: '__unbound__';
      readonly kind: 'mongo-namespace';
      readonly entries: {
        readonly collection: { readonly orders: { readonly kind: 'mongo-collection' } };
      };
    };
  };
};

type TestContract = Omit<MongoContract<TestStorage>, 'domain'> & {
  readonly roots: { readonly orders: CrossReference & { readonly model: 'Order' } };
  readonly domain: {
    readonly namespaces: {
      readonly __unbound__: { readonly models: TestModels };
    };
  };
};

type TestCodecTypes = {
  readonly 'mongo/objectId@1': { readonly output: string };
  readonly 'mongo/string@1': { readonly output: string };
  readonly 'mongo/double@1': { readonly output: number };
};

type TestFieldOutputTypes = {
  readonly __unbound__: {
    readonly Order: {
      readonly _id: string;
      readonly status: string;
      readonly amount: number;
    };
  };
};

type TestFieldInputTypes = TestFieldOutputTypes;
type TContract = MongoContractWithTypeMaps<
  TestContract,
  MongoTypeMaps<TestCodecTypes, TestFieldOutputTypes, TestFieldInputTypes>
>;

type PlanRow<P extends MongoQueryPlan> = P extends MongoQueryPlan<infer R> ? R : never;

type OrderRow = { readonly _id: string; readonly status: string; readonly amount: number };

describe('runtime type safety', () => {
  it('query() returns AsyncIterableResult<Row> where Row matches build() row type', () => {
    const contractJson = {} as unknown;
    const plan = mongoQuery<TContract>({ contractJson }).from('orders').build();
    type Row = PlanRow<typeof plan>;
    expectTypeOf<Row>().toEqualTypeOf<OrderRow>();

    const runtime = {} as MongoRuntime;
    const result = runtime.query(plan);
    expectTypeOf(result).toEqualTypeOf<AsyncIterableResult<Row>>();
  });

  it('query() result awaits to Row[]', () => {
    const contractJson = {} as unknown;
    const plan = mongoQuery<TContract>({ contractJson }).from('orders').build();
    type Row = PlanRow<typeof plan>;

    const runtime = {} as MongoRuntime;
    const rows = runtime.query(plan).toArray();
    expectTypeOf(rows).resolves.toEqualTypeOf<Row[]>();
  });

  it('query() infers Row from MongoQueryPlan generic parameter', () => {
    const runtime = {} as MongoRuntime;
    const plan = {} as MongoQueryPlan<OrderRow>;
    const result = runtime.query(plan);

    expectTypeOf(result).toEqualTypeOf<AsyncIterableResult<OrderRow>>();
  });
});
