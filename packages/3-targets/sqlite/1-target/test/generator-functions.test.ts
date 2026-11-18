import sqlFamilyPack from '@internal/family-sql/pack';
import { assembleGeneratorFunctions } from '@internal/framework-components/components';
import { describe, expect, it } from 'vitest';
import sqlitePack from '../src/exports/pack';

const registry = assembleGeneratorFunctions([sqlFamilyPack, sqlitePack]);

function resolve(name: string, codecId: string, args: Record<string, unknown> = {}) {
  return registry.resolve({ name, args }, { codecId, typeParams: undefined, length: undefined });
}

describe('the SQLite generator functions', () => {
  it.each([
    ['sqlite/datetime@1', 'timestampNow'],
    ['sqlite/datetime-temporal@1', 'instantNow'],
    ['sqlite/datetime-string@1', 'instantStringNow'],
    ['sqlite/date-string@1', 'dateStringNow'],
    ['sqlite/date-temporal@1', 'plainDateNow'],
    ['sqlite/time-string@1', 'timeStringNow'],
    ['sqlite/time-temporal@1', 'plainTimeNow'],
  ])('resolve now() on %s to %s, with no params', (codecId, id) => {
    expect(resolve('now', codecId)).toEqual({
      ok: true,
      generator: { kind: 'generator', id },
    });
  });

  it('bind no now() to a duration, which holds no moment', () => {
    expect(registry.functionsFor('sqlite/duration-string@1').map((fn) => fn.name)).toEqual([]);
  });

  it('resolve uuid() on String', () => {
    expect({
      v4: resolve('uuid', 'sqlite/text@1'),
      v7: resolve('uuid', 'sqlite/text@1', { version: 7 }),
    }).toEqual({
      v4: { ok: true, generator: { kind: 'generator', id: 'uuidv4' } },
      v7: { ok: true, generator: { kind: 'generator', id: 'uuidv7' } },
    });
  });

  it('bind every identifier function to String', () => {
    expect(registry.functionsFor('sqlite/text@1').map((fn) => fn.name)).toEqual([
      'cuid',
      'ksuid',
      'nanoid',
      'ulid',
      'uuid',
    ]);
  });
});
