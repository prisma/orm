import type { ExecutionMutationDefaultValue } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import {
  assembleGeneratorFunctions,
  type GeneratorFunctionBinding,
  type GeneratorFunctionContribution,
  singleGeneratorBinding,
} from '../src/shared/generator-functions';

function fixedBinding(codecIds: readonly string[], generatorId: string): GeneratorFunctionBinding {
  return {
    codecIds,
    generatorIds: [generatorId],
    resolve: () => ({ ok: true, generator: { kind: 'generator', id: generatorId } }),
    printArguments: (generator) =>
      generator.id === generatorId ? { args: {}, text: '' } : undefined,
  };
}

function component(
  id: string,
  generatorFunctions: readonly GeneratorFunctionContribution[],
  generatorIds: readonly string[] = [],
) {
  return {
    id,
    generatorFunctions,
    controlMutationDefaults: {
      defaultFunctionRegistry: new Map(),
      generatorDescriptors: generatorIds.map((generatorId) => ({ id: generatorId })),
    },
  };
}

const registers = (...generatorIds: string[]) => component('runtime', [], generatorIds);

const textField = { codecId: 'text@1', typeParams: undefined, length: undefined };
const call = (name: string, args: Record<string, unknown> = {}) => ({ name, args });

describe('assembleGeneratorFunctions', () => {
  it('merges bindings that two components contribute for one function', () => {
    const registry = assembleGeneratorFunctions([
      component('family', [
        {
          name: 'uuid',
          signature: { documentation: 'uuid' },
          bindings: [fixedBinding(['char@1'], 'uuidv4')],
        },
      ]),
      component('target', [{ name: 'uuid', bindings: [fixedBinding(['text@1'], 'uuidv4')] }]),
      registers('uuidv4'),
    ]);

    expect({
      text: registry.resolve(call('uuid'), textField),
      char: registry.resolve(call('uuid'), {
        codecId: 'char@1',
        typeParams: undefined,
        length: undefined,
      }),
    }).toEqual({
      text: { ok: true, generator: { kind: 'generator', id: 'uuidv4' } },
      char: { ok: true, generator: { kind: 'generator', id: 'uuidv4' } },
    });
  });

  it('lists only the functions bound to a codec, with their signatures', () => {
    const registry = assembleGeneratorFunctions([
      component('family', [
        {
          name: 'uuid',
          signature: { documentation: 'uuid' },
          bindings: [fixedBinding(['text@1'], 'uuidv4')],
        },
        {
          name: 'now',
          signature: { documentation: 'now' },
          bindings: [fixedBinding(['date@1'], 'dateNow')],
        },
      ]),
      registers('uuidv4', 'dateNow'),
    ]);

    expect({
      text: registry.functionsFor('text@1'),
      date: registry.functionsFor('date@1'),
      bytes: registry.functionsFor('bytes@1'),
      has: [registry.has('uuid'), registry.has('foo')],
    }).toEqual({
      text: [{ name: 'uuid', signature: { documentation: 'uuid' } }],
      date: [{ name: 'now', signature: { documentation: 'now' } }],
      bytes: [],
      has: [true, false],
    });
  });

  it('reports an unknown function and a function not bound to the codec', () => {
    const registry = assembleGeneratorFunctions([
      component('family', [
        { name: 'uuid', signature: {}, bindings: [fixedBinding(['text@1', 'char@1'], 'uuidv4')] },
      ]),
      registers('uuidv4'),
    ]);

    expect({
      unknown: registry.resolve(call('foo'), textField),
      notBound: registry.resolve(call('uuid'), {
        codecId: 'bytes@1',
        typeParams: undefined,
        length: undefined,
      }),
    }).toEqual({
      unknown: { ok: false, reason: 'unknown-function', boundCodecIds: [] },
      notBound: { ok: false, reason: 'not-bound', boundCodecIds: ['char@1', 'text@1'] },
    });
  });

  it('reports a refusal from the binding', () => {
    const registry = assembleGeneratorFunctions([
      component('family', [
        {
          name: 'nanoid',
          signature: {},
          bindings: [
            {
              ...fixedBinding(['text@1'], 'nanoid'),
              resolve: () => ({ ok: false, message: 'too long' }),
            },
          ],
        },
      ]),
      registers('nanoid'),
    ]);

    expect(registry.resolve(call('nanoid', { size: 300 }), textField)).toEqual({
      ok: false,
      reason: 'refused',
      message: 'too long',
    });
  });

  it('throws when a binding resolves to a generator id it does not declare', () => {
    const registry = assembleGeneratorFunctions([
      component('slugid-pack', [
        {
          name: 'slugid',
          signature: {},
          bindings: [
            {
              ...fixedBinding(['text@1'], 'slugid'),
              resolve: () => ({ ok: true, generator: { kind: 'generator', id: 'slugidv2' } }),
            },
          ],
        },
      ]),
      registers('slugid'),
    ]);

    expect(() => registry.resolve(call('slugid'), textField)).toThrow(
      'Generator function "slugid" from "slugid-pack" resolved to generator "slugidv2", which its binding does not declare in generatorIds.',
    );
  });

  it('writes the call that produces a generator, and nothing for a generator no function writes', () => {
    const registry = assembleGeneratorFunctions([
      component('family', [
        {
          name: 'uuid',
          signature: {},
          bindings: [
            {
              codecIds: ['text@1'],
              generatorIds: ['uuidv4', 'uuidv7'],
              resolve: () => ({ ok: true, generator: { kind: 'generator', id: 'uuidv4' } }),
              printArguments: (generator: ExecutionMutationDefaultValue) =>
                generator.id === 'uuidv7' ? { args: { version: 7 }, text: '7' } : undefined,
            },
          ],
        },
      ]),
      registers('uuidv4', 'uuidv7'),
    ]);

    expect({
      uuidv7: registry.callFor({ kind: 'generator', id: 'uuidv7' }, textField),
      uuidv4: registry.callFor({ kind: 'generator', id: 'uuidv4' }, textField),
      slugid: registry.callFor({ kind: 'generator', id: 'slugid' }, textField),
      otherCodec: registry.callFor(
        { kind: 'generator', id: 'uuidv7' },
        { codecId: 'bytes@1', typeParams: undefined, length: undefined },
      ),
    }).toEqual({
      uuidv7: { call: { name: 'uuid', args: { version: 7 } }, text: 'uuid(7)' },
      uuidv4: undefined,
      slugid: undefined,
      otherCodec: undefined,
    });
  });

  describe('refuses', () => {
    it('two components that declare a signature for one function', () => {
      expect(() =>
        assembleGeneratorFunctions([
          component('family', [{ name: 'uuid', signature: {}, bindings: [] }]),
          component('extension', [{ name: 'uuid', signature: {}, bindings: [] }]),
        ]),
      ).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
          message: 'Generator function "uuid" is declared by both "family" and "extension".',
        }),
      );
    });

    it('a binding for a function no component declares', () => {
      expect(() =>
        assembleGeneratorFunctions([
          component('extension', [
            { name: 'slugid', bindings: [fixedBinding(['text@1'], 'slugid')] },
          ]),
          registers('slugid'),
        ]),
      ).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
          message: '"extension" binds generator function "slugid", which no component declares.',
        }),
      );
    });

    it('two bindings of one function to one codec', () => {
      expect(() =>
        assembleGeneratorFunctions([
          component('family', [
            { name: 'uuid', signature: {}, bindings: [fixedBinding(['text@1'], 'uuidv4')] },
          ]),
          component('target', [{ name: 'uuid', bindings: [fixedBinding(['text@1'], 'uuidv4')] }]),
          registers('uuidv4'),
        ]),
      ).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
          message:
            'Generator function "uuid" is bound to codec "text@1" by both "family" and "target".',
        }),
      );
    });

    it('two functions that write one generator on one codec', () => {
      expect(() =>
        assembleGeneratorFunctions([
          component('family', [
            { name: 'uuid', signature: {}, bindings: [fixedBinding(['text@1'], 'uuidv4')] },
          ]),
          component('extension', [
            { name: 'guid', signature: {}, bindings: [fixedBinding(['text@1'], 'uuidv4')] },
          ]),
          registers('uuidv4'),
        ]),
      ).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
          message:
            'Generator "uuidv4" on codec "text@1" is written by both function "uuid" from "family" and function "guid" from "extension".',
        }),
      );
    });

    it('a generator id two components register, as the control stack does', () => {
      expect(() =>
        assembleGeneratorFunctions([
          component('desc-a', [], ['uuidv4']),
          component('desc-b', [], ['uuidv4']),
        ]),
      ).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
          message:
            'Generator "uuidv4" is registered by both "desc-a" and "desc-b". Register each generator once, in the component that defines it.',
        }),
      );
    });

    it('a signature with named parameters, which gen cannot express', () => {
      expect(() =>
        assembleGeneratorFunctions([
          component(
            'extension',
            [
              {
                name: 'slugid',
                signature: { documentation: 'slugid', named: { length: {} } },
                bindings: [fixedBinding(['text@1'], 'slugid')],
              },
            ],
            ['slugid'],
          ),
        ]),
      ).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
          message:
            'Generator function "slugid" from "extension" declares the named parameter "length". A generator function takes positional parameters only, because a TypeScript gen call passes its arguments by position; declare it in positional.',
        }),
      );
    });

    it('a binding that produces a generator no component registers', () => {
      expect(() =>
        assembleGeneratorFunctions([
          component('extension', [
            { name: 'slugid', signature: {}, bindings: [fixedBinding(['text@1'], 'slugid')] },
          ]),
          registers('uuidv4'),
        ]),
      ).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
          message:
            'Generator function "slugid" from "extension" produces generator "slugid", which no generator descriptor in the stack registers.',
        }),
      );
    });
  });
});

describe('singleGeneratorBinding', () => {
  const binding = singleGeneratorBinding({
    codecIds: ['time@1'],
    generatorId: 'timeNow',
    paramsFromField: (field) =>
      typeof field.typeParams?.['precision'] === 'number'
        ? { precision: field.typeParams['precision'] }
        : undefined,
  });

  it('resolves to its generator, with params from the field', () => {
    expect({
      withPrecision: binding.resolve({
        args: {},
        field: { codecId: 'time@1', typeParams: { precision: 3 }, length: undefined },
      }),
      without: binding.resolve({
        args: {},
        field: { codecId: 'time@1', typeParams: undefined, length: undefined },
      }),
    }).toEqual({
      withPrecision: {
        ok: true,
        generator: { kind: 'generator', id: 'timeNow', params: { precision: 3 } },
      },
      without: { ok: true, generator: { kind: 'generator', id: 'timeNow' } },
    });
  });

  it('writes no arguments for its generator and nothing for another', () => {
    const field = { codecId: 'time@1', typeParams: undefined, length: undefined };
    expect({
      own: binding.printArguments({ kind: 'generator', id: 'timeNow' }, field),
      other: binding.printArguments({ kind: 'generator', id: 'dateNow' }, field),
    }).toEqual({ own: { args: {}, text: '' }, other: undefined });
  });
});
