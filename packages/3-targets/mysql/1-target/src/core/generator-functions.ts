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
  MYSQL_DATE_STRING_CODEC_ID,
  MYSQL_DATE_TEMPORAL_CODEC_ID,
  MYSQL_DATETIME_CODEC_ID,
  MYSQL_DATETIME_STRING_CODEC_ID,
  MYSQL_DATETIME_TEMPORAL_CODEC_ID,
  MYSQL_TEXT_CODEC_ID,
  MYSQL_TIME_STRING_CODEC_ID,
  MYSQL_TIME_TEMPORAL_CODEC_ID,
  MYSQL_TIMESTAMP_DATE_CODEC_ID,
  MYSQL_TIMESTAMP_STRING_CODEC_ID,
  MYSQL_TIMESTAMP_TEMPORAL_CODEC_ID,
} from './codec-ids';
import { mysqlInt } from './data-types';
import { mysqlNowGenerators } from './date-time-now-generators';

/** The "now" generator for each codec that has one. The `now` generator function binds it. */
export const mysqlNowGeneratorIds = {
  [MYSQL_DATETIME_CODEC_ID]: TIMESTAMP_NOW_GENERATOR_ID,
  [MYSQL_DATETIME_TEMPORAL_CODEC_ID]: INSTANT_NOW_GENERATOR_ID,
  [MYSQL_DATETIME_STRING_CODEC_ID]: INSTANT_STRING_NOW_GENERATOR_ID,
  [MYSQL_TIMESTAMP_DATE_CODEC_ID]: TIMESTAMP_NOW_GENERATOR_ID,
  [MYSQL_TIMESTAMP_TEMPORAL_CODEC_ID]: INSTANT_NOW_GENERATOR_ID,
  [MYSQL_TIMESTAMP_STRING_CODEC_ID]: INSTANT_STRING_NOW_GENERATOR_ID,
  [MYSQL_DATE_STRING_CODEC_ID]: DATE_STRING_NOW_GENERATOR_ID,
  [MYSQL_DATE_TEMPORAL_CODEC_ID]: PLAIN_DATE_NOW_GENERATOR_ID,
  [MYSQL_TIME_STRING_CODEC_ID]: TIME_STRING_NOW_GENERATOR_ID,
  [MYSQL_TIME_TEMPORAL_CODEC_ID]: PLAIN_TIME_NOW_GENERATOR_ID,
} as const;

/** The generators that round down to the column's fraction digits, 0 for a bare type. `timestampNow` writes a `Date`, which the column rounds as it did before these types, so its contract keeps no precision. */
const takesPrecision: ReadonlySet<string> = new Set([
  INSTANT_NOW_GENERATOR_ID,
  INSTANT_STRING_NOW_GENERATOR_ID,
  PLAIN_TIME_NOW_GENERATOR_ID,
  TIME_STRING_NOW_GENERATOR_ID,
]);

export const mysqlGeneratorFunctions = [
  ...sqlIntegerArgumentGeneratorFunctions({ integer: mysqlInt.id }),
  {
    name: 'now',
    bindings: Object.entries(mysqlNowGeneratorIds).map(([codecId, generatorId]) =>
      singleGeneratorBinding({
        codecIds: [codecId],
        generatorId,
        paramsFromField: (column) => {
          if (!takesPrecision.has(generatorId)) return undefined;
          const precision = column.typeParams?.['precision'];
          return { precision: typeof precision === 'number' ? precision : 0 };
        },
      }),
    ),
  },
  ...idGeneratorFunctionBindings({ text: [MYSQL_TEXT_CODEC_ID] }),
] as const satisfies readonly GeneratorFunctionContribution[];

/** The `now` generators MySQL binds. The SQL family registers the identifier generators. */
export const mysqlGeneratorDescriptors: readonly MutationDefaultGeneratorDescriptor[] = [
  { id: TIMESTAMP_NOW_GENERATOR_ID },
  ...mysqlNowGenerators.map(({ id }) => ({ id })),
];
