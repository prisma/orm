import { expectTypeOf, test } from 'vitest';
import type { ArgType, InspectableArgType, Param, PositionalParam } from '../src/exports';

test('parameter rules retain discriminated metadata through nested containers', () => {
  function inspect(parameter: Param<unknown, never> | PositionalParam<unknown, never>) {
    const rule = parameter.type;
    expectTypeOf(rule).not.toBeAny();
    expectTypeOf(rule).toExtend<InspectableArgType<never>>();
    if (rule.kind === 'list' || rule.kind === 'record') {
      expectTypeOf(rule.of).not.toBeAny();
      expectTypeOf(rule.of).toEqualTypeOf<ArgType<unknown, never>>();
      if (rule.of.kind === 'entityRef') {
        expectTypeOf(rule.of.expected.kind).toExtend<string>();
      }
    }
    if (rule.kind === 'oneOf') {
      expectTypeOf(rule.alternatives[0]).not.toBeAny();
      expectTypeOf(rule.alternatives[0]).toExtend<InspectableArgType<never>>();
    }
    if (rule.kind === 'funcCall') {
      expectTypeOf(rule.signature.positional?.[0]?.type).not.toBeAny();
      expectTypeOf(rule.signature.positional?.[0]?.type).toExtend<
        InspectableArgType<never> | undefined
      >();
      expectTypeOf(rule.signature.named?.['value']?.type).toExtend<
        InspectableArgType<never> | undefined
      >();
    }
  }
  void inspect;
});

test('rules with erased metadata are not assignable to parameters', () => {
  type Rule = Param<unknown, never>['type'];
  type Erased = Pick<Rule, 'kind' | 'label' | 'parse'>;
  expectTypeOf<Erased & { readonly kind: 'list' }>().not.toExtend<Rule>();
  expectTypeOf<Erased & { readonly kind: 'record' }>().not.toExtend<Rule>();
  expectTypeOf<Erased & { readonly kind: 'oneOf' }>().not.toExtend<Rule>();
  expectTypeOf<Erased & { readonly kind: 'funcCall' }>().not.toExtend<Rule>();
  expectTypeOf<Erased & { readonly kind: 'entityRef' }>().not.toExtend<Rule>();
});
