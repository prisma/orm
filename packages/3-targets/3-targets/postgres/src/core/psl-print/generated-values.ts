import type { ExecutionMutationDefault } from '@internal/contract/types';
import type {
  PslAttributeArgument,
  PslFieldAttribute,
} from '@internal/framework-components/psl-ast';
import {
  PG_TIMESTAMP_STRING_CODEC_ID,
  PG_TIMESTAMP_TEMPORAL_CODEC_ID,
  PG_TIMESTAMPTZ_DATE_CODEC_ID,
  PG_TIMESTAMPTZ_STRING_CODEC_ID,
  PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID,
} from '../codec-ids';
import { postgresNowGeneratorIdFor } from '../now-generators';
import { buildAttribute, namedArg, positionalArg } from '../psl-ast/psl-literals';
import {
  refuseGeneratorOnUpdate,
  refuseGeneratorWithoutPslFunction,
  refuseNowGeneratorPairedWithAnother,
} from './refusals';

/**
 * The `temporal.*` field preset each codec with a "now" generator is authored through. The target
 * contributes the presets; `adapter-postgres/test/psl-print-generated-values.test.ts` writes and
 * reads back every one the stack contributes, so this table cannot drift from them.
 */
const TEMPORAL_PRESET_NAMES: ReadonlyMap<string, string> = new Map([
  [PG_TIMESTAMP_TEMPORAL_CODEC_ID, 'timestamp'],
  [PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID, 'timestamptz'],
  [PG_TIMESTAMP_STRING_CODEC_ID, 'timestampString'],
  [PG_TIMESTAMPTZ_STRING_CODEC_ID, 'timestamptzString'],
  [PG_TIMESTAMPTZ_DATE_CODEC_ID, 'timestamptzJsDate'],
]);

/**
 * The `@default(<fn>(…))` call each id generator is authored through. The Postgres adapter registers
 * the functions; `adapter-postgres/test/psl-print-generated-values.test.ts` writes and reads back
 * every call the stack registers, so this table cannot drift from them.
 */
type GeneratorCall = (params: Record<string, unknown> | undefined) => string;

const GENERATOR_CALLS: ReadonlyMap<string, GeneratorCall> = new Map<string, GeneratorCall>([
  ['uuidv4', () => 'uuid()'],
  ['uuidv7', () => 'uuid(7)'],
  ['cuid2', () => 'cuid(2)'],
  ['ulid', () => 'ulid()'],
  [
    'nanoid',
    (params) => (typeof params?.['size'] === 'number' ? `nanoid(${params['size']})` : 'nanoid()'),
  ],
]);

/** The phases a column's `temporal.*` preset must switch on. */
export interface TemporalPresetPhases {
  readonly presetName: string;
  readonly onCreate: boolean;
  readonly onUpdate: boolean;
}

export type BuiltExecutionDefault =
  | { readonly kind: 'attribute'; readonly attribute: PslFieldAttribute }
  | { readonly kind: 'temporal'; readonly phases: TemporalPresetPhases };

/**
 * How one column's execution generators are written in PSL: an id generator as a `@default(<fn>())`
 * attribute, and a wall-clock-now generator as the `temporal.*` preset the column's codec is
 * authored through.
 */
export function buildExecutionDefault(input: {
  readonly executionDefault: ExecutionMutationDefault;
  readonly codecId: string;
  readonly coordinate: string;
}): BuiltExecutionDefault {
  const { executionDefault, codecId, coordinate } = input;
  const onCreateId = executionDefault.onCreate?.id;
  const onUpdateId = executionDefault.onUpdate?.id;

  const nowGeneratorId = postgresNowGeneratorIdFor(codecId);
  const presetName = TEMPORAL_PRESET_NAMES.get(codecId);
  if (nowGeneratorId !== undefined && presetName !== undefined) {
    const onCreate = onCreateId === nowGeneratorId;
    const onUpdate = onUpdateId === nowGeneratorId;
    if (onCreate || onUpdate) {
      if ((onCreateId !== undefined && !onCreate) || (onUpdateId !== undefined && !onUpdate)) {
        refuseNowGeneratorPairedWithAnother({
          coordinate,
          onCreate: onCreateId,
          onUpdate: onUpdateId,
          other: onCreate ? onUpdateId : onCreateId,
        });
      }
      return { kind: 'temporal', phases: { presetName, onCreate, onUpdate } };
    }
  }

  const phases = { coordinate, onCreate: onCreateId, onUpdate: onUpdateId };
  if (onUpdateId !== undefined) refuseGeneratorOnUpdate(phases);
  const call = onCreateId === undefined ? undefined : GENERATOR_CALLS.get(onCreateId);
  if (call === undefined) refuseGeneratorWithoutPslFunction(phases);
  return {
    kind: 'attribute',
    attribute: buildAttribute('field', 'default', [
      positionalArg(call(executionDefault.onCreate?.params)),
    ]),
  };
}

/** The `temporal.<preset>(precision?, onCreate: now, onUpdate: now)` argument list. */
export function temporalPresetArguments(input: {
  readonly phases: TemporalPresetPhases;
  readonly precision: unknown;
}): readonly PslAttributeArgument[] {
  const args: PslAttributeArgument[] = [];
  if (typeof input.precision === 'number') {
    args.push(positionalArg(String(input.precision)));
  }
  if (input.phases.onCreate) {
    args.push(namedArg('onCreate', 'now'));
  }
  if (input.phases.onUpdate) {
    args.push(namedArg('onUpdate', 'now'));
  }
  return args;
}
