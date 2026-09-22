import {
  temporalAuthoringPresets,
  temporalCodecPresetWithPrecision,
} from '@internal/family-sql/control';
import { describe, expect, it } from 'vitest';
import { postgresAggregateDescriptors } from '../src/core/aggregates';
import { postgresAuthoringFieldPresets } from '../src/core/authoring';
import { codecDescriptorMap } from '../src/core/codec-type-map';
import { codecDescriptors } from '../src/core/codecs';
import * as codecIds from '../src/exports/codec-ids';
import * as codecs from '../src/exports/codecs';

const codecId = 'pg/timestamptz-date@1';

describe('Postgres Date codec wiring', () => {
  it('exports and registers the Date descriptor without claiming native inference', () => {
    expect(codecIds).toHaveProperty('PG_TIMESTAMPTZ_DATE_CODEC_ID', codecId);
    expect(codecs).toHaveProperty('PgTimestamptzDateCodec');
    expect(codecs).toHaveProperty('PgTimestamptzDateDescriptor');
    expect(codecs).toHaveProperty('pgTimestamptzDateColumn');
    const descriptor = codecs.postgresCodecRegistry.descriptorFor(codecId);
    expect(descriptor).toBeDefined();
    expect(codecs).toHaveProperty('pgTimestamptzDateDescriptor', descriptor);
    expect(codecDescriptorMap).toHaveProperty('timestamptz-date', descriptor);
    expect(codecDescriptors.filter((entry) => entry.codecId === codecId)).toEqual([descriptor]);
    expect(descriptor?.targetTypes).toEqual([]);
    expect(descriptor?.renderOutputType?.({ precision: 3 })).toBe('Date');
  });

  it('preserves the Date representation for min and max, but does not offer sum or avg', () => {
    const rows = postgresAggregateDescriptors.filter(
      (row) => row.input.kind === 'codec' && row.input.codecId === codecId,
    );
    expect(rows).toEqual(
      ['min', 'max'].map((operation) => ({
        operation,
        input: { kind: 'codec', codecId },
        output: { kind: 'self' },
        nullable: true,
      })),
    );
  });

  it('provides opt-in Date field presets with the Date-valued clock', () => {
    expect(postgresAuthoringFieldPresets).not.toHaveProperty('dateTimeDate');
    for (const name of ['timestamptzDate', 'createdAtDate', 'updatedAtDate']) {
      expect(postgresAuthoringFieldPresets.temporal).not.toHaveProperty(name);
    }
    const input = { codecId, nativeType: 'timestamptz' };
    const convenience = temporalAuthoringPresets(input);
    expect(postgresAuthoringFieldPresets.temporal).toMatchObject({
      timestamptzJsDate: temporalCodecPresetWithPrecision(input),
      createdAtJsDate: convenience.createdAt,
      updatedAtJsDate: convenience.updatedAt,
    });
    expect(postgresAuthoringFieldPresets.dateTime.output.codecId).toBe('pg/timestamptz-temporal@1');
    expect(postgresAuthoringFieldPresets.temporal.timestamptz.output.codecId).toBe(
      'pg/timestamptz-temporal@1',
    );
  });
});
