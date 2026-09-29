import type {
  BlockSymbol,
  InferBlock,
  ModelSymbol,
  ResolvedEntityReference,
} from '@internal/psl-parser';
import { describe, expectTypeOf, it } from 'vitest';
import type {
  nativeEnumSpec,
  policyBothPredicatesSpec,
  policyUsingOnlySpec,
  policyWithCheckOnlySpec,
  RlsPolicyExtensionBlock,
  roleSpec,
} from '../src/core/authoring';

type UsingOnlyValues = InferBlock<ReturnType<typeof policyUsingOnlySpec>>;
type WithCheckOnlyValues = InferBlock<ReturnType<typeof policyWithCheckOnlySpec>>;
type BothValues = InferBlock<ReturnType<typeof policyBothPredicatesSpec>>;

describe('policy specs infer the factory input values', () => {
  it('pins the shared shape: checked target, optional roles/predicates/permissive', () => {
    expectTypeOf<BothValues['target']>().toEqualTypeOf<ResolvedEntityReference<ModelSymbol>>();
    expectTypeOf<BothValues['using']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<BothValues['withCheck']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<BothValues['permissive']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<BothValues['roles']>().toEqualTypeOf<
      (ResolvedEntityReference<BlockSymbol> | string)[] | undefined
    >();
  });

  it('every keyword-specific output feeds the one factory input', () => {
    expectTypeOf<UsingOnlyValues>().toMatchTypeOf<BothValues>();
    expectTypeOf<WithCheckOnlyValues>().toMatchTypeOf<BothValues>();
    expectTypeOf<UsingOnlyValues>().not.toHaveProperty('withCheck');
    expectTypeOf<WithCheckOnlyValues>().not.toHaveProperty('using');
  });

  it('the factory input accepts readonly spec-inferred values', () => {
    expectTypeOf<BothValues>().toMatchTypeOf<RlsPolicyExtensionBlock['values']>();
    const readonlyValues: BothValues = {} as Readonly<BothValues>;
    void readonlyValues;
  });
});

describe('native enum and role specs', () => {
  it('native enum infers explicit string members only', () => {
    expectTypeOf<InferBlock<ReturnType<typeof nativeEnumSpec>>>().toEqualTypeOf<
      Record<string, string>
    >();
  });

  it('role infers an empty fixed body', () => {
    expectTypeOf<InferBlock<ReturnType<typeof roleSpec>>>().toEqualTypeOf<Record<never, never>>();
  });
});
