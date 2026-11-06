import { expectTypeOf, test } from 'vitest';
import type {
  DatabasePolicies,
  DatabasePoliciesSchema,
  DeclaredDatabasePolicies,
  PartialDatabasePoliciesSchema,
} from '../src/control/database-policies';

type DeepReadonly<T> = T extends readonly (infer E)[]
  ? readonly DeepReadonly<E>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

test('the partial schema infers what a ref declares', () => {
  expectTypeOf<
    DeepReadonly<typeof PartialDatabasePoliciesSchema.infer>
  >().toEqualTypeOf<DeclaredDatabasePolicies>();
});

test('the full schema infers the policies in force', () => {
  expectTypeOf<
    DeepReadonly<typeof DatabasePoliciesSchema.infer>
  >().toEqualTypeOf<DatabasePolicies>();
});
