import { expectTypeOf, test } from 'vitest';
import type { AuthoringFieldPresetDescriptor } from '../src/shared/framework-authoring';
import { temporalAuthoringPresets, temporalCodecPreset } from '../src/shared/temporal-presets';

const presets = temporalAuthoringPresets({ codecId: 'test/date@1' });
const custom = temporalAuthoringPresets({
  codecId: 'test/date@1',
  generatorId: 'dateNow',
});
const codecPreset = temporalCodecPreset({ codecId: 'test/date@1' });
const customCodecPreset = temporalCodecPreset({ codecId: 'test/date@1', generatorId: 'dateNow' });

test('presets are field-preset descriptors', () => {
  expectTypeOf(presets).toExtend<Record<string, AuthoringFieldPresetDescriptor>>();
  expectTypeOf(custom).toExtend<Record<string, AuthoringFieldPresetDescriptor>>();
  expectTypeOf(codecPreset).toExtend<AuthoringFieldPresetDescriptor>();
  expectTypeOf(customCodecPreset).toExtend<AuthoringFieldPresetDescriptor>();
});

test('the storage template and generator id survive as literals', () => {
  expectTypeOf(presets.createdAt.output.codecId).toEqualTypeOf<'test/date@1'>();
  expectTypeOf(presets.updatedAt.output).not.toHaveProperty('nativeType');
  expectTypeOf(
    presets.updatedAt.output.executionDefaults.onUpdate.id,
  ).toEqualTypeOf<'timestampNow'>();
  expectTypeOf(custom.createdAt.output.executionDefaults.onCreate.id).toEqualTypeOf<
    'dateNow' | 'timestampNow'
  >();
  expectTypeOf(codecPreset.output).not.toHaveProperty('nativeType');
  expectTypeOf(customCodecPreset.output.executionDefaults.onCreate.cases.now.id).toEqualTypeOf<
    'dateNow' | 'timestampNow'
  >();
});

test('the generator id is not part of the preset output', () => {
  expectTypeOf(custom.createdAt.output).not.toHaveProperty('generatorId');
  expectTypeOf(customCodecPreset.output).not.toHaveProperty('generatorId');
});
