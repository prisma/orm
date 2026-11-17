import { expectTypeOf } from 'vitest';
import type {
  Expression,
  FieldAccessor,
  LeafExpression,
  ObjectExpression,
} from '../src/field-accessor';
import { createFieldAccessor } from '../src/field-accessor';
import { mongoQuery } from '../src/query';
import type { ModelNestedShape, NestedDocShape, ObjectField } from '../src/resolve-path';
import type { DocField, ModelToDocShape } from '../src/types';
import { contextOf } from './fixtures/test-context';
import type { TContract, TestContract } from './fixtures/test-contract';

declare const contract: TContract;

type CustomerShape = ModelToDocShape<TestContract, 'Customer'>;
type CustomerNested = ModelNestedShape<TestContract, 'Customer'>;

describe('Expression<F> conditional resolution', () => {
  it('resolves to LeafExpression<F> for a scalar leaf', () => {
    type StringField = { readonly codecId: 'mongo/string@1'; readonly nullable: false };
    expectTypeOf<Expression<StringField>>().toEqualTypeOf<LeafExpression<StringField>>();
  });

  it('resolves to ObjectExpression<N> for an ObjectField marker', () => {
    type Inner = {
      readonly leaf: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
    };
    type Obj = ObjectField<Inner>;
    expectTypeOf<Expression<Obj>>().toEqualTypeOf<ObjectExpression<Inner>>();
  });

  it('keeps plain DocField resolving to LeafExpression (back-compat)', () => {
    expectTypeOf<Expression<DocField>>().toEqualTypeOf<LeafExpression<DocField>>();
  });
});

describe('FieldAccessor<S, N> property form', () => {
  it('exposes property access as Expression per flat shape', () => {
    type F = FieldAccessor<CustomerShape, CustomerNested>;
    type AddressExpr = F['address'];
    // address in the flat shape is the codec-level leaf (valueObject is
    // represented as an opaque string codecId on the flat DocShape). The
    // nested Expression<ObjectField> surface is only reachable via the
    // callable form (see below).
    expectTypeOf<AddressExpr>().toExtend<LeafExpression<DocField>>();
  });

  it('exposes scalar leaves via property access', () => {
    type F = FieldAccessor<CustomerShape, CustomerNested>;
    expectTypeOf<F['name']>().toExtend<LeafExpression<DocField>>();
  });
});

describe('FieldAccessor<S, N> callable form (strict)', () => {
  it('accepts a top-level scalar path and returns a leaf expression', () => {
    const f = createFieldAccessor<CustomerShape, CustomerNested>();
    const expr = f('name');
    expectTypeOf(expr).toExtend<LeafExpression<DocField>>();
  });

  it('accepts a top-level value-object root and returns an ObjectExpression', () => {
    const f = createFieldAccessor<CustomerShape, CustomerNested>();
    const expr = f('address');
    expectTypeOf(expr).toExtend<ObjectExpression<NestedDocShape>>();
  });

  it('accepts one-level nested paths', () => {
    const f = createFieldAccessor<CustomerShape, CustomerNested>();
    const expr = f('address.city');
    expectTypeOf(expr).toExtend<LeafExpression<DocField>>();
  });

  it('accepts two-level nested paths', () => {
    const f = createFieldAccessor<CustomerShape, CustomerNested>();
    const expr = f('address.geo.lat');
    expectTypeOf(expr).toExtend<LeafExpression<DocField>>();
  });

  it('rejects unknown top-level paths at compile time', () => {
    const f = createFieldAccessor<CustomerShape, CustomerNested>();
    // @ts-expect-error -- 'bogus' is not a valid path
    f('bogus');
  });

  it('rejects unknown nested paths at compile time', () => {
    const f = createFieldAccessor<CustomerShape, CustomerNested>();
    // @ts-expect-error -- 'address.bogus' is not a valid path
    f('address.bogus');
    // @ts-expect-error -- 'address.geo.bogus' is not a valid path
    f('address.geo.bogus');
  });

  it('rejects over-traversal past a scalar leaf', () => {
    const f = createFieldAccessor<CustomerShape, CustomerNested>();
    // @ts-expect-error -- 'name.anything' walks past a scalar
    f('name.anything');
  });

  it('disables callable form when nested shape is empty (default)', () => {
    // Default N = Record<string, never>. ValidPaths<N> = never, so the
    // callable refuses any string at the type level — matching the state
    // downstream of replacement stages.
    const f = createFieldAccessor<CustomerShape>();
    // @ts-expect-error -- callable is disabled (ValidPaths resolves to never)
    f('name');
    // @ts-expect-error -- no path is accepted when N is empty
    f('address.city');
  });
});

describe('ObjectExpression operator surface', () => {
  it('exposes the reduced surface: set, unset, exists, eq(null), ne(null)', () => {
    const f = createFieldAccessor<CustomerShape, CustomerNested>();
    const expr = f('address');
    expectTypeOf(expr.set).toBeFunction();
    expectTypeOf(expr.unset).toBeFunction();
    expectTypeOf(expr.exists).toBeFunction();
    expectTypeOf(expr.eq).toBeFunction();
    expectTypeOf(expr.ne).toBeFunction();
  });

  it('eq/ne only accept null on an ObjectExpression', () => {
    const f = createFieldAccessor<CustomerShape, CustomerNested>();
    const expr = f('address');
    expr.eq(null);
    expr.ne(null);
    // @ts-expect-error -- arbitrary values are not allowed on an object path
    expr.eq('123 Main St');
    // @ts-expect-error -- arbitrary values are not allowed on an object path
    expr.ne(42);
  });

  it('does not expose leaf-only operators (inc, push, gt, …)', () => {
    const f = createFieldAccessor<CustomerShape, CustomerNested>();
    const expr = f('address');
    // @ts-expect-error -- inc is leaf-only
    expr.inc(1);
    // @ts-expect-error -- gt is leaf-only
    expr.gt(0);
    // @ts-expect-error -- push is leaf-only
    expr.push({});
  });

  it('exposes the full leaf surface on a leaf path', () => {
    const f = createFieldAccessor<CustomerShape, CustomerNested>();
    const leaf = f('address.geo.lat');
    // Leaf paths retain the full operator surface.
    leaf.eq(1);
    leaf.gt(0);
    leaf.inc(1);
    leaf.mul(2);
    leaf.set(99);
  });
});

describe('FieldAccessor.rawPath escape hatch', () => {
  it('accepts an arbitrary string path without contract validation', () => {
    const f = createFieldAccessor<CustomerShape, CustomerNested>();
    const expr = f.rawPath('status');
    expectTypeOf(expr).toExtend<LeafExpression<DocField>>();
  });

  it('returns the full leaf operator surface (set, exists, inc, …)', () => {
    const f = createFieldAccessor<CustomerShape, CustomerNested>();
    const expr = f.rawPath('status');
    expectTypeOf(expr.set).toBeFunction();
    expectTypeOf(expr.unset).toBeFunction();
    expectTypeOf(expr.exists).toBeFunction();
    expectTypeOf(expr.inc).toBeFunction();
    expectTypeOf(expr.push).toBeFunction();
  });

  it('accepts paths that are not in ValidPaths<N>', () => {
    const f = createFieldAccessor<CustomerShape, CustomerNested>();
    // 'status' is not a valid path on Customer; `f.rawPath` must still
    // accept it — that is the whole point of the escape hatch (migration
    // authoring where the target field is not yet in the contract).
    f.rawPath('status');
    f.rawPath('deeply.nested.not.in.contract');
  });

  it('remains available when N is empty (callable disabled)', () => {
    const f = createFieldAccessor<CustomerShape>();
    // Callable (strict) is disabled because ValidPaths<{}> = never.
    // `f.rawPath` has no such dependency on N and remains usable.
    const expr = f.rawPath('status');
    expectTypeOf(expr).toExtend<LeafExpression<DocField>>();
  });

  it('narrows the return via the explicit generic', () => {
    const f = createFieldAccessor<CustomerShape, CustomerNested>();
    type StringField = { readonly codecId: 'mongo/string@1'; readonly nullable: false };
    const expr = f.rawPath<StringField>('status');
    expectTypeOf(expr).toEqualTypeOf<LeafExpression<StringField>>();
  });

  it('does not shadow a legitimate top-level `raw` field', () => {
    // Regression test: the escape hatch is named `rawPath`, not `raw`, so a
    // user model with a `raw` field still resolves `f.raw` to the field
    // expression (via the mapped-type property form) rather than to the
    // escape-hatch function.
    type ModelWithRawField = {
      readonly id: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
      readonly raw: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
    };
    const f = createFieldAccessor<ModelWithRawField>();
    expectTypeOf(f.raw).toExtend<LeafExpression<DocField>>();
    expectTypeOf(f.raw).not.toBeFunction();
  });
});

describe('Pipeline integration — N threading', () => {
  it('CollectionHandle.match callback allows callable dot-path access', () => {
    const p = mongoQuery({ context: contextOf(contract) });
    p.from('customers').match((f) => f('address.city').eq('London'));
    p.from('customers').match((f) => f('address.geo.lat').gt(0));
  });

  it('FilteredCollection.updateMany callback allows callable dot-path access', () => {
    const p = mongoQuery({ context: contextOf(contract) });
    p.from('customers')
      .match((f) => f('address.city').eq('London'))
      .updateMany((f) => [f('address.zip').set('SW1'), f('stats.visits').inc(1)]);
  });

  it('rejects bogus paths in match callback', () => {
    const p = mongoQuery({ context: contextOf(contract) });
    p.from('customers').match((f) =>
      // @ts-expect-error -- 'address.bogus' is not a valid path
      f('address.bogus').eq('x'),
    );
  });

  it('additive stages (sort/addFields/redact) preserve callable dot-paths', () => {
    const p = mongoQuery({ context: contextOf(contract) });
    p.from('customers')
      .sort({ name: 1 })
      .match((f) => f('address.city').eq('London'));

    p.from('customers')
      .addFields((_f) => ({}))
      .match((f) => f('address.city').eq('London'));
  });

  it('replacement stages (group/project/replaceRoot) disable callable dot-paths', () => {
    const p = mongoQuery({ context: contextOf(contract) });
    const grouped = p.from('customers').group((f) => ({ _id: f.name, count: f._id }));
    // After group, N has been reset. The flat Shape no longer contains
    // value objects, and the callable form rejects any string.
    grouped.match((f) => {
      // @ts-expect-error -- callable disabled after replacement stage
      f('address.city').eq('London');
      return f._id.exists();
    });

    const projected = p.from('customers').project('name');
    projected.match((f) => {
      // @ts-expect-error -- callable disabled after projection
      f('address.city').eq('London');
      return f.name.exists();
    });
  });
});
