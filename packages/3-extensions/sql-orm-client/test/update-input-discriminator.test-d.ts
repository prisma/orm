import { describe, expectTypeOf, test } from 'vitest';
import type {
  DefaultModelInputRow,
  MutationUpdateInput,
  RelationMutationUpdateAllData,
  ScalarUpdateInput,
} from '../src/types';
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

describe('nested update data when another namespace has a same-named model without a discriminator', () => {
  test('rejects the discriminator of the relation target', () => {
    const viaUpdateAll: MutationUpdateInput<ContractWithShadowTask, 'Project'> = {
      // @ts-expect-error
      tasks: (tasks) => tasks.updateAll({ type: 'bug' }),
    };
    const viaWhere: MutationUpdateInput<ContractWithShadowTask, 'Project'> = {
      // @ts-expect-error
      tasks: (tasks) => tasks.where({ id: 1 }).updateAll({ type: 'bug' }),
    };
    const viaDescriptor: MutationUpdateInput<ContractWithShadowTask, 'Project'> = {
      // @ts-expect-error
      tasks: (tasks) => ({ ...tasks.updateAll({ title: 'Seen' }), data: { type: 'bug' } }),
    };
    void [viaUpdateAll, viaWhere, viaDescriptor];
  });

  test('accepts the field on the model without a discriminator', () => {
    const data: RelationMutationUpdateAllData<ContractWithShadowTask, 'Task', never, 'shadow'> = {
      type: 'bug',
    };
    void data;
  });
});

describe('update data of a model without a discriminator', () => {
  test('is the partial input row', () => {
    expectTypeOf<ScalarUpdateInput<Contract, 'Project'>>().toEqualTypeOf<
      Partial<DefaultModelInputRow<Contract, 'Project'>>
    >();
  });
});
