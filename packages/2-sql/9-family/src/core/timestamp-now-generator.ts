import {
  type AuthoringFieldPresetDescriptor,
  type PresetStorageTemplate,
  TEMPORAL_ON_CREATE_ARG,
  TEMPORAL_ON_UPDATE_ARG,
  TIMESTAMP_NOW_GENERATOR_ID,
  temporalAuthoringPresets,
  temporalPhaseTemplate,
} from '@internal/framework-components/authoring';

export function temporalStringAuthoringPresets<
  const Storage extends PresetStorageTemplate,
  const GeneratorId extends string = typeof TIMESTAMP_NOW_GENERATOR_ID,
>(input: Storage & { readonly generatorId?: GeneratorId }) {
  const presets = temporalAuthoringPresets<Storage, GeneratorId>(input);
  return {
    createdAtString: presets.createdAt,
    updatedAtString: presets.updatedAt,
  } as const;
}

const TEMPORAL_PRECISION_ARG = {
  name: 'precision',
  kind: 'number',
  optional: true,
  integer: true,
  minimum: 0,
} as const;

/**
 * Builds a `temporal.<codec>` field preset for a codec that takes a precision
 * parameter (`pg/timestamp-temporal@1`, `pg/timestamptz-temporal@1`). Arguments change field
 * properties only — never the codec, which the caller fixes here.
 *
 * All three arguments are optional: omitting `precision` omits `typeParams`
 * entirely, and omitting a phase omits that phase (both omitted omits
 * `executionDefaults`).
 */
/* @__NO_SIDE_EFFECTS__ */
export function temporalCodecPresetWithPrecision<
  const CodecId extends string,
  const NativeType extends string,
  const GeneratorId extends string = typeof TIMESTAMP_NOW_GENERATOR_ID,
>(input: {
  readonly codecId: CodecId;
  readonly nativeType: NativeType;
  readonly generatorId?: GeneratorId;
}) {
  const generatorId = input.generatorId ?? TIMESTAMP_NOW_GENERATOR_ID;
  return {
    kind: 'fieldPreset',
    args: [TEMPORAL_PRECISION_ARG, TEMPORAL_ON_CREATE_ARG, TEMPORAL_ON_UPDATE_ARG],
    output: {
      codecId: input.codecId,
      nativeType: input.nativeType,
      typeParams: { precision: { kind: 'arg', index: 0 } },
      executionDefaults: {
        onCreate: temporalPhaseTemplate(1, generatorId),
        onUpdate: temporalPhaseTemplate(2, generatorId),
      },
    },
  } as const satisfies AuthoringFieldPresetDescriptor;
}
