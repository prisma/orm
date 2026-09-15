import { TIMESTAMP_NOW_GENERATOR_ID } from '@internal/family-sql/control';
import { timestampNowRuntimeGenerator } from '@internal/family-sql/runtime';
import { describe, expect, it } from 'vitest';
import { postgresAuthoringFieldPresets } from '../src/core/authoring';
import { INSTANT_NOW_GENERATOR_ID, instantNow } from '../src/core/instant-now-generator';
import { postgresNowGeneratorIdFor, postgresNowGeneratorIds } from '../src/core/now-generators';
import {
  PLAIN_DATE_TIME_NOW_GENERATOR_ID,
  plainDateTimeNow,
} from '../src/core/plain-date-time-now-generator';
import { postgresCodecRegistry } from '../src/core/registry';

const generate: Readonly<Record<string, () => unknown>> = {
  [INSTANT_NOW_GENERATOR_ID]: instantNow,
  [PLAIN_DATE_TIME_NOW_GENERATOR_ID]: plainDateTimeNow,
  [TIMESTAMP_NOW_GENERATOR_ID]: () => timestampNowRuntimeGenerator().generate(),
};

function presetGeneratorIds(output: object): string[] {
  if (!('executionDefaults' in output)) return [];
  return Object.values(output.executionDefaults as object).map((phase: unknown) => {
    const { id, cases } = phase as { id?: string; cases?: { now: { id: string } } };
    return id ?? cases?.now.id ?? '';
  });
}

const STRING_TIMESTAMP_CODEC_IDS = ['pg/timestamp-string@1', 'pg/timestamptz-string@1'];

function codecFor(codecId: string) {
  return postgresCodecRegistry.descriptorFor(codecId)?.factory({})({ name: '<test>' });
}

describe('the "now" generator for each codec', () => {
  it.each(
    Object.entries(postgresNowGeneratorIds).filter(
      ([codecId]) => !STRING_TIMESTAMP_CODEC_IDS.includes(codecId),
    ),
  )('generates a value %s encodes', async (codecId, generatorId) => {
    const value = generate[generatorId]?.();
    const codec = codecFor(codecId);
    const wire = await codec?.encode(value, {});
    expect(typeof wire).toBe('string');
    expect(codec?.decodeJson(codec.encodeJson(value))).toEqual(value);
  });

  it('has no generator for a codec without one', () => {
    expect(
      ['pg/date-temporal@1', 'pg/time-temporal@1', 'pg/timetz@1', 'pg/text@1'].map(
        postgresNowGeneratorIdFor,
      ),
    ).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('pairs each timestamp codec with its generator', () => {
    expect(postgresNowGeneratorIds).toEqual({
      'pg/timestamp-temporal@1': 'plainDateTimeNow',
      'pg/timestamptz-temporal@1': 'instantNow',
      'pg/timestamptz-date@1': 'timestampNow',
      'pg/timestamp-string@1': 'timestampNow',
      'pg/timestamptz-string@1': 'timestampNow',
    });
  });

  it('gives every temporal preset the generator the lookup gives its codec', () => {
    const presets = Object.entries(postgresAuthoringFieldPresets.temporal).flatMap(
      ([name, preset]) =>
        presetGeneratorIds(preset.output).map((generatorId) => ({
          name,
          codecId: preset.output.codecId,
          generatorId,
        })),
    );
    expect(presets.map(({ name }) => name)).toContain('updatedAtJsDate');
    expect(
      presets.filter(
        ({ codecId, generatorId }) => postgresNowGeneratorIdFor(codecId) !== generatorId,
      ),
    ).toEqual([]);
  });
});
