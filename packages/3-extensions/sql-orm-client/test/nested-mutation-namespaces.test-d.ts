import type { NamespaceId } from '@internal/contract/types';
import { describe, test } from 'vitest';
import type { MutationCreateInput, MutationUpdateInput } from '../src/types';
import type { Contract } from './fixtures/polymorphism/generated/contract';

type PublicNamespace = Contract['domain']['namespaces']['public'];
type PublicModels = PublicNamespace['models'];
type PublicTasksRelation = PublicModels['Project']['relations']['tasks'];

type ShadowProject = Omit<PublicModels['Project'], 'relations'> & {
  readonly relations: {
    readonly tasks: Omit<PublicTasksRelation, 'to'> & {
      readonly to: { readonly namespace: 'shadow' & NamespaceId; readonly model: 'Task' };
    };
  };
};

type ContractWithShadowProject = Omit<Contract, 'domain'> & {
  readonly domain: Omit<Contract['domain'], 'namespaces'> & {
    readonly namespaces: Contract['domain']['namespaces'] & {
      readonly shadow: Omit<PublicNamespace, 'models'> & {
        readonly models: {
          readonly Project: ShadowProject;
          readonly Task: Omit<PublicModels['Task'], 'discriminator' | 'variants'>;
        };
      };
    };
  };
};

type Shadowed = ContractWithShadowProject;

describe('nested mutations when two namespaces declare the parent model with relations to different namespaces', () => {
  test('updateAll resolves the discriminator in the target namespace of the parent', () => {
    const inPublic: MutationUpdateInput<Shadowed, 'Project', 'public'> = {
      // @ts-expect-error
      tasks: (tasks) => tasks.where({ id: 1 }).updateAll({ type: 'bug' }),
    };
    const inShadow: MutationUpdateInput<Shadowed, 'Project', 'shadow'> = {
      tasks: (tasks) => tasks.where({ id: 1 }).updateAll({ type: 'bug' }),
    };
    void [inPublic, inShadow];
  });

  test('variant() is offered only for the polymorphic target', () => {
    const inPublic: MutationUpdateInput<Shadowed, 'Project', 'public'> = {
      tasks: (tasks) => tasks.variant('bug').updateAll({ title: 'Seen' }),
    };
    const inShadow: MutationUpdateInput<Shadowed, 'Project', 'shadow'> = {
      // @ts-expect-error
      tasks: (tasks) => tasks.variant('bug').updateAll({ title: 'Seen' }),
    };
    void [inPublic, inShadow];
  });

  test('a create without a variant is refused only for the polymorphic target', () => {
    const inPublic: MutationUpdateInput<Shadowed, 'Project', 'public'> = {
      // @ts-expect-error
      tasks: (tasks) => tasks.create({ id: 1, title: 'Crash', type: 'bug' }),
    };
    const inShadow: MutationUpdateInput<Shadowed, 'Project', 'shadow'> = {
      tasks: (tasks) => tasks.create({ id: 1, title: 'Crash', type: 'bug' }),
    };
    const createdInShadow: MutationCreateInput<Shadowed, 'Project', 'shadow'> = {
      id: 1,
      name: 'Roadmap',
      tasks: (tasks) => tasks.create({ id: 1, title: 'Crash', type: 'bug' }),
    };
    void [inPublic, inShadow, createdInShadow];
  });
});
