import type { DataTypeId } from '@internal/framework-components/codec';
import { assembleGeneratorFunctions } from '@internal/framework-components/components';
import { builtinGeneratorIds } from '@internal/ids';
import { describe, expect, it } from 'vitest';
import {
  idGeneratorFunctionBindings,
  sqlFamilyGeneratorDescriptors,
  sqlIntegerArgumentGeneratorFunctions,
} from '../src/core/generator-functions';
import sqlFamilyPack from '../src/exports/pack';

const registry = assembleGeneratorFunctions([
  sqlFamilyPack,
  {
    id: 'target',
    generatorFunctions: [
      ...sqlIntegerArgumentGeneratorFunctions({ integer: 'demo/int' as DataTypeId }),
      ...idGeneratorFunctionBindings({
        text: ['demo/char@1', 'demo/text@1', 'demo/varchar@1'],
        uuid: ['demo/uuid@1'],
      }),
    ],
  },
]);

function resolve(name: string, args: Record<string, unknown>, codecId: string, length?: number) {
  return registry.resolve({ name, args }, { codecId, typeParams: undefined, length });
}

function generator(id: string, params?: Record<string, unknown>) {
  return {
    ok: true,
    generator: params === undefined ? { kind: 'generator', id } : { kind: 'generator', id, params },
  };
}

describe('SQL family generator functions', () => {
  it('registers exactly the identifier generators the runtime implements', () => {
    expect(new Set(sqlFamilyGeneratorDescriptors.map(({ id }) => id))).toEqual(
      new Set(builtinGeneratorIds),
    );
  });

  it('registers the identifier generators, so a target that binds them and registers none composes', () => {
    expect(registry.functionsFor('demo/text@1').map(({ name }) => name)).toEqual([
      'cuid',
      'ksuid',
      'nanoid',
      'ulid',
      'uuid',
    ]);
  });

  it.each([
    'sql/char@1',
    'sql/varchar@1',
    'sql/text@1',
    'demo/char@1',
    'demo/varchar@1',
    'demo/text@1',
  ])('resolves every identifier function on %s', (codecId) => {
    const length = codecId.endsWith('char@1') ? 36 : undefined;
    expect({
      uuid: resolve('uuid', {}, codecId, length),
      uuid7: resolve('uuid', { version: 7 }, codecId, length),
      cuid: resolve('cuid', { version: 2 }, codecId, length),
      ulid: resolve('ulid', {}, codecId, length),
      ksuid: resolve('ksuid', {}, codecId, length),
      nanoid: resolve('nanoid', { size: 36 }, codecId, length),
    }).toEqual({
      uuid: generator('uuidv4'),
      uuid7: generator('uuidv7'),
      cuid: generator('cuid2'),
      ulid: generator('ulid'),
      ksuid: generator('ksuid'),
      nanoid: generator('nanoid', { size: 36 }),
    });
  });

  it('resolves uuid on a uuid codec, and not cuid', () => {
    expect({
      uuid: resolve('uuid', { version: 7 }, 'demo/uuid@1'),
      cuid: resolve('cuid', { version: 2 }, 'demo/uuid@1'),
    }).toEqual({
      uuid: generator('uuidv7'),
      cuid: {
        ok: false,
        reason: 'not-bound',
        boundCodecIds: [
          'demo/char@1',
          'demo/text@1',
          'demo/varchar@1',
          'sql/char@1',
          'sql/text@1',
          'sql/varchar@1',
        ],
      },
    });
  });

  it('declares now and binds it to no family codec', () => {
    expect({
      has: registry.has('now'),
      char: registry.functionsFor('sql/char@1').map((fn) => fn.name),
    }).toEqual({ has: true, char: ['cuid', 'ksuid', 'nanoid', 'ulid', 'uuid'] });
  });

  describe('nanoid', () => {
    it('never takes its size from the column', () => {
      expect({
        char36: resolve('nanoid', {}, 'sql/char@1', 36),
        char21: resolve('nanoid', {}, 'sql/char@1', 21),
        varchar255: resolve('nanoid', {}, 'sql/varchar@1', 255),
        text: resolve('nanoid', {}, 'sql/text@1'),
        char36Sized: resolve('nanoid', { size: 16 }, 'sql/char@1', 36),
      }).toEqual({
        char36: generator('nanoid'),
        char21: generator('nanoid'),
        varchar255: generator('nanoid'),
        text: generator('nanoid'),
        char36Sized: generator('nanoid', { size: 16 }),
      });
    });

    it('refuses a size that does not fit the column', () => {
      expect({
        char: resolve('nanoid', { size: 16 }, 'sql/char@1', 10),
        varchar: resolve('nanoid', {}, 'sql/varchar@1', 10),
      }).toEqual({
        char: {
          ok: false,
          reason: 'refused',
          message: 'nanoid(16) writes 16 characters, which does not fit a column of 10 characters.',
        },
        varchar: {
          ok: false,
          reason: 'refused',
          message: 'nanoid() writes 21 characters, which does not fit a column of 10 characters.',
        },
      });
    });
  });

  it('refuses a column shorter than what each generator writes, and checks no length when the column gives none', () => {
    expect({
      uuid: resolve('uuid', {}, 'sql/char@1', 35),
      uuid7: resolve('uuid', { version: 7 }, 'sql/char@1', 1),
      cuid: resolve('cuid', { version: 2 }, 'sql/varchar@1', 23),
      ulid: resolve('ulid', {}, 'sql/char@1', 25),
      ksuid: resolve('ksuid', {}, 'sql/varchar@1', 26),
      fits: resolve('ksuid', {}, 'sql/varchar@1', 27),
      noLength: resolve('uuid', {}, 'sql/varchar@1'),
    }).toEqual({
      uuid: {
        ok: false,
        reason: 'refused',
        message: 'uuid() writes 36 characters, which does not fit a column of 35 characters.',
      },
      uuid7: {
        ok: false,
        reason: 'refused',
        message: 'uuid(7) writes 36 characters, which does not fit a column of 1 character.',
      },
      cuid: {
        ok: false,
        reason: 'refused',
        message: 'cuid(2) writes 24 characters, which does not fit a column of 23 characters.',
      },
      ulid: {
        ok: false,
        reason: 'refused',
        message: 'ulid() writes 26 characters, which does not fit a column of 25 characters.',
      },
      ksuid: {
        ok: false,
        reason: 'refused',
        message: 'ksuid() writes 27 characters, which does not fit a column of 26 characters.',
      },
      fits: generator('ksuid'),
      noLength: generator('uuidv4'),
    });
  });

  it('checks the argument ranges', () => {
    expect({
      uuid: resolve('uuid', { version: 5 }, 'demo/text@1'),
      cuid: resolve('cuid', { version: 1 }, 'demo/text@1'),
      nanoidSmall: resolve('nanoid', { size: 1 }, 'demo/text@1'),
      nanoidLarge: resolve('nanoid', { size: 256 }, 'demo/text@1'),
      nanoidFraction: resolve('nanoid', { size: 2.5 }, 'demo/text@1'),
    }).toEqual({
      uuid: { ok: false, reason: 'refused', message: 'uuid: version must be 4 or 7, got 5' },
      cuid: { ok: false, reason: 'refused', message: 'cuid: version must be 2, got 1' },
      nanoidSmall: {
        ok: false,
        reason: 'refused',
        message: 'nanoid: size must be between 2 and 255, got 1',
      },
      nanoidLarge: {
        ok: false,
        reason: 'refused',
        message: 'nanoid: size must be between 2 and 255, got 256',
      },
      nanoidFraction: {
        ok: false,
        reason: 'refused',
        message: 'nanoid: size must be between 2 and 255, got 2.5',
      },
    });
  });

  it('writes the call for each identifier generator', () => {
    const text = { codecId: 'demo/text@1', typeParams: undefined, length: undefined };
    const char36 = { codecId: 'sql/char@1', typeParams: { length: 36 }, length: 36 };
    expect({
      uuidv4: registry.callFor({ kind: 'generator', id: 'uuidv4' }, text)?.text,
      uuidv7: registry.callFor({ kind: 'generator', id: 'uuidv7' }, text)?.text,
      cuid2: registry.callFor({ kind: 'generator', id: 'cuid2' }, text)?.text,
      ulid: registry.callFor({ kind: 'generator', id: 'ulid' }, text)?.text,
      ksuid: registry.callFor({ kind: 'generator', id: 'ksuid' }, text)?.text,
      nanoid: registry.callFor({ kind: 'generator', id: 'nanoid' }, char36)?.text,
      nanoidSized: registry.callFor(
        { kind: 'generator', id: 'nanoid', params: { size: 16 } },
        char36,
      )?.text,
    }).toEqual({
      uuidv4: 'uuid()',
      uuidv7: 'uuid(7)',
      cuid2: 'cuid(2)',
      ulid: 'ulid()',
      ksuid: 'ksuid()',
      nanoid: 'nanoid()',
      nanoidSized: 'nanoid(16)',
    });
  });
});
