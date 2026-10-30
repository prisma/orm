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

/** The generators that round down to the column's fraction digits, 0 for a bare type. */
const takesPrecision: ReadonlySet<string> = new Set([
  INSTANT_NOW_GENERATOR_ID,
  INSTANT_STRING_NOW_GENERATOR_ID,
  PLAIN_TIME_NOW_GENERATOR_ID,
  TIME_STRING_NOW_GENERATOR_ID,
]);

/** The fraction digits a `Date` holds: `timestampNow` takes a precision only below them, so a column of 3 or more, such as a bare `DateTime`, keeps a contract with no generator params. */
const DATE_FRACTION_DIGITS = 3;

function nowParams(
  generatorId: string,
  typeParams: Readonly<Record<string, unknown>> | undefined,
): { readonly precision: number } | undefined {
  const written = typeParams?.['precision'];
  const precision = typeof written === 'number' ? written : 0;
  if (takesPrecision.has(generatorId)) return { precision };
  if (generatorId === TIMESTAMP_NOW_GENERATOR_ID && precision < DATE_FRACTION_DIGITS) {
    return { precision };
  }
  return undefined;
}

export const mysqlGeneratorFunctions = [
  ...sqlIntegerArgumentGeneratorFunctions({ integer: mysqlInt.id }),
  {
    name: 'now',
    bindings: Object.entries(mysqlNowGeneratorIds).map(([codecId, generatorId]) =>
      singleGeneratorBinding({
        codecIds: [codecId],
        generatorId,
        paramsFromField: (column) => nowParams(generatorId, column.typeParams),
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
