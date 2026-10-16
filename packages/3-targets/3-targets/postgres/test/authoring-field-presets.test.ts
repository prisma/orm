import {
  temporalCodecPresetWithPrecision,
  temporalStringAuthoringPresets,
} from '@internal/family-sql/control';
import {
  assembleFieldPresetsByCodecAndGenerator,
  collectScalarTypeConstructors,
  instantiateAuthoringFieldPreset,
  temporalAuthoringPresets,
  temporalCodecPreset,
} from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { postgresAuthoringFieldPresets, postgresAuthoringTypes } from '../src/core/authoring';

describe('postgresAuthoringFieldPresets', () => {
  it('exposes json preset with pg/jsonb@1 and nothing else, as the contract-psl mirror pgJson states', () => {
    expect(postgresAuthoringFieldPresets.json).toEqual({
      kind: 'fieldPreset',
      output: { codecId: 'pg/jsonb@1' },
    });
  });

  it('exposes uuidNative preset with pg/uuid@1', () => {
    expect(postgresAuthoringFieldPresets.uuidNative).toMatchObject({
      kind: 'fieldPreset',
      output: {
        codecId: 'pg/uuid@1',
      },
    });
  });

  it('exposes id.uuidv4Native preset with pg/uuid@1, uuidv4 generator, and id flag', () => {
    expect(postgresAuthoringFieldPresets.id.uuidv4Native).toMatchObject({
      kind: 'fieldPreset',
      output: {
        codecId: 'pg/uuid@1',
        executionDefaults: { onCreate: { kind: 'generator', id: 'uuidv4' } },
        id: true,
      },
    });
  });

  it('exposes id.uuidv7Native preset with pg/uuid@1, uuidv7 generator, and id flag', () => {
    expect(postgresAuthoringFieldPresets.id.uuidv7Native).toMatchObject({
      kind: 'fieldPreset',
      output: {
        codecId: 'pg/uuid@1',
        executionDefaults: { onCreate: { kind: 'generator', id: 'uuidv7' } },
        id: true,
      },
    });
  });

  it('contributes integer representations as bare-eligible top-level types', () => {
    const types = collectScalarTypeConstructors(postgresAuthoringTypes);

    expect(types.get('BigIntNumber')).toEqual({
      codecId: 'pg/int8number@1',
    });
    expect(types.get('UnboundedInt')).toEqual({
      codecId: 'pg/unboundedint@1',
    });
  });

  it('does not expose integer representations as field presets', () => {
    expect(postgresAuthoringFieldPresets).not.toHaveProperty('bigIntNumber');
    expect(postgresAuthoringFieldPresets).not.toHaveProperty('unboundedInt');
  });

  it('keeps the lossless bigint preset on pg/int8@1, so BigIntNumber is opt-in', () => {
    expect(postgresAuthoringFieldPresets.bigint).toEqual({
      kind: 'fieldPreset',
      output: {
        codecId: 'pg/int8@1',
      },
    });
  });
});

describe('postgres temporal per-codec presets', () => {
  // The mapping is the whole point of the pair, so it is asserted by id rather than by shape: which
  // representation a spelling selects is what a schema author is choosing between.
  it.each([
    ['timestamp', 'pg/timestamp-temporal@1'],
    ['timestamptz', 'pg/timestamptz-temporal@1'],
    ['createdAt', 'pg/timestamptz-temporal@1'],
    ['updatedAt', 'pg/timestamptz-temporal@1'],
    ['timestampString', 'pg/timestamp-string@1'],
    ['timestamptzString', 'pg/timestamptz-string@1'],
    ['createdAtString', 'pg/timestamptz-string@1'],
    ['updatedAtString', 'pg/timestamptz-string@1'],
    ['date', 'pg/date-temporal@1'],
    ['dateString', 'pg/date-string@1'],
    ['time', 'pg/time-temporal@1'],
    ['timeString', 'pg/time-string@1'],
    ['timetz', 'pg/timetz@1'],
  ] as const)('temporal.%s resolves to %s', (helper, codecId) => {
    expect(postgresAuthoringFieldPresets.temporal[helper].output.codecId).toBe(codecId);
  });

  it('lowers each pair through the shared factories, so the halves differ only in their codec and their clock', () => {
    expect(postgresAuthoringFieldPresets.temporal).toEqual({
      ...temporalAuthoringPresets({
        codecId: 'pg/timestamptz-temporal@1',
        generatorId: 'instantNow',
      }),
      ...temporalStringAuthoringPresets({
        codecId: 'pg/timestamptz-string@1',
        generatorId: 'timestamptzStringNow',
      }),
      createdAtJsDate: temporalAuthoringPresets({
        codecId: 'pg/timestamptz-date@1',
      }).createdAt,
      updatedAtJsDate: temporalAuthoringPresets({
        codecId: 'pg/timestamptz-date@1',
      }).updatedAt,
      timestamptzJsDate: temporalCodecPresetWithPrecision({
        codecId: 'pg/timestamptz-date@1',
      }),
      timestamp: temporalCodecPresetWithPrecision({
        codecId: 'pg/timestamp-temporal@1',
        generatorId: 'plainDateTimeNow',
      }),
      timestamptz: temporalCodecPresetWithPrecision({
        codecId: 'pg/timestamptz-temporal@1',
        generatorId: 'instantNow',
      }),
      timestampString: temporalCodecPresetWithPrecision({
        codecId: 'pg/timestamp-string@1',
        generatorId: 'timestampStringNow',
      }),
      timestamptzString: temporalCodecPresetWithPrecision({
        codecId: 'pg/timestamptz-string@1',
        generatorId: 'timestamptzStringNow',
      }),
      date: temporalCodecPreset({ codecId: 'pg/date-temporal@1', generatorId: 'plainDateNow' }),
      dateString: temporalCodecPreset({
        codecId: 'pg/date-string@1',
        generatorId: 'dateStringNow',
      }),
      time: temporalCodecPresetWithPrecision({
        codecId: 'pg/time-temporal@1',
        generatorId: 'plainTimeNow',
        nowTakesPrecision: true,
      }),
      timeString: temporalCodecPresetWithPrecision({
        codecId: 'pg/time-string@1',
        generatorId: 'timeStringNow',
        nowTakesPrecision: true,
      }),
      timetz: temporalCodecPresetWithPrecision({
        codecId: 'pg/timetz@1',
        generatorId: 'timetzNow',
        nowTakesPrecision: true,
      }),
    });
  });

  it.each([
    ['timestamp', 'plainDateTimeNow'],
    ['timestamptz', 'instantNow'],
    ['timestampString', 'timestampStringNow'],
    ['timestamptzString', 'timestamptzStringNow'],
  ] as const)(
    'temporal.%s answers `now` with the %s generator, the representation its codec encodes',
    (helper, generatorId) => {
      expect(postgresAuthoringFieldPresets.temporal[helper].output.executionDefaults).toEqual({
        onCreate: {
          kind: 'select',
          index: 1,
          cases: { now: { kind: 'generator', id: generatorId } },
        },
        onUpdate: {
          kind: 'select',
          index: 2,
          cases: { now: { kind: 'generator', id: generatorId } },
        },
      });
    },
  );

  it.each([
    ['time', 'plainTimeNow'],
    ['timeString', 'timeStringNow'],
    ['timetz', 'timetzNow'],
  ] as const)(
    'temporal.%s answers `now` with the %s generator, given the precision so it rounds down',
    (helper, generatorId) => {
      const now = {
        kind: 'generator',
        id: generatorId,
        params: { precision: { kind: 'arg', index: 0 } },
      };
      expect(postgresAuthoringFieldPresets.temporal[helper].output.executionDefaults).toEqual({
        onCreate: { kind: 'select', index: 1, cases: { now } },
        onUpdate: { kind: 'select', index: 2, cases: { now } },
      });
      expect(
        instantiateAuthoringFieldPreset(postgresAuthoringFieldPresets.temporal[helper], [0, 'now'])
          .executionDefaults,
      ).toEqual({ onCreate: { kind: 'generator', id: generatorId, params: { precision: 0 } } });
    },
  );

  it.each([
    ['date', 'plainDateNow'],
    ['dateString', 'dateStringNow'],
  ] as const)(
    'temporal.%s takes no precision and answers `now` with the %s generator',
    (helper, generatorId) => {
      const preset = postgresAuthoringFieldPresets.temporal[helper];
      expect(preset.args.map(({ name }) => name)).toEqual(['onCreate', 'onUpdate']);
      expect(preset.output).not.toHaveProperty('typeParams');
      expect(preset.output.executionDefaults).toEqual({
        onCreate: {
          kind: 'select',
          index: 0,
          cases: { now: { kind: 'generator', id: generatorId } },
        },
        onUpdate: {
          kind: 'select',
          index: 1,
          cases: { now: { kind: 'generator', id: generatorId } },
        },
      });
    },
  );

  it('backs updatedAt and timestamptz with the same codec, so the convenience form is a shorthand', () => {
    expect(postgresAuthoringFieldPresets.temporal.updatedAt.output.codecId).toBe(
      postgresAuthoringFieldPresets.temporal.timestamptz.output.codecId,
    );
  });

  it('backs updatedAtString and timestamptzString the same way', () => {
    expect(postgresAuthoringFieldPresets.temporal.updatedAtString.output.codecId).toBe(
      postgresAuthoringFieldPresets.temporal.timestamptzString.output.codecId,
    );
  });

  it.each([
    ['updatedAt', 'instantNow'],
    ['updatedAtString', 'timestamptzStringNow'],
  ] as const)('gives %s the %s generator on both phases', (helper, generatorId) => {
    expect(postgresAuthoringFieldPresets.temporal[helper].output.executionDefaults).toEqual({
      onCreate: { kind: 'generator', id: generatorId },
      onUpdate: { kind: 'generator', id: generatorId },
    });
  });

  it.each([
    ['createdAt', 'instantNow'],
    ['createdAtString', 'timestamptzStringNow'],
  ] as const)('gives %s the %s generator only on create', (helper, generatorId) => {
    const output = postgresAuthoringFieldPresets.temporal[helper].output;
    expect(output.executionDefaults).toEqual({
      onCreate: { kind: 'generator', id: generatorId },
    });
    expect(output).not.toHaveProperty('default');
  });
});

describe('postgres field preset print forms', () => {
  it('gives every temporal preset whose arguments select its generators a print form', () => {
    const presets = assembleFieldPresetsByCodecAndGenerator(postgresAuthoringFieldPresets);
    expect(
      [...presets.values()].flatMap((byGenerator) =>
        [...byGenerator.values()].map((preset) => preset.path.join('.')),
      ),
    ).toEqual([
      'temporal.timestamptzJsDate',
      'temporal.timestamp',
      'temporal.timestamptz',
      'temporal.timestampString',
      'temporal.timestamptzString',
      'temporal.date',
      'temporal.dateString',
      'temporal.time',
      'temporal.timeString',
      'temporal.timetz',
    ]);
  });
});
