import sqlFamilyPack from '@internal/family-sql/pack';
import { assembleGeneratorFunctions } from '@internal/framework-components/components';
import { describe, expect, it } from 'vitest';
import postgresPack from '../src/exports/pack';

const registry = assembleGeneratorFunctions([sqlFamilyPack, postgresPack]);

function resolve(name: string, codecId: string, typeParams?: Record<string, unknown>, args = {}) {
  return registry.resolve({ name, args }, { codecId, typeParams, length: undefined });
}

describe('the Postgres generator functions', () => {
  it.each([
    ['pg/date-temporal@1', 'plainDateNow'],
    ['pg/date-string@1', 'dateStringNow'],
  ])('resolve now() on %s to %s with no params', (codecId, generatorId) => {
    expect(resolve('now', codecId, { precision: 3 })).toEqual({
      ok: true,
      generator: { kind: 'generator', id: generatorId },
    });
  });

  it.each([
    ['pg/time-temporal@1', 'plainTimeNow'],
    ['pg/time-string@1', 'timeStringNow'],
    ['pg/timetz@1', 'timetzNow'],
    ['pg/timestamptz-string@1', 'timestamptzStringNow'],
    ['pg/timestamp-string@1', 'timestampStringNow'],
    ['pg/timestamptz-date@1', 'timestampNow'],
    ['pg/timestamp-date@1', 'timestampNow'],
    ['pg/timestamptz-temporal@1', 'instantNow'],
    ['pg/timestamp-temporal@1', 'plainDateTimeNow'],
    ['pg/timestamp-instant@1', 'instantNow'],
  ])("resolve now() on %s to %s with the column's precision", (codecId, generatorId) => {
    expect({
      withPrecision: resolve('now', codecId, { precision: 3 }),
      without: resolve('now', codecId),
    }).toEqual({
      withPrecision: {
        ok: true,
        generator: { kind: 'generator', id: generatorId, params: { precision: 3 } },
      },
      without: { ok: true, generator: { kind: 'generator', id: generatorId } },
    });
  });

  it('write now() for a time generator and read it back', () => {
    const column = { codecId: 'pg/time-string@1', typeParams: { precision: 3 }, length: undefined };
    const generator = { kind: 'generator', id: 'timeStringNow', params: { precision: 3 } } as const;
    const call = registry.callFor(generator, column);
    expect({
      call,
      readBack: call && registry.resolve(call.call, column),
    }).toEqual({
      call: { call: { name: 'now', args: {} }, text: 'now()' },
      readBack: { ok: true, generator },
    });
  });

  it.each(['pg/text@1', 'pg/char@1', 'pg/varchar@1', 'sql/char@1', 'sql/varchar@1', 'sql/text@1'])(
    'resolve every identifier function on %s',
    (codecId) => {
      expect(
        ['uuid', 'cuid', 'ulid', 'nanoid', 'ksuid'].map(
          (name) => resolve(name, codecId, undefined, name === 'cuid' ? { version: 2 } : {}).ok,
        ),
      ).toEqual([true, true, true, true, true]);
    },
  );

  it('resolve uuid on pg/uuid@1 and nothing else', () => {
    expect(registry.functionsFor('pg/uuid@1').map((fn) => fn.name)).toEqual(['uuid']);
  });

  it('bind no generator function to bytea', () => {
    expect(registry.functionsFor('pg/bytea@1')).toEqual([]);
  });
});
