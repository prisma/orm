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

  it.each([
    ['mongo/date-instant@1', 'instantNow'],
    ['mongo/date-instant-string@1', 'instantStringNow'],
    ['mongo/date-string@1', 'dateStringNow'],
    ['mongo/date-temporal@1', 'plainDateNow'],
    ['mongo/time-string@1', 'timeStringNow'],
    ['mongo/time-temporal@1', 'plainTimeNow'],
  ])('resolve now() on %s to %s', (codecId, generatorId) => {
    expect(
      registry.resolve(
        { name: 'now', args: {} },
        { codecId, typeParams: undefined, length: undefined },
      ),
    ).toEqual({ ok: true, generator: { kind: 'generator', id: generatorId } });
  });

  it('bind no now() on a duration', () => {
    expect(registry.functionsFor('mongo/duration-string@1').map((fn) => fn.name)).toEqual([]);
  });

  it('bind only now', () => {
    expect(registry.functionsFor('mongo/date@1').map((fn) => fn.name)).toEqual(['now']);
  });
});
