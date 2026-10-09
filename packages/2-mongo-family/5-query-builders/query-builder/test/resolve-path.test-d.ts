import { expectTypeOf } from 'vitest';
import type {
  ModelNestedShape,
  NestedDocShape,
  ObjectField,
  ResolvePath,
  ValidPaths,
} from '../src/resolve-path';
import type { TestContract } from './fixtures/test-contract';

// Concrete handles for the derived `Customer` nested shape used throughout
// the suite — keeps each assertion readable without re-invoking the
// generic at every callsite.
type CustomerShape = ModelNestedShape<TestContract, 'Customer'>;

type AddressShape = CustomerShape['address'] extends ObjectField<infer N> ? N : never;
type GeoShape = AddressShape['geo'] extends ObjectField<infer N> ? N : never;

type ScalarListField<N extends boolean, E extends boolean> = {
  readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
  readonly nullable: N;
  readonly many: { readonly elementNullable: E };
};

type ScalarListContract = Omit<TestContract, 'domain'> & {
  readonly domain: {
    readonly namespaces: {
      readonly __unbound__: {
        readonly models: {
          readonly Order: {
            readonly fields: {
              readonly strict: ScalarListField<false, false>;
              readonly nullableElements: ScalarListField<false, true>;
              readonly nullableContainer: ScalarListField<true, false>;
              readonly nullableBoth: ScalarListField<true, true>;
            };
            readonly relations: Record<string, never>;
            readonly storage: { readonly collection: 'orders' };
          };
        };
      };
    };
  };
};

type ScalarListShape = ModelNestedShape<ScalarListContract, 'Order'>;

describe('ModelNestedShape', () => {
  // Guard against the translation silently degrading to an open index
  // signature (`{ [x: string]: any }`). An open shape would make every
  // subsequent assertion in this file tautologically pass, since `any`
  // is equal to anything. Must stay the first assertion in the suite so
  // failures surface at the top of the report.
  it('has exactly the literal field names as keys (not an open index signature)', () => {
    expectTypeOf<keyof CustomerShape>().toEqualTypeOf<
      '_id' | 'name' | 'address' | 'workAddress' | 'stats'
    >();
    type StringIsKey = string extends keyof CustomerShape ? true : false;
    expectTypeOf<StringIsKey>().toEqualTypeOf<false>();
  });

  it('translates scalar fields to leaf DocField with concrete codec and nullable', () => {
    expectTypeOf<CustomerShape['_id']>().toEqualTypeOf<{
      readonly codecId: 'mongo/objectId@1';
      readonly nullable: false;
    }>();
    expectTypeOf<CustomerShape['name']>().toEqualTypeOf<{
      readonly codecId: 'mongo/string@1';
      readonly nullable: false;
    }>();
  });

  it('translates value-object fields to ObjectField carrying the sub-shape', () => {
    type Address = CustomerShape['address'];
    expectTypeOf<Address>().toExtend<ObjectField<NestedDocShape>>();
  });

  it('preserves parent nullable on the ObjectField marker', () => {
    type Address = CustomerShape['address'];
    type WorkAddress = CustomerShape['workAddress'];
    expectTypeOf<Address['nullable']>().toEqualTypeOf<false>();
    expectTypeOf<WorkAddress['nullable']>().toEqualTypeOf<true>();
  });

  it('recurses into nested value-object sub-shapes with literal keys', () => {
    // Same guard as the top-level keys check, applied to the recursed
    // sub-shape: if the VO recursion is broken, these would collapse
    // to `string` / `any` and every descendant assertion would be vacuous.
    expectTypeOf<keyof AddressShape>().toEqualTypeOf<'street' | 'city' | 'zip' | 'geo'>();
    expectTypeOf<keyof GeoShape>().toEqualTypeOf<'lat' | 'lng'>();

    expectTypeOf<AddressShape['street']>().toEqualTypeOf<{
      readonly codecId: 'mongo/string@1';
      readonly nullable: false;
    }>();
    expectTypeOf<AddressShape['zip']>().toEqualTypeOf<{
      readonly codecId: 'mongo/string@1';
      readonly nullable: true;
    }>();
    expectTypeOf<GeoShape['lat']>().toEqualTypeOf<{
      readonly codecId: 'mongo/double@1';
      readonly nullable: false;
    }>();
  });

  it('leaves unrelated fields on Order unchanged (no value objects)', () => {
    type OrderShape = ModelNestedShape<TestContract, 'Order'>;
    expectTypeOf<OrderShape['status']>().toEqualTypeOf<{
      readonly codecId: 'mongo/string@1';
      readonly nullable: false;
    }>();
  });
});

describe('ResolvePath', () => {
  it('resolves strict scalar lists to array leaves', () => {
    expectTypeOf<ResolvePath<ScalarListShape, 'strict'>>().toEqualTypeOf<{
      readonly codecId: 'mongo/array@1';
      readonly nullable: false;
    }>();
  });

  it('resolves nullable-element scalar lists to required array leaves', () => {
    expectTypeOf<ResolvePath<ScalarListShape, 'nullableElements'>>().toEqualTypeOf<{
      readonly codecId: 'mongo/array@1';
      readonly nullable: false;
    }>();
  });

  it('preserves nullable containers for strict-element scalar lists', () => {
    expectTypeOf<ResolvePath<ScalarListShape, 'nullableContainer'>>().toEqualTypeOf<{
      readonly codecId: 'mongo/array@1';
      readonly nullable: true;
    }>();
  });

  it('preserves nullable containers for nullable-element scalar lists', () => {
    expectTypeOf<ResolvePath<ScalarListShape, 'nullableBoth'>>().toEqualTypeOf<{
      readonly codecId: 'mongo/array@1';
      readonly nullable: true;
    }>();
  });

  it('preserves the codec and nullability of a nullable non-list scalar', () => {
    expectTypeOf<ResolvePath<ModelNestedShape<TestContract, 'Order'>, 'notes'>>().toEqualTypeOf<{
      readonly codecId: 'mongo/string@1';
      readonly nullable: true;
    }>();
  });

  it('resolves a top-level scalar path to its leaf DocField', () => {
    type Resolved = ResolvePath<CustomerShape, 'name'>;
    expectTypeOf<Resolved>().toEqualTypeOf<{
      readonly codecId: 'mongo/string@1';
      readonly nullable: false;
    }>();
  });

  it('resolves a top-level value-object root to an ObjectField', () => {
    type Resolved = ResolvePath<CustomerShape, 'address'>;
    expectTypeOf<Resolved>().toExtend<ObjectField<NestedDocShape>>();
  });

  it('walks a one-level nested path to the leaf DocField', () => {
    type Resolved = ResolvePath<CustomerShape, 'address.city'>;
    expectTypeOf<Resolved>().toEqualTypeOf<{
      readonly codecId: 'mongo/string@1';
      readonly nullable: false;
    }>();
  });

  it('walks a two-level nested path (address.geo.lat)', () => {
    type Resolved = ResolvePath<CustomerShape, 'address.geo.lat'>;
    expectTypeOf<Resolved>().toEqualTypeOf<{
      readonly codecId: 'mongo/double@1';
      readonly nullable: false;
    }>();
  });

  it('resolves an intermediate value-object path to its ObjectField', () => {
    type Resolved = ResolvePath<CustomerShape, 'address.geo'>;
    expectTypeOf<Resolved>().toExtend<ObjectField<NestedDocShape>>();
  });

  it('preserves leaf nullable (address.zip is nullable)', () => {
    type Resolved = ResolvePath<CustomerShape, 'address.zip'>;
    expectTypeOf<Resolved>().toEqualTypeOf<{
      readonly codecId: 'mongo/string@1';
      readonly nullable: true;
    }>();
  });

  it('returns never for an unknown top-level segment', () => {
    expectTypeOf<ResolvePath<CustomerShape, 'nope'>>().toBeNever();
  });

  it('returns never for an unknown nested segment', () => {
    expectTypeOf<ResolvePath<CustomerShape, 'address.bogus'>>().toBeNever();
  });

  it('returns never when traversing past a scalar leaf', () => {
    expectTypeOf<ResolvePath<CustomerShape, 'name.anything'>>().toBeNever();
  });
});

describe('ValidPaths', () => {
  it('includes top-level keys (scalar leaves and value-object roots)', () => {
    type Paths = ValidPaths<CustomerShape>;
    expectTypeOf<'_id'>().toExtend<Paths>();
    expectTypeOf<'name'>().toExtend<Paths>();
    expectTypeOf<'address'>().toExtend<Paths>();
    expectTypeOf<'workAddress'>().toExtend<Paths>();
    expectTypeOf<'stats'>().toExtend<Paths>();
  });

  it('includes recursively-discovered nested dot-paths', () => {
    type Paths = ValidPaths<CustomerShape>;
    expectTypeOf<'address.city'>().toExtend<Paths>();
    expectTypeOf<'address.street'>().toExtend<Paths>();
    expectTypeOf<'address.zip'>().toExtend<Paths>();
    expectTypeOf<'address.geo'>().toExtend<Paths>();
    expectTypeOf<'address.geo.lat'>().toExtend<Paths>();
    expectTypeOf<'address.geo.lng'>().toExtend<Paths>();
    expectTypeOf<'workAddress.geo.lng'>().toExtend<Paths>();
    expectTypeOf<'stats.visits'>().toExtend<Paths>();
    expectTypeOf<'stats.lastSeen'>().toExtend<Paths>();
  });

  it('rejects bogus paths', () => {
    type Paths = ValidPaths<CustomerShape>;
    // These should not assign.
    expectTypeOf<'nope'>().not.toExtend<Paths>();
    expectTypeOf<'address.bogus'>().not.toExtend<Paths>();
    expectTypeOf<'address.geo.bogus'>().not.toExtend<Paths>();
    expectTypeOf<'name.anything'>().not.toExtend<Paths>();
  });

  it('is never for an empty NestedDocShape (disables callable downstream of replacement stages)', () => {
    type Paths = ValidPaths<Record<string, never>>;
    expectTypeOf<Paths>().toBeNever();
  });
});
