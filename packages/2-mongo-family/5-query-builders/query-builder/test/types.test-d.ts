import type { MongoContract } from '@internal/mongo-contract';
import { expectTypeOf } from 'vitest';
import type { ModelArrayField } from '../src/resolve-path';
import type {
  BooleanField,
  DateField,
  ExtractDocShape,
  ModelToDocShape,
  ResolveRow,
  TypedAggExpr,
} from '../src/types';
import type { TestCodecTypes, TestContract } from './fixtures/test-contract';

describe('type machinery', () => {
  it('ModelToDocShape derives correct shape from contract model', () => {
    type OrderShape = ModelToDocShape<TestContract, 'Order'>;

    expectTypeOf<OrderShape['_id']>().toEqualTypeOf<{
      readonly codecId: 'mongo/objectId@1';
      readonly nullable: false;
    }>();
    expectTypeOf<OrderShape['status']>().toEqualTypeOf<{
      readonly codecId: 'mongo/string@1';
      readonly nullable: false;
    }>();
    expectTypeOf<OrderShape['notes']>().toEqualTypeOf<{
      readonly codecId: 'mongo/string@1';
      readonly nullable: true;
    }>();
  });

  it('ResolveRow produces concrete types from DocShape and CodecTypes', () => {
    type OrderShape = ModelToDocShape<TestContract, 'Order'>;
    type Row = ResolveRow<OrderShape, TestCodecTypes>;

    expectTypeOf<Row['_id']>().toEqualTypeOf<string>();
    expectTypeOf<Row['status']>().toEqualTypeOf<string>();
    expectTypeOf<Row['amount']>().toEqualTypeOf<number>();
  });

  it('ResolveRow applies nullable correctly', () => {
    type OrderShape = ModelToDocShape<TestContract, 'Order'>;
    type Row = ResolveRow<OrderShape, TestCodecTypes>;

    expectTypeOf<Row['notes']>().toEqualTypeOf<string | null>();
  });

  it('ResolveRow falls back to unknown for missing codec', () => {
    type Shape = { readonly x: { readonly codecId: 'unknown/codec'; readonly nullable: false } };
    type Row = ResolveRow<Shape, TestCodecTypes>;

    expectTypeOf<Row['x']>().toEqualTypeOf<unknown>();
  });

  it('ResolveRow falls back to unknown[] for ModelArrayField on non-concrete contracts', () => {
    type Shape = { readonly customer: ModelArrayField<'User'> };
    type Row = ResolveRow<Shape, TestCodecTypes, MongoContract>;

    expectTypeOf<Row['customer']>().toEqualTypeOf<unknown[]>();
  });

  it('BooleanField resolves to boolean through ResolveRow', () => {
    type Shape = { readonly flag: BooleanField };
    type Row = ResolveRow<Shape, TestCodecTypes>;
    expectTypeOf<Row['flag']>().toEqualTypeOf<boolean>();
  });

  it('DateField resolves to Date through ResolveRow', () => {
    type Shape = { readonly ts: DateField };
    type Row = ResolveRow<Shape, TestCodecTypes>;
    expectTypeOf<Row['ts']>().toEqualTypeOf<Date>();
  });

  it('ExtractDocShape extracts field types from TypedAggExpr record', () => {
    type Exprs = {
      readonly total: TypedAggExpr<{
        readonly codecId: 'mongo/double@1';
        readonly nullable: false;
      }>;
      readonly name: TypedAggExpr<{
        readonly codecId: 'mongo/string@1';
        readonly nullable: false;
      }>;
    };
    type Shape = ExtractDocShape<Exprs>;

    expectTypeOf<Shape['total']>().toEqualTypeOf<{
      readonly codecId: 'mongo/double@1';
      readonly nullable: false;
    }>();
    expectTypeOf<Shape['name']>().toEqualTypeOf<{
      readonly codecId: 'mongo/string@1';
      readonly nullable: false;
    }>();
  });
});
