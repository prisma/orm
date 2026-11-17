import { describe, expect, it } from 'vitest';
import { assembleControlMutationDefaults } from '../src/control/control-stack';

describe('assembleControlMutationDefaults', () => {
  it('returns the component that registers each generator, when the component has an id', () => {
    const assembled = assembleControlMutationDefaults([
      {
        id: 'adapter',
        controlMutationDefaults: {
          defaultFunctionRegistry: new Map(),
          generatorDescriptors: [{ id: 'uuidv4' }],
        },
      },
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
});
