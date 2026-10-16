import { describe, expect, it } from 'vitest';
import {
  assembleFieldPresetsByCodecAndGenerator,
  fieldPresetPrintForm,
} from '../src/shared/field-preset-print-form';
import type { AuthoringFieldPresetDescriptor } from '../src/shared/framework-authoring';
import { temporalAuthoringPresets, temporalCodecPreset } from '../src/shared/temporal-presets';

const clock = (codecId: string, generatorId: string): AuthoringFieldPresetDescriptor =>
  temporalCodecPreset({ codecId, generatorId });

const now = (generatorId: string) => new Map([[generatorId, 'now']]);

const stamped = (
  typeParams: AuthoringFieldPresetDescriptor['output']['typeParams'],
): AuthoringFieldPresetDescriptor => ({
  kind: 'fieldPreset',
  args: [
    { name: 'precision', kind: 'number', optional: true },
    { name: 'scale', kind: 'number', optional: true },
    { name: 'stampedOn', kind: 'option', values: ['insert', 'write'], optional: true },
  ],
  output: {
    codecId: 'pg/timestamptz@1',
    ...(typeParams === undefined ? {} : { typeParams }),
    executionDefaults: {
      onCreate: {
        kind: 'select',
        index: 2,
        cases: {
          insert: { kind: 'generator', id: 'clusterNow' },
          write: { kind: 'generator', id: 'clusterNow' },
        },
      },
    },
  },
});

describe('fieldPresetPrintForm', () => {
  it('reads the codec, the phase arguments and the generator a temporal preset selects', () => {
    expect(fieldPresetPrintForm(clock('pg/date-string@1', 'dateStringNow'))).toEqual({
      codecId: 'pg/date-string@1',
      typeParams: [],
      onCreate: { argument: 'onCreate', index: 0, valuesByGenerator: now('dateStringNow') },
      onUpdate: { argument: 'onUpdate', index: 1, valuesByGenerator: now('dateStringNow') },
    });
  });

  it('reads the type params the leading positional arguments write, in argument order', () => {
    expect(
      fieldPresetPrintForm(
        stamped({ scale: { kind: 'arg', index: 1 }, precision: { kind: 'arg', index: 0 } }),
      ),
    ).toEqual({
      codecId: 'pg/timestamptz@1',
      typeParams: ['precision', 'scale'],
      onCreate: {
        argument: 'stampedOn',
        index: 2,
        valuesByGenerator: new Map([['clusterNow', 'insert']]),
      },
    });
  });

  it('has none for a preset whose type params skip a positional argument', () => {
    expect(fieldPresetPrintForm(stamped({ scale: { kind: 'arg', index: 1 } }))).toBeUndefined();
  });

  it('has none for a preset whose type param is not a whole argument', () => {
    expect(
      fieldPresetPrintForm(stamped({ precision: { kind: 'arg', index: 0, path: ['digits'] } })),
    ).toBeUndefined();
    expect(fieldPresetPrintForm(stamped({ precision: 3 }))).toBeUndefined();
    expect(fieldPresetPrintForm(stamped({ precision: { kind: 'arg', index: 2 } }))).toBeUndefined();
  });

  it('has none for a preset with fixed generators', () => {
    const { updatedAt } = temporalAuthoringPresets({ codecId: 'pg/timestamptz@1' });
    expect(fieldPresetPrintForm(updatedAt)).toBeUndefined();
  });

  it('has none for a preset that fixes a database default or the id', () => {
    const preset = clock('pg/date-string@1', 'dateStringNow');
    expect(
      fieldPresetPrintForm({
        ...preset,
        output: { ...preset.output, default: { kind: 'function', expression: 'now()' } },
      }),
    ).toBeUndefined();
    expect(fieldPresetPrintForm({ ...preset, output: { ...preset.output, id: true } })).toBe(
      undefined,
    );
  });

  it('has none for a preset that makes the column unique or nullable', () => {
    const preset = clock('pg/date-string@1', 'dateStringNow');
    expect(
      fieldPresetPrintForm({ ...preset, output: { ...preset.output, unique: true } }),
    ).toBeUndefined();
    expect(
      fieldPresetPrintForm({ ...preset, output: { ...preset.output, nullable: true } }),
    ).toBeUndefined();
  });

  it('has none for a preset whose two phases read the same option argument', () => {
    expect(
      fieldPresetPrintForm({
        kind: 'fieldPreset',
        args: [{ name: 'stampedOn', kind: 'option', values: ['insert', 'write'], optional: true }],
        output: {
          codecId: 'pg/timestamptz@1',
          executionDefaults: {
            onCreate: {
              kind: 'select',
              index: 0,
              cases: { insert: { kind: 'generator', id: 'clusterNow' } },
            },
            onUpdate: {
              kind: 'select',
              index: 0,
              cases: { write: { kind: 'generator', id: 'clusterNow' } },
            },
          },
        },
      }),
    ).toBeUndefined();
  });

  it('has one for a preset with a required argument, which the printer checks per column', () => {
    const requiredPhase = stamped({ precision: { kind: 'arg', index: 0 } });
    expect(
      fieldPresetPrintForm({
        ...requiredPhase,
        args: [
          { name: 'precision', kind: 'number', optional: true },
          { name: 'scale', kind: 'number', optional: true },
          { name: 'stampedOn', kind: 'option', values: ['insert', 'write'] },
        ],
      }),
    ).toEqual({
      codecId: 'pg/timestamptz@1',
      typeParams: ['precision'],
      onCreate: {
        argument: 'stampedOn',
        index: 2,
        valuesByGenerator: new Map([['clusterNow', 'insert']]),
      },
    });
  });
});

describe('assembleFieldPresetsByCodecAndGenerator', () => {
  it('indexes each preset by codec and generator', () => {
    const dateString = clock('pg/date-string@1', 'dateStringNow');
    const date = clock('pg/date-temporal@1', 'plainDateNow');
    const cluster = clock('pg/date-temporal@1', 'clusterNow');
    const presets = assembleFieldPresetsByCodecAndGenerator({
      temporal: { dateString, date },
      clock: { cluster },
    });
    expect(presets.get('pg/date-string@1')?.get('dateStringNow')?.descriptor).toBe(dateString);
    expect(
      [...presets].map(([codecId, byGenerator]) => [
        codecId,
        [...byGenerator].map(([generatorId, preset]) => [generatorId, preset.path.join('.')]),
      ]),
    ).toEqual([
      ['pg/date-string@1', [['dateStringNow', 'temporal.dateString']]],
      [
        'pg/date-temporal@1',
        [
          ['plainDateNow', 'temporal.date'],
          ['clusterNow', 'clock.cluster'],
        ],
      ],
    ]);
  });

  it('refuses two presets that write one codec with one generator', () => {
    expect(() =>
      assembleFieldPresetsByCodecAndGenerator({
        temporal: { date: clock('pg/date-temporal@1', 'plainDateNow') },
        clock: { day: clock('pg/date-temporal@1', 'plainDateNow') },
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
        message:
          'Field presets "temporal.date" and "clock.day" both write codec "pg/date-temporal@1" with generator "plainDateNow", so `contract print` cannot choose one. Register one of them only.',
      }),
    );
  });
});
