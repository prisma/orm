import type {
  AuthoringEntityContext,
  AuthoringEntityTypeDescriptor,
  AuthoringEntityTypeNamespace,
} from '@internal/framework-components/authoring';
import { createDataTypeLookup, emptyCodecLookup } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { createEntityHelpersFromNamespace } from '../src/composed-helpers-scaffolding';

type Helper = (...args: readonly unknown[]) => unknown;

function helperAt(surface: Record<string, unknown>, path: string): Helper {
  const resolved = path
    .split('.')
    .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], surface);
  if (typeof resolved !== 'function') {
    throw new Error(`expected a helper at "${path}", found ${typeof resolved}`);
  }
  return resolved as Helper;
}

const ctx: AuthoringEntityContext = {
  family: 'sql',
  target: 'postgres',
  codecLookup: { ...emptyCodecLookup, descriptorFor: () => undefined },
  dataTypeLookup: createDataTypeLookup([]),
};

const badgeDescriptor: AuthoringEntityTypeDescriptor = {
  kind: 'entity',
  discriminator: 'badge',
  output: {
    factory: (input: { readonly label: string }, factoryCtx: AuthoringEntityContext) => ({
      label: input.label,
      family: factoryCtx.family,
      target: factoryCtx.target,
    }),
  },
};

const labelDescriptor: AuthoringEntityTypeDescriptor = {
  kind: 'entity',
  discriminator: 'label',
  args: [{ kind: 'string', name: 'text' }],
  output: { template: { text: { kind: 'arg', index: 0 } } },
};

describe('createEntityHelpersFromNamespace', () => {
  describe('given a namespace of leaf descriptors and nested namespaces', () => {
    const helpers = createEntityHelpersFromNamespace(
      { badge: badgeDescriptor, pg: { label: labelDescriptor } },
      { ctx },
    );

    it('mirrors the namespace tree as callables', () => {
      expect(helpers).toEqual({
        badge: expect.any(Function),
        pg: { label: expect.any(Function) },
      });
    });

    it('invokes a factory-output descriptor with the input and the authoring context', () => {
      expect(helperAt(helpers, 'badge')({ label: 'gold' })).toEqual({
        label: 'gold',
        family: 'sql',
        target: 'postgres',
      });
    });

    it('resolves a template-output descriptor against the supplied arguments', () => {
      expect(helperAt(helpers, 'pg.label')('hello')).toEqual({ text: 'hello' });
    });

    it('reports argument errors under the dotted namespace path', () => {
      expect(() => helperAt(helpers, 'pg.label')()).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.ARGUMENT_INVALID',
          message: 'pg.label expects 1 argument(s), received 0',
        }),
      );
    });
  });

  describe('given entries that are not leaf descriptors', () => {
    it('recurses into an object whose kind is not entity', () => {
      const namespace = {
        legacy: { kind: 'preset', discriminator: 'legacy', nested: badgeDescriptor },
      } as unknown as AuthoringEntityTypeNamespace;

      expect(createEntityHelpersFromNamespace(namespace, { ctx })).toEqual({
        legacy: { nested: expect.any(Function) },
      });
    });

    it('recurses into an entity object whose discriminator is absent or empty', () => {
      const namespace = {
        unnamed: { kind: 'entity', discriminator: '', nested: badgeDescriptor },
        undiscriminated: { kind: 'entity', nested: badgeDescriptor },
      } as unknown as AuthoringEntityTypeNamespace;

      expect(createEntityHelpersFromNamespace(namespace, { ctx })).toEqual({
        unnamed: { nested: expect.any(Function) },
        undiscriminated: { nested: expect.any(Function) },
      });
    });

    it('drops primitive, null, and array entries', () => {
      const namespace = {
        text: 'not-a-descriptor',
        count: 7,
        missing: null,
        list: [badgeDescriptor],
        badge: badgeDescriptor,
      } as unknown as AuthoringEntityTypeNamespace;

      expect(createEntityHelpersFromNamespace(namespace, { ctx })).toEqual({
        badge: expect.any(Function),
      });
    });
  });

  it('returns an empty surface for an empty namespace', () => {
    expect(createEntityHelpersFromNamespace({}, { ctx })).toEqual({});
  });
});
