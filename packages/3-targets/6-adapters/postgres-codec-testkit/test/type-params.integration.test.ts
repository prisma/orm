import type { JsonValue } from '@internal/contract/types';
import postgresControlDriverDescriptor from '@internal/driver-postgres/control';
import { validateCodecTypeParams } from '@internal/framework-components/codec';
import { postgresCodecDescriptorRegistry } from '@internal/target-postgres/codecs';
import { ifDefined } from '@internal/utils/defined';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

interface TypeCase {
  readonly codecId: string;
  readonly typeParams: JsonValue | undefined;
  /** The column type PostgreSQL stores the value in. */
  readonly columnType: string;
  /** The type the stored value is compared as, so a value PostgreSQL rounds or truncates is told apart. */
  readonly compareAs: string;
  readonly candidates: readonly (readonly [value: string, storedUnchanged: boolean])[];
  /** Whether the codec's JSON form of a candidate is a JSON number rather than the text. */
  readonly numeric?: true;
}

// Each candidate is stored in a column of the type and compared with itself as written: decodeJson must take exactly the values PostgreSQL stores without changing them, and the JSON PostgreSQL writes for each stored value.
const typeCases: readonly TypeCase[] = [
  {
    codecId: 'sql/varchar@1',
    typeParams: { length: 3 },
    columnType: 'varchar(3)',
    compareAs: 'varchar',
    candidates: [
      ['abc', true],
      ['ab', true],
      ['', true],
      ['日本語', true],
      ['\u{1F600}\u{1F600}\u{1F600}', true],
      ['abcd', false],
      ['ab  ', false],
      ['\u{1F600}\u{1F600}\u{1F600}\u{1F600}', false],
    ],
  },
  {
    codecId: 'sql/char@1',
    typeParams: { length: 3 },
    columnType: 'char(3)',
    compareAs: 'bpchar',
    candidates: [
      ['abc', true],
      ['ab', true],
      ['ab ', true],
      ['abc  ', true],
      ['', true],
      ['\u{1F600}\u{1F600}\u{1F600}', true],
      ['abcd', false],
      ['a bc', false],
    ],
  },
  {
    codecId: 'pg/varchar@1',
    typeParams: { length: 2 },
    columnType: 'varchar(2)',
    compareAs: 'varchar',
    candidates: [
      ['ab', true],
      ['abc', false],
    ],
  },
  {
    codecId: 'pg/char@1',
    typeParams: { length: 2 },
    columnType: 'char(2)',
    compareAs: 'bpchar',
    candidates: [
      ['a', true],
      ['abc', false],
    ],
  },
  {
    codecId: 'pg/bit@1',
    typeParams: { length: 4 },
    columnType: 'bit(4)',
    compareAs: 'varbit',
    candidates: [
      ['1010', true],
      ['101', false],
      ['10101', false],
      ['', false],
    ],
  },
  {
    codecId: 'pg/varbit@1',
    typeParams: { length: 4 },
    columnType: 'varbit(4)',
    compareAs: 'varbit',
    candidates: [
      ['1010', true],
      ['101', true],
      ['', true],
      ['10101', false],
    ],
  },
  {
    codecId: 'pg/numeric@1',
    typeParams: { precision: 5, scale: 2 },
    columnType: 'numeric(5, 2)',
    compareAs: 'numeric',
    candidates: [
      ['123.45', true],
      ['-123.45', true],
      ['999.99', true],
      ['1.5', true],
      ['0', true],
      ['0.01', true],
      ['NaN', true],
      ['1234.5', false],
      ['1000', false],
      ['1.555', false],
      ['0.001', false],
      ['Infinity', false],
    ],
  },
  {
    codecId: 'pg/numeric@1',
    typeParams: { precision: 5, scale: -2 },
    columnType: 'numeric(5, -2)',
    compareAs: 'numeric',
    candidates: [
      ['12300', true],
      ['-500', true],
      ['9999900', true],
      ['0', true],
      ['NaN', true],
      ['12345', false],
      ['12350', false],
      ['10000000', false],
      ['1.5', false],
    ],
  },
  {
    codecId: 'pg/numeric@1',
    typeParams: { precision: 2, scale: 5 },
    columnType: 'numeric(2, 5)',
    compareAs: 'numeric',
    candidates: [
      ['0.00012', true],
      ['-0.00099', true],
      ['0.00001', true],
      ['0', true],
      ['0.001', false],
      ['0.000012', false],
      ['1', false],
    ],
  },
  {
    codecId: 'pg/numeric@1',
    typeParams: { precision: 3 },
    columnType: 'numeric(3)',
    compareAs: 'numeric',
    candidates: [
      ['999', true],
      ['-999', true],
      ['1000', false],
      ['1.5', false],
    ],
  },
  {
    codecId: 'pg/int@1',
    typeParams: undefined,
    columnType: 'int4',
    compareAs: 'int8',
    numeric: true,
    candidates: [
      ['2147483647', true],
      ['-2147483648', true],
      ['2147483648', false],
    ],
  },
  {
    codecId: 'sql/int@1',
    typeParams: undefined,
    columnType: 'int4',
    compareAs: 'int8',
    numeric: true,
    candidates: [
      ['2147483647', true],
      ['-2147483648', true],
      ['2147483648', false],
      ['3000000000', false],
    ],
  },
  {
    codecId: 'sql/char@1',
    typeParams: undefined,
    columnType: 'character',
    compareAs: 'bpchar',
    candidates: [
      ['a', true],
      ['a ', true],
      ['', true],
      ['ab', false],
      ['abc', false],
    ],
  },
  {
    codecId: 'pg/bit@1',
    typeParams: undefined,
    columnType: 'bit',
    compareAs: 'varbit',
    candidates: [
      ['1', true],
      ['0', true],
      ['01', false],
      ['', false],
    ],
  },
  {
    codecId: 'pg/float4@1',
    typeParams: undefined,
    columnType: 'float4',
    compareAs: 'float4',
    numeric: true,
    candidates: [
      ['1.5', true],
      ['0', true],
      ['3.4e38', true],
      ['-3.4e38', true],
      ['1e-40', true],
      ['1e300', false],
      ['-1e300', false],
      ['3.5e38', false],
      ['1e-50', false],
    ],
  },
];

describe('decodeJson checks the type parameters PostgreSQL enforces', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>> | undefined;
  let driver: Awaited<ReturnType<typeof postgresControlDriverDescriptor.create>> | undefined;

  beforeAll(async () => {
    database = await createDevDatabase();
    driver = await postgresControlDriverDescriptor.create(database.connectionString);
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    await driver?.close();
    await database?.close();
  }, timeouts.spinUpPpgDev);

  /** Whether PostgreSQL stores the value without changing it, and if so the JSON it writes for the stored value. */
  async function store(
    typeCase: TypeCase,
    value: string,
  ): Promise<{ readonly unchanged: boolean; readonly json: JsonValue | undefined }> {
    await driver!.query('drop table if exists type_params_probe');
    await driver!.query(`create table type_params_probe (v ${typeCase.columnType})`);
    try {
      await driver!.query('insert into type_params_probe (v) values ($1)', [value]);
    } catch {
      return { unchanged: false, json: undefined };
    }
    const projected = typeCase.numeric === true ? 'v' : 'v::text';
    const result = await driver!.query<{ same: boolean; json: JsonValue }>(
      `select v = $1::${typeCase.compareAs} as same, to_json(${projected}) as json from type_params_probe`,
      [value],
    );
    const row = result.rows[0];
    return row?.same === true
      ? { unchanged: true, json: row.json }
      : { unchanged: false, json: undefined };
  }

  for (const typeCase of typeCases) {
    it(
      `${typeCase.codecId} ${JSON.stringify(typeCase.typeParams ?? {})} takes exactly the values ${typeCase.columnType} stores unchanged`,
      async () => {
        const descriptor = postgresCodecDescriptorRegistry.descriptorFor(typeCase.codecId)!;
        const codec = descriptor.factory(
          validateCodecTypeParams(descriptor, {
            codecId: typeCase.codecId,
            ...ifDefined('typeParams', typeCase.typeParams),
          }),
        )({ name: 'type-params' });
        const decodes = (json: JsonValue): boolean => {
          try {
            codec.decodeJson(json);
            return true;
          } catch {
            return false;
          }
        };
        const results = [];
        for (const [value] of typeCase.candidates) {
          const written = typeCase.numeric === true ? Number(value) : value;
          const stored = await store(typeCase, value);
          results.push({
            value,
            postgres: stored.unchanged,
            decodeJson: decodes(written),
            databaseJson: stored.json === undefined ? undefined : decodes(stored.json),
          });
        }

        expect(results).toEqual(
          typeCase.candidates.map(([value, unchanged]) => ({
            value,
            postgres: unchanged,
            decodeJson: unchanged,
            databaseJson: unchanged ? true : undefined,
          })),
        );
      },
      timeouts.spinUpPpgDev,
    );
  }
});
