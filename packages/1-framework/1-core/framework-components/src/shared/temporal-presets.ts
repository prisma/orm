import type {
  AuthoringFieldPresetDescriptor,
  AuthoringStorageTypeTemplate,
  ScalarTypeConstructorOutput,
} from './framework-authoring';
import type { MutationDefaultGeneratorDescriptor } from './mutation-default-types';

/**
 * A codec's storage template with every member a preset needs to resolve.
 */
export type PresetStorageTemplate = ScalarTypeConstructorOutput & AuthoringStorageTypeTemplate;

/**
 * Canonical id for the wall-clock-now mutation default generator. It flows to the control-plane descriptor and the temporal field presets below, to each family's runtime generator, and to the authoring surfaces (PSL `temporal.updatedAt()`, TS `field.temporal.updatedAt()`) through the descriptor.
 */
export const TIMESTAMP_NOW_GENERATOR_ID = 'timestampNow' as const;

/**
 * Builds the control-plane descriptor for the wall-clock-now mutation default generator. Its `id` and `buildPhases` are target-agnostic, so PSL `temporal.updatedAt()` and TS `field.temporal.updatedAt()` lower to byte-identical contracts.
 *
 * `applicableCodecIds` is omitted: `timestampNow` is reachable only through a preset, which co-registers the codec itself, so a compatibility list would be tautological.
 */
export function timestampNowControlDescriptor(): MutationDefaultGeneratorDescriptor {
  return {
    id: TIMESTAMP_NOW_GENERATOR_ID,
    buildPhases: () => ({
      onCreate: { kind: 'generator', id: TIMESTAMP_NOW_GENERATOR_ID },
      onUpdate: { kind: 'generator', id: TIMESTAMP_NOW_GENERATOR_ID },
    }),
  };
}

/**
 * Builds the `temporal.{createdAt,updatedAt}` field-preset pair. `createdAt` lowers to an execution generator on `onCreate`; `updatedAt` lowers to the same generator on both `onCreate` and `onUpdate`. The target supplies the storage template of its timestamp codec, which the presets carry through unchanged; everything else is shared, so PSL and TS authoring lower to byte-identical contracts across targets.
 */
/* @__NO_SIDE_EFFECTS__ */
export function temporalAuthoringPresets<
  const Storage extends PresetStorageTemplate,
  const GeneratorId extends string = typeof TIMESTAMP_NOW_GENERATOR_ID,
>(input: Storage & { readonly generatorId?: GeneratorId }) {
  const { generatorId: requestedGeneratorId, ...storage } = input;
  const generatorId = requestedGeneratorId ?? TIMESTAMP_NOW_GENERATOR_ID;
  return {
    createdAt: {
      kind: 'fieldPreset',
      output: {
        ...storage,
        executionDefaults: {
          onCreate: { kind: 'generator', id: generatorId },
        },
      },
    },
    updatedAt: {
      kind: 'fieldPreset',
      output: {
        ...storage,
        executionDefaults: {
          onCreate: { kind: 'generator', id: generatorId },
          onUpdate: { kind: 'generator', id: generatorId },
        },
      },
    },
  } as const;
}

export const TEMPORAL_ON_CREATE_ARG = {
  name: 'onCreate',
  kind: 'option',
  values: ['now'],
  optional: true,
} as const;

export const TEMPORAL_ON_UPDATE_ARG = {
  name: 'onUpdate',
  kind: 'option',
  values: ['now'],
  optional: true,
} as const;

/**
 * Selects a generator descriptor for the preset's `now` token. The token is preset vocabulary; the generator id never appears in a user's spelling (ADR 169 — these generators are preset-only).
 */
export function temporalPhaseTemplate<const Index extends number, const GeneratorId extends string>(
  index: Index,
  generatorId: GeneratorId,
) {
  return {
    kind: 'select',
    index,
    cases: { now: { kind: 'generator', id: generatorId } },
  } as const;
}

/**
 * Builds a `temporal.<codec>` field preset for a codec with no type parameters, carrying the codec's storage template through unchanged. Both phase arguments are optional, and omitting one omits that phase.
 */
/* @__NO_SIDE_EFFECTS__ */
export function temporalCodecPreset<const Storage extends PresetStorageTemplate>(storage: Storage) {
  return {
    kind: 'fieldPreset',
    args: [TEMPORAL_ON_CREATE_ARG, TEMPORAL_ON_UPDATE_ARG],
    output: {
      ...storage,
      executionDefaults: {
        onCreate: temporalPhaseTemplate(0, TIMESTAMP_NOW_GENERATOR_ID),
        onUpdate: temporalPhaseTemplate(1, TIMESTAMP_NOW_GENERATOR_ID),
      },
    },
  } as const satisfies AuthoringFieldPresetDescriptor;
}
