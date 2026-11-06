import {
  idGeneratorFunctionBindings,
  sqlIntegerArgumentGeneratorFunctions,
} from '@internal/family-sql/pack';
import { TIMESTAMP_NOW_GENERATOR_ID } from '@internal/framework-components/authoring';
import type {
  GeneratorFunctionContribution,
  MutationDefaultGeneratorDescriptor,
} from '@internal/framework-components/components';
import {
  PG_CHAR_CODEC_ID,
  PG_TEXT_CODEC_ID,
  PG_UUID_CODEC_ID,
  PG_VARCHAR_CODEC_ID,
} from './codec-ids';
import { pgInt4 } from './data-types';
import { postgresNowGeneratorControlDescriptors } from './date-time-now-generators';
import { postgresNowGeneratorFunction } from './now-generators';

export const postgresGeneratorFunctions = [
  ...sqlIntegerArgumentGeneratorFunctions({ integer: pgInt4.id }),
  postgresNowGeneratorFunction,
  ...idGeneratorFunctionBindings({
    text: [PG_CHAR_CODEC_ID, PG_VARCHAR_CODEC_ID, PG_TEXT_CODEC_ID],
    uuid: [PG_UUID_CODEC_ID],
  }),
] as const satisfies readonly GeneratorFunctionContribution[];

/** The `now` generators Postgres binds. The SQL family registers the identifier generators. */
export const postgresGeneratorDescriptors: readonly MutationDefaultGeneratorDescriptor[] = [
  { id: TIMESTAMP_NOW_GENERATOR_ID },
  ...postgresNowGeneratorControlDescriptors(),
];
