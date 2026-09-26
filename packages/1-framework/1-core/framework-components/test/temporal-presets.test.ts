import { describe, expect, it } from 'vitest';
import {
  checkUncomposedNamespace,
  getAuthoringFieldPreset,
} from '../src/shared/field-preset-resolution';
import {
  type AuthoringContributions,
  instantiateAuthoringFieldPreset,
} from '../src/shared/framework-authoring';
import {
  TEMPORAL_ON_CREATE_ARG,
  TEMPORAL_ON_UPDATE_ARG,
  TIMESTAMP_NOW_GENERATOR_ID,
  temporalAuthoringPresets,
  temporalCodecPreset,
  temporalPhaseTemplate,
  timestampNowControlDescriptor,
} from '../src/shared/temporal-presets';

const TIMESTAMP_NOW = { kind: 'generator', id: 'timestampNow' } as const;

describe('timestampNow generator', () => {
  it('has the id timestampNow', () => {
    expect(TIMESTAMP_NOW_GENERATOR_ID).toBe('timestampNow');
  });

  it('builds a control descriptor that generates on create and on update', () => {
    const descriptor = timestampNowControlDescriptor();
    expect(descriptor.id).toBe('timestampNow');
    expect(descriptor.buildPhases?.()).toEqual({
      onCreate: TIMESTAMP_NOW,
      onUpdate: TIMESTAMP_NOW,
    });
  });
});

describe('temporalAuthoringPresets', () => {
  it('generates createdAt on create and updatedAt on create and update', () => {
    expect(temporalAuthoringPresets({ codecId: 'test/date@1', nativeType: 'date' })).toEqual({
      createdAt: {
        kind: 'fieldPreset',
        output: {
          codecId: 'test/date@1',
          nativeType: 'date',
          executionDefaults: { onCreate: TIMESTAMP_NOW },
        },
      },
      updatedAt: {
        kind: 'fieldPreset',
        output: {
          codecId: 'test/date@1',
          nativeType: 'date',
          executionDefaults: { onCreate: TIMESTAMP_NOW, onUpdate: TIMESTAMP_NOW },
        },
      },
    });
  });

  it('uses a supplied generator id for both timestamps', () => {
    const presets = temporalAuthoringPresets({
      codecId: 'test/date@1',
      nativeType: 'date',
      generatorId: 'dateNow',
    });
    expect(presets.updatedAt.output.executionDefaults).toEqual({
      onCreate: { kind: 'generator', id: 'dateNow' },
      onUpdate: { kind: 'generator', id: 'dateNow' },
    });
  });
});

describe('temporalCodecPreset', () => {
  const preset = temporalCodecPreset({ codecId: 'test/date@1', nativeType: 'date' });

  it('declares optional onCreate and onUpdate options', () => {
    expect(preset.args).toEqual([TEMPORAL_ON_CREATE_ARG, TEMPORAL_ON_UPDATE_ARG]);
    expect(TEMPORAL_ON_CREATE_ARG).toEqual({
      name: 'onCreate',
      kind: 'option',
      values: ['now'],
      optional: true,
    });
    expect(TEMPORAL_ON_UPDATE_ARG).toEqual({
      name: 'onUpdate',
      kind: 'option',
      values: ['now'],
      optional: true,
    });
  });

  it('maps each phase argument to the timestampNow generator', () => {
    expect(preset.output).toEqual({
      codecId: 'test/date@1',
      nativeType: 'date',
      executionDefaults: {
        onCreate: temporalPhaseTemplate(0, 'timestampNow'),
        onUpdate: temporalPhaseTemplate(1, 'timestampNow'),
      },
    });
    expect(temporalPhaseTemplate(1, 'timestampNow')).toEqual({
      kind: 'select',
      index: 1,
      cases: { now: TIMESTAMP_NOW },
    });
  });

  it('instantiates only the phases the author asked for', () => {
    expect(instantiateAuthoringFieldPreset(preset, [undefined, 'now']).executionDefaults).toEqual({
      onUpdate: TIMESTAMP_NOW,
    });
  });
});

const temporal = temporalAuthoringPresets({ codecId: 'test/date@1', nativeType: 'date' });
const contributions: Pick<AuthoringContributions, 'field'> = { field: { temporal } };

describe('getAuthoringFieldPreset', () => {
  it('returns the preset at a registered path', () => {
    expect(getAuthoringFieldPreset(contributions, ['temporal', 'createdAt'])).toBe(
      temporal.createdAt,
    );
  });

  it('returns undefined for a namespace, an unknown name, or no contributions', () => {
    expect(getAuthoringFieldPreset(contributions, ['temporal'])).toBeUndefined();
    expect(getAuthoringFieldPreset(contributions, ['temporal', 'deletedAt'])).toBeUndefined();
    expect(getAuthoringFieldPreset(undefined, ['temporal', 'createdAt'])).toBeUndefined();
  });
});

describe('checkUncomposedNamespace', () => {
  const context = { familyId: 'fam', targetId: 'tgt', authoringContributions: contributions };

  it('returns the namespace of an attribute from an uncomposed extension', () => {
    expect(checkUncomposedNamespace('ext.foo', new Set(), context)).toBe('ext');
  });

  it.each(['db.Text', 'fam.foo', 'tgt.foo', 'temporal.foo', 'composed.foo', 'plain', '.x', 'x.'])(
    'accepts %s',
    (name) => {
      expect(checkUncomposedNamespace(name, new Set(['composed']), context)).toBeUndefined();
    },
  );
});
