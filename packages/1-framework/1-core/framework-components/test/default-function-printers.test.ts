import { describe, expect, it } from 'vitest';
import { assembleControlMutationDefaults } from '../src/control/control-stack';
import type { ControlMutationDefaultEntry } from '../src/shared/mutation-default-types';

const stubLower: ControlMutationDefaultEntry['lower'] = () => ({
  ok: true,
  value: { kind: 'storage', defaultValue: { kind: 'literal', value: 0 } },
});

function contributor(
  id: string,
  functions: ReadonlyArray<readonly [string, ControlMutationDefaultEntry]>,
  generatorIds: readonly string[] = [],
) {
  return {
    id,
    controlMutationDefaults: {
      defaultFunctionRegistry: new Map(functions),
      generatorDescriptors: generatorIds.map((generatorId) => ({ id: generatorId })),
    },
  };
}

describe('assembleControlMutationDefaults default function printers', () => {
  it('returns the default function that prints each generator', () => {
    const printUuid = () => '';
    const printNanoid = () => '21';
    const assembled = assembleControlMutationDefaults([
      contributor(
        'adapter',
        [['uuid', { lower: stubLower, printArguments: { uuidv4: printUuid } }]],
        ['uuidv4', 'nanoid'],
      ),
      contributor('extension', [
        ['nanoid', { lower: stubLower, printArguments: { nanoid: printNanoid } }],
        ['now', { lower: stubLower }],
      ]),
    ]);
    expect(assembled.defaultFunctionPrintersByGenerator).toEqual(
      new Map([
        ['uuidv4', { functionName: 'uuid', printArguments: printUuid }],
        ['nanoid', { functionName: 'nanoid', printArguments: printNanoid }],
      ]),
    );
  });

  it('returns the component that registers each generator, when the component has an id', () => {
    const assembled = assembleControlMutationDefaults([
      contributor('adapter', [], ['uuidv4']),
      {
        controlMutationDefaults: {
          defaultFunctionRegistry: new Map(),
          generatorDescriptors: [{ id: 'slugid' }],
        },
      },
    ]);
    expect(assembled.componentIdsByGenerator).toEqual(
      new Map([
        ['uuidv4', 'adapter'],
        ['slugid', undefined],
      ]),
    );
  });

  it('throws when two functions from different descriptors print one generator', () => {
    expect(() =>
      assembleControlMutationDefaults([
        contributor(
          'desc-a',
          [['uuid', { lower: stubLower, printArguments: { uuidv4: () => '' } }]],
          ['uuidv4'],
        ),
        contributor('desc-b', [
          ['guid', { lower: stubLower, printArguments: { uuidv4: () => '' } }],
        ]),
      ]),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
        message:
          'Duplicate PSL call for mutation default generator "uuidv4". Function "guid" from "desc-b" conflicts with function "uuid" from "desc-a".',
      }),
    );
  });

  it('throws when two functions from one descriptor print one generator', () => {
    expect(() =>
      assembleControlMutationDefaults([
        contributor(
          'desc-a',
          [
            ['uuid', { lower: stubLower, printArguments: { uuidv4: () => '' } }],
            ['guid', { lower: stubLower, printArguments: { uuidv4: () => '' } }],
          ],
          ['uuidv4'],
        ),
      ]),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
        message:
          'Duplicate PSL call for mutation default generator "uuidv4". Function "guid" from "desc-a" conflicts with function "uuid" from "desc-a".',
      }),
    );
  });

  it('throws when a function prints a generator no descriptor registers', () => {
    expect(() =>
      assembleControlMutationDefaults([
        contributor(
          'desc-a',
          [['slugid', { lower: stubLower, printArguments: { slugId: () => '' } }]],
          ['slugid'],
        ),
      ]),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
        message:
          'Mutation default function "slugid" from "desc-a" writes a PSL call for generator "slugId", which no generator descriptor in the stack registers.',
      }),
    );
  });
});
