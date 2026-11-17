import { describe, expect, it } from 'vitest';
import { createGeneratorHelpers } from '../src/shared/generator-helpers';

const optionalVersion = { _out: undefined as 4 | 7 | undefined, optional: true } as const;
const size = { _out: undefined as number | undefined, optional: true } as const;

const family = {
  id: 'family',
  generatorFunctions: [
    {
      name: 'uuid',
      signature: { documentation: 'uuid', positional: [{ key: 'version', type: optionalVersion }] },
      bindings: [],
    },
    { name: 'now', signature: { documentation: 'now' }, bindings: [] },
  ],
} as const;

const extension = {
  id: 'slugid-pack',
  generatorFunctions: [
    {
      name: 'nanoid',
      signature: { documentation: 'nanoid', positional: [{ key: 'size', type: size }] },
      bindings: [],
    },
  ],
} as const;

const target = { id: 'target', generatorFunctions: [{ name: 'uuid', bindings: [] }] } as const;

describe('createGeneratorHelpers', () => {
  it('gives one helper per declared function, with the argument keys of its signature', () => {
    const gen = createGeneratorHelpers([family, target, extension]);
    expect({
      keys: Object.keys(gen).sort(),
      uuid: gen.uuid(),
      uuid7: gen.uuid(7),
      now: gen.now(),
      nanoid: gen.nanoid(16),
    }).toEqual({
      keys: ['nanoid', 'now', 'uuid'],
      uuid: { name: 'uuid', args: {} },
      uuid7: { name: 'uuid', args: { version: 7 } },
      now: { name: 'now', args: {} },
      nanoid: { name: 'nanoid', args: { size: 16 } },
    });
  });

  it('reads the argument keys of a signature written as a function of the data types', () => {
    const declaresByFunction = {
      id: 'target-with-integers',
      generatorFunctions: [
        {
          name: 'cuid',
          signature: () =>
            ({
              documentation: 'cuid',
              positional: [{ key: 'version', type: { _out: undefined as 2 | undefined } }],
            }) as const,
          bindings: [],
        },
      ],
    } as const;
    const gen = createGeneratorHelpers([declaresByFunction]);
    expect(gen.cuid(2)).toEqual({ name: 'cuid', args: { version: 2 } });
  });

  it('gives no helper for a function the components do not declare', () => {
    const gen = createGeneratorHelpers([target]);
    expect(Object.keys(gen)).toEqual([]);
  });
});
