import {
  temporalAuthoringPresets,
  temporalCodecPresetWithPrecision,
  temporalStringAuthoringPresets,
} from '@internal/family-sql/control';
import { collectScalarTypeConstructors } from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { postgresAuthoringFieldPresets, postgresAuthoringTypes } from '../src/core/authoring';

describe('postgresAuthoringFieldPresets', () => {
  it('exposes uuidNative preset with pg/uuid@1 and nativeType uuid', () => {
    expect(postgresAuthoringFieldPresets.uuidNative).toMatchObject({
      kind: 'fieldPreset',
      output: {
        codecId: 'pg/uuid@1',
        nativeType: 'uuid',
      },
    });
  });

  it('exposes id.uuidv4Native preset with pg/uuid@1, uuidv4 generator, and id flag', () => {
    expect(postgresAuthoringFieldPresets.id.uuidv4Native).toMatchObject({
      kind: 'fieldPreset',
      output: {
        codecId: 'pg/uuid@1',
        nativeType: 'uuid',
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
        nativeType: 'uuid',
        executionDefaults: { onCreate: { kind: 'generator', id: 'uuidv7' } },
        id: true,
      },
    });
  });

  it('contributes integer representations as bare-eligible top-level types', () => {
    const types = collectScalarTypeConstructors(postgresAuthoringTypes);

    expect(types.get('BigIntNumber')).toEqual({
      codecId: 'pg/int8number@1',
      nativeType: 'int8',
    });
    expect(types.get('UnboundedInt')).toEqual({
      codecId: 'pg/unboundedint@1',
      nativeType: 'numeric',
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
        nativeType: 'int8',
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
  ] as const)('temporal.%s resolves to %s', (helper, codecId) => {
    expect(postgresAuthoringFieldPresets.temporal[helper].output.codecId).toBe(codecId);
  });

  it('lowers each pair through the shared factories, so the halves differ only in their codec', () => {
    expect(postgresAuthoringFieldPresets.temporal).toEqual({
      ...temporalAuthoringPresets({
        codecId: 'pg/timestamptz-temporal@1',
        nativeType: 'timestamptz',
      }),
      ...temporalStringAuthoringPresets({
        codecId: 'pg/timestamptz-string@1',
        nativeType: 'timestamptz',
      }),
      timestamp: temporalCodecPresetWithPrecision({
        codecId: 'pg/timestamp-temporal@1',
        nativeType: 'timestamp',
      }),
      timestamptz: temporalCodecPresetWithPrecision({
        codecId: 'pg/timestamptz-temporal@1',
        nativeType: 'timestamptz',
      }),
      timestampString: temporalCodecPresetWithPrecision({
        codecId: 'pg/timestamp-string@1',
        nativeType: 'timestamp',
      }),
      timestamptzString: temporalCodecPresetWithPrecision({
        codecId: 'pg/timestamptz-string@1',
        nativeType: 'timestamptz',
      }),
    });
  });

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

  // Both halves carry the generator, which is what makes the string representation a drop-in for
  // the Temporal one rather than a lesser variant of it.
  it.each(['updatedAt', 'updatedAtString'] as const)(
    'gives %s the timestampNow generator on both phases',
    (helper) => {
      expect(postgresAuthoringFieldPresets.temporal[helper].output.executionDefaults).toEqual({
        onCreate: { kind: 'generator', id: 'timestampNow' },
        onUpdate: { kind: 'generator', id: 'timestampNow' },
      });
    },
  );

  it.each(['createdAt', 'createdAtString'] as const)(
    'gives %s a now() storage default rather than an execution generator',
    (helper) => {
      expect(postgresAuthoringFieldPresets.temporal[helper].output).toMatchObject({
        default: { kind: 'function', expression: 'now()' },
      });
    },
  );
});
