import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import {
  fixtureDataTypeEntries,
  fixtureDataTypes,
} from '../../../contract-psl/test/fixture-data-types';
import {
  familyPack as generatorFamilyPack,
  targetPack as generatorTargetPack,
} from './generator-function-packs';

const familyPackBase = {
  ...generatorFamilyPack,
  dataTypes: fixtureDataTypes,
  authoring: { dataTypes: fixtureDataTypeEntries },
} as const satisfies FamilyPackRef<'sql'>;

export const familyPack: typeof familyPackBase & {
  readonly __dataTypeArguments?: {
    readonly 'pg/int4': { readonly argument: number; readonly parameter: number };
  };
} = familyPackBase;

const precision = {
  kind: 'value',
  dataType: 'pg/int4',
  name: 'precision',
  optional: true,
} as const;

const withPrecision = <const CodecId extends string>(codecId: CodecId) =>
  ({
    kind: 'typeConstructor',
    args: [precision],
    output: { codecId, typeParams: { precision: { kind: 'arg', index: 0 } } },
  }) as const;

export const targetPack = {
  ...generatorTargetPack,
  authoring: {
    type: {
      TimestamptzTemporal: withPrecision('pg/timestamptz-temporal@1'),
      TimestampTemporal: withPrecision('pg/timestamp-temporal@1'),
      TimestampString: withPrecision('pg/timestamp-string@1'),
      DateString: { kind: 'typeConstructor', output: { codecId: 'pg/date-string@1' } },
      DateTemporal: { kind: 'typeConstructor', output: { codecId: 'pg/date-temporal@1' } },
      Moment: {
        kind: 'typeChoice',
        args: [
          {
            kind: 'option',
            name: 'as',
            values: ['temporal', 'string', 'date'],
            default: 'temporal',
            optional: true,
          },
          {
            kind: 'option',
            name: 'storage',
            values: ['tz', 'local'],
            default: 'tz',
            optional: true,
          },
          precision,
        ],
        choices: [
          {
            when: { as: 'temporal', storage: 'tz' },
            type: 'TimestamptzTemporal',
            defaults: { precision: 3 },
          },
          { when: { as: 'temporal', storage: 'local' }, type: 'TimestampTemporal' },
          { when: { as: 'string', storage: 'local' }, type: 'TimestampString' },
          { when: { as: 'date', storage: 'local' }, type: 'DateString' },
        ],
      },
      Day: {
        kind: 'typeChoice',
        args: [
          {
            kind: 'option',
            name: 'as',
            values: ['string', 'temporal'],
            default: 'string',
            optional: true,
          },
        ],
        choices: [
          { when: { as: 'string' }, type: 'DateString' },
          { when: { as: 'temporal' }, type: 'DateTemporal' },
        ],
      },
    },
  },
} as const satisfies TargetPackRef<'sql', 'postgres'>;
