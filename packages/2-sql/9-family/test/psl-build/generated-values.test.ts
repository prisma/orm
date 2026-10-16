import {
  type AuthoringFieldPresetDescriptor,
  assembleFieldPresetsByCodecAndGenerator,
} from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { fieldPresetCallFor } from '../../src/core/psl-build/generated-values';
import { temporalCodecPresetWithPrecision } from '../../src/core/timestamp-now-generator';

const amount: AuthoringFieldPresetDescriptor = {
  kind: 'fieldPreset',
  args: [
    { name: 'precision', kind: 'number', integer: true, optional: true },
    { name: 'stampedOn', kind: 'option', values: ['insert'], optional: true },
  ],
  output: {
    codecId: 'pg/numeric@1',
    typeParams: { precision: { kind: 'arg', index: 0 } },
    executionDefaults: {
      onCreate: {
        kind: 'select',
        index: 1,
        cases: { insert: { kind: 'generator', id: 'ledgerStamp' } },
      },
    },
  },
};

const fieldPresetsByCodecAndGenerator = assembleFieldPresetsByCodecAndGenerator({
  temporal: {
    time: temporalCodecPresetWithPrecision({
      codecId: 'pg/time@1',
      generatorId: 'plainTimeNow',
      nowTakesPrecision: true,
    }),
  },
  money: { amount },
});
const time = fieldPresetsByCodecAndGenerator.get('pg/time@1')?.get('plainTimeNow');
const money = fieldPresetsByCodecAndGenerator.get('pg/numeric@1')?.get('ledgerStamp');

const dataType = { kind: 'dataType', typeName: 'Time' } as const;

const plainTimeNow = (precision?: number) => ({
  kind: 'generator' as const,
  id: 'plainTimeNow',
  ...(precision === undefined ? {} : { params: { precision } }),
});

describe('fieldPresetCallFor', () => {
  it('writes the call of the preset that reads back with the params it derives from the type params', () => {
    expect(
      fieldPresetCallFor({
        fieldPresetsByCodecAndGenerator,
        column: {
          codecId: 'pg/time@1',
          pslType: dataType,
          list: false,
          typeParams: { precision: 3 },
          generators: { onCreate: plainTimeNow(3), onUpdate: plainTimeNow(3) },
        },
      }),
    ).toEqual({
      kind: 'call',
      preset: time,
      arguments: [
        { kind: 'positional', value: '3' },
        { kind: 'named', name: 'onCreate', value: 'now' },
        { kind: 'named', name: 'onUpdate', value: 'now' },
      ],
    });
  });

  it('writes a generator without params when the column has no type params', () => {
    expect(
      fieldPresetCallFor({
        fieldPresetsByCodecAndGenerator,
        column: {
          codecId: 'pg/time@1',
          pslType: dataType,
          list: false,
          typeParams: undefined,
          generators: { onUpdate: plainTimeNow() },
        },
      }),
    ).toEqual({
      kind: 'call',
      preset: time,
      arguments: [{ kind: 'named', name: 'onUpdate', value: 'now' }],
    });
  });

  it('finds no preset for a codec no preset writes with the generators', () => {
    expect(
      fieldPresetCallFor({
        fieldPresetsByCodecAndGenerator,
        column: {
          codecId: 'pg/text@1',
          pslType: dataType,
          list: false,
          typeParams: undefined,
          generators: { onCreate: plainTimeNow() },
        },
      }),
    ).toEqual({ kind: 'noPreset' });
  });

  it('reports a phase the preset does not write', () => {
    expect(
      fieldPresetCallFor({
        fieldPresetsByCodecAndGenerator,
        column: {
          codecId: 'pg/numeric@1',
          pslType: dataType,
          list: false,
          typeParams: { precision: 10 },
          generators: {
            onCreate: { kind: 'generator', id: 'ledgerStamp' },
            onUpdate: { kind: 'generator', id: 'ledgerStamp' },
          },
        },
      }),
    ).toEqual({
      kind: 'cannotWrite',
      preset: money,
      reason: { kind: 'phasesNotWrittenTogether' },
    });
  });

  it('reports each part of the column the call reads back differently', () => {
    expect(
      fieldPresetCallFor({
        fieldPresetsByCodecAndGenerator,
        column: {
          codecId: 'pg/time@1',
          pslType: dataType,
          list: false,
          typeParams: { precision: 3, zone: 'utc' },
          generators: { onCreate: plainTimeNow(3), onUpdate: plainTimeNow(0) },
        },
      }),
    ).toEqual({
      kind: 'readsBackDifferently',
      preset: time,
      differences: [
        { part: 'typeParams', column: { precision: 3, zone: 'utc' }, printed: { precision: 3 } },
        { part: 'onUpdate', column: plainTimeNow(0), printed: plainTimeNow(3) },
      ],
    });
  });

  it.each([
    ['namedType', 'Clock'],
    ['valueObject', 'Reading'],
    ['enum', 'Shift'],
  ] as const)(
    'cannot write a column whose PSL type is a %s, which the preset call would replace',
    (kind, name) => {
      expect(
        fieldPresetCallFor({
          fieldPresetsByCodecAndGenerator,
          column: {
            codecId: 'pg/time@1',
            pslType: { kind, typeName: name },
            list: false,
            typeParams: undefined,
            generators: { onCreate: plainTimeNow() },
          },
        }),
      ).toEqual({
        kind: 'cannotWrite',
        preset: time,
        reason: { kind: 'columnType', columnType: kind, typeName: name },
      });
    },
  );

  it('cannot write a type param that a PSL argument cannot carry', () => {
    const tagged: AuthoringFieldPresetDescriptor = {
      kind: 'fieldPreset',
      args: [
        { name: 'label', kind: 'string', optional: true },
        { name: 'onCreate', kind: 'option', values: ['now'], optional: true },
      ],
      output: {
        codecId: 'x/tagged@1',
        typeParams: { label: { kind: 'arg', index: 0 } },
        executionDefaults: {
          onCreate: {
            kind: 'select',
            index: 1,
            cases: { now: { kind: 'generator', id: 'taggedNow' } },
          },
        },
      },
    };
    const presets = assembleFieldPresetsByCodecAndGenerator({ tag: { tagged } });
    expect(
      fieldPresetCallFor({
        fieldPresetsByCodecAndGenerator: presets,
        column: {
          codecId: 'x/tagged@1',
          pslType: dataType,
          list: false,
          typeParams: { label: 'a"b' },
          generators: { onCreate: { kind: 'generator', id: 'taggedNow' } },
        },
      }),
    ).toEqual({
      kind: 'cannotWrite',
      preset: presets.get('x/tagged@1')?.get('taggedNow'),
      reason: { kind: 'unwritableArgument', argument: 'label', value: 'a"b' },
    });
  });

  it('cannot write a call the preset does not accept', () => {
    expect(
      fieldPresetCallFor({
        fieldPresetsByCodecAndGenerator,
        column: {
          codecId: 'pg/numeric@1',
          pslType: dataType,
          list: false,
          typeParams: { precision: 2.5 },
          generators: { onCreate: { kind: 'generator', id: 'ledgerStamp' } },
        },
      }),
    ).toEqual({
      kind: 'cannotWrite',
      preset: money,
      reason: {
        kind: 'argumentsRejected',
        message: 'Argument "precision" of money.amount must be an integer',
      },
    });
  });

  it('cannot write a list column, since a preset call cannot be a list element', () => {
    expect(
      fieldPresetCallFor({
        fieldPresetsByCodecAndGenerator,
        column: {
          codecId: 'pg/time@1',
          pslType: dataType,
          list: true,
          typeParams: undefined,
          generators: { onCreate: plainTimeNow() },
        },
      }),
    ).toEqual({ kind: 'cannotWrite', preset: time, reason: { kind: 'list' } });
  });
});
