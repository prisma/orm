import { assembleGeneratorFunctions } from '@internal/framework-components/components';
import { describe, expect, it } from 'vitest';
import { mongoTargetDescriptorMeta } from '../src/core/descriptor-meta';

const registry = assembleGeneratorFunctions([mongoTargetDescriptorMeta]);

describe('the Mongo generator functions', () => {
  it('resolve now() on DateTime to timestampNow', () => {
    expect(
      registry.resolve(
        { name: 'now', args: {} },
        { codecId: 'mongo/date@1', typeParams: undefined, length: undefined },
      ),
    ).toEqual({ ok: true, generator: { kind: 'generator', id: 'timestampNow' } });
  });

  it('bind only now', () => {
    expect(registry.functionsFor('mongo/date@1').map((fn) => fn.name)).toEqual(['now']);
  });
});
