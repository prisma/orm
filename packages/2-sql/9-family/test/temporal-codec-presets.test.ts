import { describe, expect, it } from 'vitest';
import {
  temporalCodecPresetMirrors,
  temporalConvenienceMirrors,
} from '../../2-authoring/contract-psl/test/fixtures';
import { sqlTimestampPresetMirror } from '../../2-authoring/contract-ts/test/temporal-preset-mirror';
import {
  temporalAuthoringPresets,
  temporalCodecPreset,
  temporalCodecPresetWithPrecision,
} from '../src/core/timestamp-now-generator';

const TIMESTAMP_NOW_PHASE = { kind: 'generator', id: 'timestampNow' };

describe('temporalCodecPresetWithPrecision', () => {
  const preset = temporalCodecPresetWithPrecision({
    codecId: 'pg/timestamp-temporal@1',
    nativeType: 'timestamp',
  });

  it('declares precision, onCreate, onUpdate args in that order, all optional', () => {
    expect(preset.args).toEqual([
      { name: 'precision', kind: 'number', optional: true, integer: true, minimum: 0 },
      { name: 'onCreate', kind: 'option', values: ['now'], optional: true },
      { name: 'onUpdate', kind: 'option', values: ['now'], optional: true },
    ]);
  });

  it('maps the precision arg into typeParams and each phase token to the timestampNow generator', () => {
    expect(preset.output).toEqual({
      codecId: 'pg/timestamp-temporal@1',
      nativeType: 'timestamp',
      typeParams: { precision: { kind: 'arg', index: 0 } },
      executionDefaults: {
        onCreate: { kind: 'select', index: 1, cases: { now: TIMESTAMP_NOW_PHASE } },
        onUpdate: { kind: 'select', index: 2, cases: { now: TIMESTAMP_NOW_PHASE } },
      },
    });
  });

  it('carries the caller-supplied codec and native type', () => {
    expect(
      temporalCodecPresetWithPrecision({
        codecId: 'pg/timestamptz-temporal@1',
        nativeType: 'timestamptz',
      }).output,
    ).toMatchObject({ codecId: 'pg/timestamptz-temporal@1', nativeType: 'timestamptz' });
  });

  it('declares neither id nor unique, so it takes the plain helper path', () => {
    expect(preset.output).not.toHaveProperty('id');
    expect(preset.output).not.toHaveProperty('unique');
  });
});

describe('temporalCodecPreset', () => {
  const preset = temporalCodecPreset({ codecId: 'sqlite/datetime@1', nativeType: 'text' });

  it('declares only onCreate and onUpdate args, both optional', () => {
    expect(preset.args).toEqual([
      { name: 'onCreate', kind: 'option', values: ['now'], optional: true },
      { name: 'onUpdate', kind: 'option', values: ['now'], optional: true },
    ]);
  });

  it('omits typeParams and maps each phase token to the timestampNow generator', () => {
    expect(preset.output).toEqual({
      codecId: 'sqlite/datetime@1',
      nativeType: 'text',
      executionDefaults: {
        onCreate: { kind: 'select', index: 0, cases: { now: TIMESTAMP_NOW_PHASE } },
        onUpdate: { kind: 'select', index: 1, cases: { now: TIMESTAMP_NOW_PHASE } },
      },
    });
  });
});

describe('temporalAuthoringPresets', () => {
  it('is unchanged by the per-codec preset factories', () => {
    expect(
      temporalAuthoringPresets({ codecId: 'pg/timestamptz-temporal@1', nativeType: 'timestamptz' }),
    ).toEqual({
      createdAt: {
        kind: 'fieldPreset',
        output: {
          codecId: 'pg/timestamptz-temporal@1',
          nativeType: 'timestamptz',
          default: { kind: 'function', expression: 'now()' },
        },
      },
      updatedAt: {
        kind: 'fieldPreset',
        output: {
          codecId: 'pg/timestamptz-temporal@1',
          nativeType: 'timestamptz',
          executionDefaults: { onCreate: TIMESTAMP_NOW_PHASE, onUpdate: TIMESTAMP_NOW_PHASE },
        },
      },
    });
  });
});

/**
 * contract-psl and contract-ts hand-mirror these factories' output because
 * neither can import family-sql (family-sql depends on contract-ts in
 * production and on contract-psl in dev, so the reverse is a cycle). Their
 * output-table, diagnostic, and parity tests all run against those mirrors.
 *
 * These assertions are the only thing standing between a factory change and
 * those suites silently passing against a preset that no longer ships — the
 * target-pack registration tests cannot serve that purpose, because both
 * sides of those assertions derive from the factory and so are invariant
 * under factory changes.
 */
describe('downstream mirrors track the factories', () => {
  it('contract-psl mirrors the postgres timestamp preset', () => {
    expect(temporalCodecPresetMirrors.pgTimestamp).toEqual(
      temporalCodecPresetWithPrecision({
        codecId: 'pg/timestamp-temporal@1',
        nativeType: 'timestamp',
      }),
    );
  });

  it('contract-psl mirrors the postgres timestamptz preset', () => {
    expect(temporalCodecPresetMirrors.pgTimestamptz).toEqual(
      temporalCodecPresetWithPrecision({
        codecId: 'pg/timestamptz-temporal@1',
        nativeType: 'timestamptz',
      }),
    );
  });

  it('contract-psl mirrors the sqlite datetime preset', () => {
    expect(temporalCodecPresetMirrors.sqliteDatetime).toEqual(
      temporalCodecPreset({ codecId: 'sqlite/datetime@1', nativeType: 'text' }),
    );
  });

  it('contract-ts mirrors the precision-bearing preset over its portable codec', () => {
    expect(sqlTimestampPresetMirror).toEqual(
      temporalCodecPresetWithPrecision({ codecId: 'test/timestamp@1', nativeType: 'timestamp' }),
    );
  });

  // The slice's headline guarantee — `temporal.updatedAt()` is byte-identical
  // to `temporal.timestamptz(onCreate: now, onUpdate: now)` — is asserted in
  // contract-psl against these mirrors on one side and the anchored per-codec
  // mirror on the other. Without these two assertions the parity tests could
  // prove a fiction of `updatedAt` identical to the real `timestamptz`.
  it('contract-psl mirrors the postgres createdAt/updatedAt convenience pair', () => {
    expect(temporalConvenienceMirrors.postgres).toEqual(
      temporalAuthoringPresets({ codecId: 'pg/timestamptz-temporal@1', nativeType: 'timestamptz' }),
    );
  });

  it('contract-psl mirrors the sqlite createdAt/updatedAt convenience pair', () => {
    expect(temporalConvenienceMirrors.sqlite).toEqual(
      temporalAuthoringPresets({ codecId: 'sqlite/datetime@1', nativeType: 'text' }),
    );
  });
});
