import { timeouts, withClient, withDevDatabase } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { type PgNumericCodec, pgNumericDescriptor } from '../src/core/codecs';
import { fromContractJson, toContractJson } from './contract-json';

const ctx = { name: 'canonical-numeric' };

const spellings = [
  '1.5',
  '01.5',
  '007',
  '00',
  '0',
  '-0',
  '-0.00',
  '0.00',
  '-00.10',
  '1.50',
  '-007.50',
  '000012345678901234567890.000123',
  'NaN',
  'Infinity',
  '-Infinity',
];

type NumericParams = { readonly precision?: number; readonly scale?: number };

/** Each column type, with values written in it and the text Postgres prints for each. */
const scaledColumns: readonly (readonly [
  { readonly precision: number; readonly scale?: number },
  readonly string[],
])[] = [
  [{ precision: 10, scale: 2 }, ['1.5', '01.5', '0', '-0', '1.500', '-0.10', 'NaN']],
  [{ precision: 10 }, ['7', '-0', '007']],
  [{ precision: 5, scale: -2 }, ['12300', '12300.00', '-0']],
  [{ precision: 3, scale: 5 }, ['0.001', '0.00123', '-0']],
  [{ precision: 65, scale: 30 }, ['7', '0']],
];

const typeName = ({ precision, scale }: { readonly precision: number; readonly scale?: number }) =>
  scale === undefined ? `numeric(${precision})` : `numeric(${precision},${scale})`;

function reads(codec: PgNumericCodec, params: NumericParams, json: string): boolean {
  try {
    fromContractJson(codec, json, params);
    return true;
  } catch {
    return false;
  }
}

describe('pg/numeric@1 against Postgres', () => {
  it(
    'writes each spelling as the text Postgres prints for a numeric, and reads only that text',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await withClient(connectionString, async (client) => {
          const printed: Record<string, string> = {};
          for (const spelling of spellings) {
            const result = await client.query<{ printed: string }>(
              'SELECT $1::numeric::text AS printed',
              [spelling],
            );
            printed[spelling] = result.rows[0]?.printed ?? '';
          }
          const codec = pgNumericDescriptor.factory({})(ctx);
          expect({
            written: Object.fromEntries(spellings.map((s) => [s, toContractJson(codec, s)])),
            read: Object.fromEntries(spellings.map((s) => [s, reads(codec, {}, s)])),
          }).toEqual({
            written: printed,
            read: Object.fromEntries(spellings.map((s) => [s, printed[s] === s])),
          });
        });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'reads the text Postgres prints for a column with a precision and scale',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await withClient(connectionString, async (client) => {
          const readBack: Record<string, boolean> = {};
          for (const [params, values] of scaledColumns) {
            const codec = pgNumericDescriptor.factory(params)(ctx);
            for (const value of values) {
              const result = await client.query<{ printed: string }>(
                `SELECT $1::${typeName(params)}::text AS printed`,
                [value],
              );
              const printed = result.rows[0]?.printed ?? '';
              readBack[`${typeName(params)} ${printed}`] = reads(codec, params, printed);
            }
          }
          expect(readBack).toEqual({
            'numeric(10,2) 1.50': true,
            'numeric(10,2) 0.00': true,
            'numeric(10,2) -0.10': true,
            'numeric(10,2) NaN': true,
            'numeric(10) 7': true,
            'numeric(10) 0': true,
            'numeric(5,-2) 12300': true,
            'numeric(5,-2) 0': true,
            'numeric(3,5) 0.00100': true,
            'numeric(3,5) 0.00123': true,
            'numeric(3,5) 0.00000': true,
            'numeric(65,30) 7.000000000000000000000000000000': true,
            'numeric(65,30) 0.000000000000000000000000000000': true,
          });
        });
      });
    },
    timeouts.spinUpPpgDev,
  );
});
