import {
  idGeneratorFunctionBindings,
  sqlIntegerArgumentGeneratorFunctions,
} from '@internal/family-sql/pack';
import { TIMESTAMP_NOW_GENERATOR_ID } from '@internal/framework-components/authoring';
import type {
  GeneratorFunctionContribution,
  MutationDefaultGeneratorDescriptor,
} from '@internal/framework-components/components';
import { singleGeneratorBinding } from '@internal/framework-components/components';
import {
  DATE_STRING_NOW_GENERATOR_ID,
  INSTANT_NOW_GENERATOR_ID,
  INSTANT_STRING_NOW_GENERATOR_ID,
  PLAIN_DATE_NOW_GENERATOR_ID,
  PLAIN_TIME_NOW_GENERATOR_ID,
  TIME_STRING_NOW_GENERATOR_ID,
} from '@internal/type-implementations/now';
import {
  SQLITE_DATE_STRING_CODEC_ID,
  SQLITE_DATE_TEMPORAL_CODEC_ID,
  SQLITE_DATETIME_CODEC_ID,
  SQLITE_DATETIME_STRING_CODEC_ID,
  SQLITE_DATETIME_TEMPORAL_CODEC_ID,
  SQLITE_TEXT_CODEC_ID,
  SQLITE_TIME_STRING_CODEC_ID,
  SQLITE_TIME_TEMPORAL_CODEC_ID,
} from './codec-ids';
import { sqliteInteger } from './data-types';
import { sqliteNowGenerators } from './date-time-now-generators';

/** The "now" generator for each codec that has one. The `now` generator function binds it. */
export const sqliteNowGeneratorIds = {
  [SQLITE_DATETIME_CODEC_ID]: TIMESTAMP_NOW_GENERATOR_ID,
  [SQLITE_DATETIME_TEMPORAL_CODEC_ID]: INSTANT_NOW_GENERATOR_ID,
  [SQLITE_DATETIME_STRING_CODEC_ID]: INSTANT_STRING_NOW_GENERATOR_ID,
  [SQLITE_DATE_STRING_CODEC_ID]: DATE_STRING_NOW_GENERATOR_ID,
  [SQLITE_DATE_TEMPORAL_CODEC_ID]: PLAIN_DATE_NOW_GENERATOR_ID,
  [SQLITE_TIME_STRING_CODEC_ID]: TIME_STRING_NOW_GENERATOR_ID,
  [SQLITE_TIME_TEMPORAL_CODEC_ID]: PLAIN_TIME_NOW_GENERATOR_ID,
} as const;

export const sqliteGeneratorFunctions = [
  ...sqlIntegerArgumentGeneratorFunctions({ integer: sqliteInteger.id }),
  {
    name: 'now',
    bindings: Object.entries(sqliteNowGeneratorIds).map(([codecId, generatorId]) =>
      singleGeneratorBinding({ codecIds: [codecId], generatorId }),
    ),
  },
  ...idGeneratorFunctionBindings({ text: [SQLITE_TEXT_CODEC_ID] }),
] as const satisfies readonly GeneratorFunctionContribution[];

/** The `now` generators SQLite binds. The SQL family registers the identifier generators. */
export const sqliteGeneratorDescriptors: readonly MutationDefaultGeneratorDescriptor[] = [
  { id: TIMESTAMP_NOW_GENERATOR_ID },
  ...sqliteNowGenerators.map(({ id }) => ({ id })),
];
