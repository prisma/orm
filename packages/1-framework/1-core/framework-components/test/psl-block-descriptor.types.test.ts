import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  AuthoringContributions,
  AuthoringPslBlockDescriptor,
  AuthoringPslBlockDescriptorNamespace,
} from '../src/shared/framework-authoring';
import { isAuthoringPslBlockDescriptor } from '../src/shared/framework-authoring';
import type {
  PslBlockParam,
  PslBlockParamList,
  PslBlockParamOption,
  PslBlockParamRef,
  PslBlockParamValue,
  PslExtensionBlock,
  PslExtensionBlockParsedAttribute,
} from '../src/shared/psl-extension-block';

describe('PslBlockParam discriminated union', () => {
  it('four kinds cover the union exhaustively', () => {
    function assertExhaustive(param: PslBlockParam): string {
      switch (param.kind) {
        case 'ref':
          return param.refKind;
        case 'value':
          return param.codecId;
        case 'option':
          return param.values[0] ?? '';
        case 'list':
          return assertExhaustive(param.of);
      }
    }
    expectTypeOf(assertExhaustive).toBeFunction();
  });

  it('ref narrows to PslBlockParamRef', () => {
    const param = { kind: 'ref', refKind: 'model', scope: 'same-namespace' } as const;
    expectTypeOf(param).toMatchTypeOf<PslBlockParamRef>();
    expectTypeOf(param.refKind).toEqualTypeOf<'model'>();
    expectTypeOf(param.scope).toEqualTypeOf<'same-namespace'>();
  });

  it('value narrows to PslBlockParamValue', () => {
    const param = { kind: 'value', codecId: 'String' } as const;
    expectTypeOf(param).toMatchTypeOf<PslBlockParamValue>();
    expectTypeOf(param.codecId).toEqualTypeOf<'String'>();
  });

  it('option narrows to PslBlockParamOption', () => {
    const param = { kind: 'option', values: ['permissive', 'restrictive'] as const } as const;
    expectTypeOf(param).toMatchTypeOf<PslBlockParamOption>();
  });

  it('list narrows to PslBlockParamList and allows nesting', () => {
    const param = {
      kind: 'list',
      of: { kind: 'ref', refKind: 'role', scope: 'cross-space' },
    } as const;
    expectTypeOf(param).toMatchTypeOf<PslBlockParamList>();
    expectTypeOf(param.of).toMatchTypeOf<PslBlockParamRef>();
  });
});

describe('AuthoringPslBlockDescriptor', () => {
  it('a valid declarative descriptor literal satisfies the type', () => {
    const descriptor = {
      kind: 'pslBlock',
      keyword: 'policy_select',
      discriminator: 'postgres-policy-select',
      name: { required: true },
      parameters: {
        target: { kind: 'ref', refKind: 'model', scope: 'same-namespace', required: true },
        as: { kind: 'option', values: ['permissive', 'restrictive'], required: false },
        roles: {
          kind: 'list',
          of: { kind: 'ref', refKind: 'role', scope: 'cross-space' },
          required: false,
        },
        using: { kind: 'value', codecId: 'String', required: true },
      },
    } satisfies AuthoringPslBlockDescriptor;

    expectTypeOf(descriptor.kind).toEqualTypeOf<'pslBlock'>();
    expectTypeOf(descriptor.keyword).toEqualTypeOf<string>();
    expectTypeOf(descriptor.discriminator).toEqualTypeOf<string>();
  });

  it('a descriptor with a parser function field does NOT satisfy the type', () => {
    const base = {
      kind: 'pslBlock',
      keyword: 'policy_select',
      discriminator: 'postgres-policy-select',
      name: { required: true },
      parameters: {},
    };
    const withParser = {
      ...base,
      // @ts-expect-error — parser is not part of the declarative descriptor shape
      parser: () => ({ kind: 'postgres-policy-select', name: 'x', parameters: {}, span: {} }),
    } satisfies AuthoringPslBlockDescriptor;
    void withParser;
  });

  it('a descriptor with a printer function field does NOT satisfy the type', () => {
    const base = {
      kind: 'pslBlock',
      keyword: 'policy_select',
      discriminator: 'postgres-policy-select',
      name: { required: true },
      parameters: {},
    };
    const withPrinter = {
      ...base,
      // @ts-expect-error — printer is not part of the declarative descriptor shape
      printer: () => '',
    } satisfies AuthoringPslBlockDescriptor;
    void withPrinter;
  });

  it('AuthoringContributions accepts a pslBlockDescriptors namespace', () => {
    const contributions: AuthoringContributions = {
      pslBlockDescriptors: {
        policySelect: {
          kind: 'pslBlock',
          keyword: 'policy_select',
          discriminator: 'postgres-policy-select',
          name: { required: true },
          parameters: {
            target: { kind: 'ref', refKind: 'model', scope: 'same-namespace', required: true },
          },
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
    parameters: { target: { kind: 'ref', refKind: 'model', scope: 'same-namespace' } },
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
  it('a descriptor declares its block attributes as erased factories, sibling of parameters', () => {
    const descriptor = {
      kind: 'pslBlock',
      keyword: 'native_enum',
      discriminator: 'native_enum',
      name: { required: true },
      parameters: {},
      attributes: { map: () => ({ level: 'block', name: 'map' }) },
    } as const;
    expectTypeOf(descriptor).toMatchTypeOf<AuthoringPslBlockDescriptor>();
    expectTypeOf<AuthoringPslBlockDescriptor['attributes']>().toEqualTypeOf<
      Readonly<Record<string, unknown>> | undefined
    >();
  });

  it('a block node carries its parsed attributes as plain data keyed by attribute name', () => {
    expectTypeOf<PslExtensionBlock['attributes']>().toEqualTypeOf<
      Readonly<Record<string, PslExtensionBlockParsedAttribute>>
    >();
    expectTypeOf<PslExtensionBlockParsedAttribute['args']>().toEqualTypeOf<
      Readonly<Record<string, unknown>>
    >();
    expectTypeOf<Omit<PslExtensionBlock, 'attributes'>>().not.toMatchTypeOf<PslExtensionBlock>();
  });
});
