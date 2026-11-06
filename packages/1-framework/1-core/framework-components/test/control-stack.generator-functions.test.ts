import { type as arktype } from 'arktype';
import { describe, expect, it } from 'vitest';
import type { CreateControlStackInput } from '../src/control/control-stack';
import { createControlStack } from '../src/control/control-stack';
import { dataType } from '../src/shared/data-type';
import type { GeneratorFunctionContribution } from '../src/shared/generator-functions';

function stubInput(input: Record<string, unknown>): CreateControlStackInput {
  return input as unknown as CreateControlStackInput;
}

const slugid: GeneratorFunctionContribution = {
  name: 'slugid',
  signature: { documentation: 'slugid' },
  bindings: [
    {
      codecIds: ['text@1'],
      generatorIds: ['slugid'],
      resolve: () => ({ ok: true, generator: { kind: 'generator', id: 'slugid' } }),
      printArguments: () => ({ args: {}, text: '' }),
    },
  ],
};

function stackWith(generatorIds: readonly string[]) {
  return createControlStack(
    stubInput({
      family: { kind: 'family', id: 'family', version: '0.0.1' },
      target: { kind: 'target', id: 'target', version: '0.0.1' },
      adapter: {
        kind: 'adapter',
        id: 'adapter',
        version: '0.0.1',
        controlMutationDefaults: {
          defaultFunctionRegistry: new Map(),
          generatorDescriptors: generatorIds.map((id) => ({ id })),
        },
      },
      extensions: [
        { kind: 'extension', id: 'slugid-pack', version: '0.0.1', generatorFunctions: [slugid] },
      ],
    }),
  );
}

describe('createControlStack generator functions', () => {
  it('exposes the generator functions its components contribute', () => {
    const stack = stackWith(['slugid']);
    expect(
      stack.generatorFunctions.resolve(
        { name: 'slugid', args: {} },
        { codecId: 'text@1', typeParams: undefined, length: undefined },
      ),
    ).toEqual({ ok: true, generator: { kind: 'generator', id: 'slugid' } });
  });

  it('refuses an extension that registers a generator another component registers', () => {
    expect(() =>
      createControlStack(
        stubInput({
          family: {
            kind: 'family',
            id: 'sql',
            version: '0.0.1',
            controlMutationDefaults: {
              defaultFunctionRegistry: new Map(),
              generatorDescriptors: [{ id: 'uuidv4' }],
            },
          },
          target: { kind: 'target', id: 'target', version: '0.0.1' },
          extensions: [
            {
              kind: 'extension',
              id: 'uuid-codec-pack',
              version: '0.0.1',
              controlMutationDefaults: {
                defaultFunctionRegistry: new Map(),
                generatorDescriptors: [{ id: 'uuidv4' }],
              },
            },
          ],
        }),
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
        message:
          'Generator "uuidv4" is registered by both "sql" and "uuid-codec-pack". Register each generator once, in the component that defines it.',
      }),
    );
  });

  it('refuses a binding that produces a generator no component registers', () => {
    expect(() => stackWith(['uuidv4'])).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
        message:
          'Generator function "slugid" from "slugid-pack" produces generator "slugid", which no generator descriptor in the stack registers.',
      }),
    );
  });

  it('checks the registered generators in a stack with no adapter', () => {
    expect(() =>
      createControlStack(
        stubInput({
          family: { kind: 'family', id: 'family', version: '0.0.1' },
          target: { kind: 'target', id: 'target', version: '0.0.1' },
          extensions: [
            {
              kind: 'extension',
              id: 'slugid-pack',
              version: '0.0.1',
              generatorFunctions: [slugid],
            },
          ],
        }),
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
        message:
          'Generator function "slugid" from "slugid-pack" produces generator "slugid", which no generator descriptor in the stack registers.',
      }),
    );
  });
});

const textDataType = dataType('demo/text', { read: (json) => json });

const boundedText = {
  codecId: 'text@1',
  dataType: textDataType.id,
  traits: [],
  isParameterized: true,
  paramsSchema: arktype({ length: 'number <= 10' }),
  factory: () => () => ({}),
};

const shortSlugid: GeneratorFunctionContribution = {
  ...slugid,
  bindings: [
    {
      ...slugid.bindings[0]!,
      resolve: ({ field }) =>
        field.length !== undefined && field.length < 22
          ? {
              ok: false,
              message: `slugid() needs 22 characters; the column holds ${field.length}.`,
            }
          : { ok: true, generator: { kind: 'generator', id: 'slugid' } },
    },
  ],
};

describe('createControlStack type aliases', () => {
  function stackWithAlias(
    output: Record<string, unknown>,
    options: {
      readonly fieldLength?: (field: { readonly typeParams?: unknown }) => number | undefined;
      readonly generatorFunction?: GeneratorFunctionContribution;
    } = {},
  ) {
    return createControlStack(
      stubInput({
        family: {
          kind: 'family',
          id: 'family',
          version: '0.0.1',
          ...(options.fieldLength === undefined ? {} : { fieldLength: options.fieldLength }),
        },
        target: {
          kind: 'target',
          id: 'target',
          version: '0.0.1',
          dataTypes: [textDataType],
          types: { codecTypes: { codecDescriptors: [boundedText] } },
        },
        adapter: {
          kind: 'adapter',
          id: 'adapter',
          version: '0.0.1',
          controlMutationDefaults: {
            defaultFunctionRegistry: new Map(),
            generatorDescriptors: [{ id: 'slugid' }],
          },
        },
        extensions: [
          {
            kind: 'extension',
            id: 'slugid-pack',
            version: '0.0.1',
            generatorFunctions: [options.generatorFunction ?? slugid],
            authoring: { type: { slugs: { Slug: { kind: 'typeAlias', output } } } },
          },
        ],
      }),
    );
  }

  it('assembles an alias whose generator calls resolve for its codec', () => {
    const output = { type: { codecId: 'text@1' }, onCreate: { name: 'slugid', args: {} } };
    expect(stackWithAlias(output).authoringContributions.type).toEqual({
      slugs: { Slug: { kind: 'typeAlias', output } },
    });
  });

  it('refuses an alias whose generator function is bound to another codec', () => {
    expect(() =>
      stackWithAlias({ type: { codecId: 'int@1' }, onUpdate: { name: 'slugid', args: {} } }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
        message:
          'Type alias "slugs.Slug" calls slugid() on update, which does not apply to its codec "int@1".',
      }),
    );
  });

  it('refuses an alias whose type reads an argument', () => {
    expect(() =>
      stackWithAlias({
        type: { codecId: 'text@1', typeParams: { length: { kind: 'arg', index: 0 } } },
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
        message:
          'Invalid authoring type alias "slugs.Slug" contributed by descriptor "slugid-pack". output.type.typeParams.length references an argument, but a type alias takes none. Write the value itself.',
      }),
    );
  });

  it('refuses an alias that calls a generator function no component declares', () => {
    expect(() =>
      stackWithAlias({ type: { codecId: 'text@1' }, onCreate: { name: 'cuid', args: {} } }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
        message:
          'Type alias "slugs.Slug" calls cuid() on create, but no component declares the generator function "cuid".',
      }),
    );
  });

  it('refuses an alias whose fixed type params its codec refuses', () => {
    expect(() =>
      stackWithAlias({ type: { codecId: 'text@1', typeParams: { length: 64 } } }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
        message:
          'Type alias "slugs.Slug" fixes type parameters its codec "text@1" refuses: length must be at most 10 (was 64)',
      }),
    );
  });

  it("resolves an alias's generator calls for the length its fixed params give", () => {
    expect(() =>
      stackWithAlias(
        {
          type: { codecId: 'text@1', typeParams: { length: 8 } },
          onCreate: { name: 'slugid', args: {} },
        },
        {
          generatorFunction: shortSlugid,
          fieldLength: ({ typeParams }) =>
            typeof typeParams === 'object' && typeParams !== null && 'length' in typeParams
              ? Number(typeParams.length)
              : undefined,
        },
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
        message:
          'Type alias "slugs.Slug" calls slugid() on create, which its codec "text@1" refuses: slugid() needs 22 characters; the column holds 8.',
      }),
    );
  });
});
