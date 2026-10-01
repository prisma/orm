import { expectTypeOf, test } from 'vitest';
import type { AuthoringFieldPresetDescriptor } from '../src/shared/framework-authoring';
import { temporalAuthoringPresets, temporalCodecPreset } from '../src/shared/temporal-presets';

const presets = temporalAuthoringPresets({ codecId: 'test/date@1', nativeType: 'date' });
const custom = temporalAuthoringPresets({
  codecId: 'test/date@1',
  nativeType: 'date',
  generatorId: 'dateNow',
});
const codecPreset = temporalCodecPreset({ codecId: 'test/date@1', nativeType: 'date' });

test('presets are field-preset descriptors', () => {
  expectTypeOf(presets).toExtend<Record<string, AuthoringFieldPresetDescriptor>>();
  expectTypeOf(custom).toExtend<Record<string, AuthoringFieldPresetDescriptor>>();
  expectTypeOf(codecPreset).toExtend<AuthoringFieldPresetDescriptor>();
});

test('the storage template and generator id survive as literals', () => {
  expectTypeOf(presets.createdAt.output.codecId).toEqualTypeOf<'test/date@1'>();
  expectTypeOf(presets.updatedAt.output.nativeType).toEqualTypeOf<'date'>();
  expectTypeOf(
    presets.updatedAt.output.executionDefaults.onUpdate.id,
  ).toEqualTypeOf<'timestampNow'>();
  expectTypeOf(custom.createdAt.output.executionDefaults.onCreate.id).toEqualTypeOf<
    'dateNow' | 'timestampNow'
  >();
  expectTypeOf(codecPreset.output.nativeType).toEqualTypeOf<'date'>();
});

test('the generator id is not part of the preset output', () => {
  expectTypeOf(custom.createdAt.output).not.toHaveProperty('generatorId');
});
