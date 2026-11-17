import { describe, expectTypeOf, test } from 'vitest';
import type { DefaultModelInputRow, MutationUpdateInput, ScalarUpdateInput } from '../src/types';
import type { Contract } from './fixtures/polymorphism/generated/contract';

type PublicNamespace = Contract['domain']['namespaces']['public'];
type PublicTask = PublicNamespace['models']['Task'];

type ContractWithShadowTask = Omit<Contract, 'domain'> & {
  readonly domain: Omit<Contract['domain'], 'namespaces'> & {
    readonly namespaces: Contract['domain']['namespaces'] & {
      readonly shadow: Omit<PublicNamespace, 'models'> & {
        readonly models: { readonly Task: Omit<PublicTask, 'discriminator' | 'variants'> };
      };
    };
  };
};

describe('update data when another namespace has a same-named model without a discriminator', () => {
  test('rejects the discriminator of the model in its own namespace', () => {
    // @ts-expect-error
    const scalar: ScalarUpdateInput<ContractWithShadowTask, 'Task', 'public'> = { type: 'bug' };
    // @ts-expect-error
    const mutation: MutationUpdateInput<ContractWithShadowTask, 'Task', 'public'> = { type: 'bug' };
    void [scalar, mutation];
  });
});

describe('update data of a model without a discriminator', () => {
  test('is the partial input row', () => {
    expectTypeOf<ScalarUpdateInput<Contract, 'Project'>>().toEqualTypeOf<
      Partial<DefaultModelInputRow<Contract, 'Project'>>
    >();
  });
});
