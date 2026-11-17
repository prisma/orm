import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  AuthoringContributions,
  AuthoringPslBlockDescriptor,
  AuthoringPslBlockDescriptorNamespace,
} from '../src/shared/framework-authoring';
import { isAuthoringPslBlockDescriptor } from '../src/shared/framework-authoring';
import type { PslExtensionBlock } from '../src/shared/psl-extension-block';

describe('AuthoringPslBlockDescriptor', () => {
  it('a declarative descriptor with an erased callable spec satisfies the type', () => {
    const descriptor = {
      kind: 'pslBlock',
      keyword: 'policy_select',
      discriminator: 'postgres-policy-select',
      name: { required: true },
      spec: () => ({}),
    } satisfies AuthoringPslBlockDescriptor;

    void descriptor;
  });

  it('the retired parameter DSL fields are not part of the descriptor shape', () => {
    const base = {
      kind: 'pslBlock',
      keyword: 'policy_select',
      discriminator: 'postgres-policy-select',
      name: { required: true },
      spec: () => ({}),
    };
    const withParameters = {
      ...base,
      // @ts-expect-error — parameters is not part of the descriptor shape any more
      parameters: {},
    } satisfies AuthoringPslBlockDescriptor;
    void withParameters;
    const withVariadic = {
      ...base,
      // @ts-expect-error — variadicParameters is not part of the descriptor shape any more
      variadicParameters: true,
    } satisfies AuthoringPslBlockDescriptor;
    void withVariadic;
  });

  it('a descriptor without a spec does NOT satisfy the type', () => {
    const missingSpec = {
      kind: 'pslBlock',
      keyword: 'policy_select',
      discriminator: 'postgres-policy-select',
      name: { required: true },
      // @ts-expect-error — spec is required on the descriptor
    } satisfies AuthoringPslBlockDescriptor;
    void missingSpec;
  });

  it('a descriptor with a parser function field does NOT satisfy the type', () => {
    const base = {
      kind: 'pslBlock',
      keyword: 'policy_select',
      discriminator: 'postgres-policy-select',
      name: { required: true },
      spec: () => ({}),
    };
    const withParser = {
      ...base,
      // @ts-expect-error — parser is not part of the declarative descriptor shape
      parser: () => ({ kind: 'postgres-policy-select', name: 'x', span: {} }),
    } satisfies AuthoringPslBlockDescriptor;
    void withParser;
  });

  it('AuthoringContributions accepts a pslBlockDescriptors namespace', () => {
    const contributions: AuthoringContributions = {
      pslBlockDescriptors: {
        policySelect: {
          kind: 'pslBlock',
          keyword: 'policy_select',
          discriminator: 'postgres-policy-select',
          name: { required: true },
          spec: () => ({}),
        },
      },
    };
    expectTypeOf(contributions.pslBlockDescriptors).not.toBeUndefined();
  });
});

describe('isAuthoringPslBlockDescriptor', () => {
  const descriptor = {
    kind: 'pslBlock',
    keyword: 'policy_select',
    discriminator: 'postgres-policy-select',
    name: { required: true },
    spec: () => ({}),
  } satisfies AuthoringPslBlockDescriptor;

  it('returns true for a declarative descriptor', () => {
    expect(isAuthoringPslBlockDescriptor(descriptor)).toBe(true);
  });

  it('returns false for a sub-namespace value', () => {
    const namespace = { nested: descriptor } satisfies AuthoringPslBlockDescriptorNamespace;
    expect(isAuthoringPslBlockDescriptor(namespace)).toBe(false);
  });

  it('narrows to AuthoringPslBlockDescriptor when it returns true', () => {
    const node: AuthoringPslBlockDescriptor | AuthoringPslBlockDescriptorNamespace = descriptor;
    if (isAuthoringPslBlockDescriptor(node)) {
      expectTypeOf(node).toEqualTypeOf<AuthoringPslBlockDescriptor>();
    }
  });
});

describe('block attributes', () => {
  it('a descriptor declares its block attributes as erased factories, sibling of spec', () => {
    const descriptor = {
      kind: 'pslBlock',
      keyword: 'native_enum',
      discriminator: 'native_enum',
      name: { required: true },
      spec: () => ({}),
      attributes: { map: () => ({ level: 'block', name: 'map' }) },
    } as const;
    expectTypeOf(descriptor).toMatchTypeOf<AuthoringPslBlockDescriptor>();
  });
});

describe('PslExtensionBlock source shape', () => {
  it('carries no interpreted attribute view; only printable blockAttributes remain', () => {
    expectTypeOf<PslExtensionBlock>().not.toHaveProperty('attributes');
    expectTypeOf<PslExtensionBlock>().toHaveProperty('blockAttributes');
  });
});
