import type { AuthoringFieldPresetDescriptor } from '@internal/framework-components/authoring';
import type { MutationDefaultGeneratorDescriptor } from '@internal/framework-components/control';

/**
 * Canonical id for the wall-clock-now mutation default generator.
 *
 * Owned by `family-sql` because that's where the generator lives. The
 * id flows out from here to (1) the control-plane descriptor and the
 * temporal field-preset pair below, (2) the runtime-plane sibling
 * `timestamp-now-runtime-generator.ts`, and (3) authoring surfaces
 * (PSL `temporal.updatedAt()`, TS `field.temporal.updatedAt()`) via
 * the descriptor flow. Co-locating the constant with its only owner
 * keeps the framework layer free of concrete generator ids.
 */
export const TIMESTAMP_NOW_GENERATOR_ID = 'timestampNow' as const;

/**
 * Builds the canonical control-plane descriptor for the wall-clock-now
 * mutation default generator. The descriptor's `id` and `buildPhases`
 * are target-agnostic so PSL `temporal.updatedAt()` and TS
 * `field.temporal.updatedAt()` lower to byte-identical contracts.
 *
 * `applicableCodecIds` is omitted: `timestampNow` is preset-only (not
 * reachable via `@default(timestampNow())` lowering), and the codec is
 * co-registered by the preset descriptor itself, so the
 * `@default(...)` compatibility check has no role to play here.
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
 * Builds the canonical `temporal.{createdAt,updatedAt}` field-preset pair
 * for a SQL target. `createdAt` lowers to a `now()` storage default;
 * `updatedAt` lowers to the `timestampNow` execution generator on both
 * `onCreate` and `onUpdate` (RD: "last modified time", non-null). Targets
 * supply the codec/native-type pair that matches their timestamp column;
 * everything else is shared so PSL `temporal.updatedAt()` and TS
 * `field.temporal.updatedAt()` lower to byte-identical contracts across
 * targets by construction.
 */
/* @__NO_SIDE_EFFECTS__ */
export function temporalAuthoringPresets<
  const CodecId extends string,
  const NativeType extends string,
>(input: { readonly codecId: CodecId; readonly nativeType: NativeType }) {
  const { codecId, nativeType } = input;
  return {
    createdAt: {
      kind: 'fieldPreset',
      output: {
        codecId,
        nativeType,
        default: { kind: 'function', expression: 'now()' },
      },
    },
    updatedAt: {
      kind: 'fieldPreset',
      output: {
        codecId,
        nativeType,
        executionDefaults: {
          onCreate: { kind: 'generator', id: TIMESTAMP_NOW_GENERATOR_ID },
          onUpdate: { kind: 'generator', id: TIMESTAMP_NOW_GENERATOR_ID },
        },
      },
    },
  } as const satisfies Record<string, AuthoringFieldPresetDescriptor>;
}

/**
 * The representation-explicit siblings of {@link temporalAuthoringPresets}, under names that say
 * which representation they select: `createdAtString` / `updatedAtString` beside `createdAt` /
 * `updatedAt`.
 *
 * Delegates rather than restating, so the two pairs cannot drift in what they lower to. Only the
 * key names and the caller's codec differ — the storage default, the execution generator and both
 * phases are the shared ones, which is what keeps a target's two representations byte-identical in
 * everything except the codec they name.
 */
/* @__NO_SIDE_EFFECTS__ */
export function temporalStringAuthoringPresets<
  const CodecId extends string,
  const NativeType extends string,
>(input: { readonly codecId: CodecId; readonly nativeType: NativeType }) {
  const presets = temporalAuthoringPresets(input);
  return {
    createdAtString: presets.createdAt,
    updatedAtString: presets.updatedAt,
  } as const satisfies Record<string, AuthoringFieldPresetDescriptor>;
}

const TEMPORAL_PRECISION_ARG = {
  name: 'precision',
  kind: 'number',
  optional: true,
  integer: true,
  minimum: 0,
} as const;

const TEMPORAL_ON_CREATE_ARG = {
  name: 'onCreate',
  kind: 'option',
  values: ['now'],
  optional: true,
} as const;

const TEMPORAL_ON_UPDATE_ARG = {
  name: 'onUpdate',
  kind: 'option',
  values: ['now'],
  optional: true,
} as const;

/**
 * Selects the `timestampNow` generator descriptor for the preset's `now`
 * token. The token is preset vocabulary; the generator id never appears in a
 * user's spelling (ADR 169 — `timestampNow` is preset-only).
 */
function temporalPhaseTemplate<const Index extends number>(index: Index) {
  return {
    kind: 'select',
    index,
    cases: { now: { kind: 'generator', id: TIMESTAMP_NOW_GENERATOR_ID } },
  } as const;
}

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
>(input: { readonly codecId: CodecId; readonly nativeType: NativeType }) {
  return {
    kind: 'fieldPreset',
    args: [TEMPORAL_PRECISION_ARG, TEMPORAL_ON_CREATE_ARG, TEMPORAL_ON_UPDATE_ARG],
    output: {
      codecId: input.codecId,
      nativeType: input.nativeType,
      typeParams: { precision: { kind: 'arg', index: 0 } },
      executionDefaults: {
        onCreate: temporalPhaseTemplate(1),
        onUpdate: temporalPhaseTemplate(2),
      },
    },
  } as const satisfies AuthoringFieldPresetDescriptor;
}

/**
 * Builds a `temporal.<codec>` field preset for a codec with no type
 * parameters (`sqlite/datetime@1`). As with the precision-bearing variant,
 * both phase arguments are optional and omitting one omits that phase.
 */
/* @__NO_SIDE_EFFECTS__ */
export function temporalCodecPreset<
  const CodecId extends string,
  const NativeType extends string,
>(input: { readonly codecId: CodecId; readonly nativeType: NativeType }) {
  return {
    kind: 'fieldPreset',
    args: [TEMPORAL_ON_CREATE_ARG, TEMPORAL_ON_UPDATE_ARG],
    output: {
      codecId: input.codecId,
      nativeType: input.nativeType,
      executionDefaults: {
        onCreate: temporalPhaseTemplate(0),
        onUpdate: temporalPhaseTemplate(1),
      },
    },
  } as const satisfies AuthoringFieldPresetDescriptor;
}
