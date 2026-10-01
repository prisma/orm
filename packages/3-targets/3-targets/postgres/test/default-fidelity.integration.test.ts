import type { ColumnDefault, JsonValue } from '@internal/contract/types';
import {
  getAuthoringTypeConstructor,
  instantiateAuthoringTypeConstructor,
} from '@internal/framework-components/authoring';
import { type Codec, materializeCodec } from '@internal/framework-components/codec';
import { parsePslPositionalArgs } from '@internal/psl-parser/interpret';
import { timeouts, withClient, withDevDatabase } from '@repo/test-utils';
import { beforeAll, describe, expect, it } from 'vitest';
import { PG_TEXT_CODEC_ID } from '../src/core/codec-ids';
import { parsePostgresDefault, postgresResolveDefault } from '../src/core/default-normalizer';
import { parsePostgresListText } from '../src/core/list-decoder';
import { type CatalogColumnType, introspectedNativeType } from '../src/core/native-type-normalizer';
import { createPostgresTypeMap } from '../src/core/psl-build/postgres-type-map';
import { postgresCodecDescriptorRegistry } from '../src/core/registry';
import {
  postgresNativeAuthoringTypes,
  postgresScalarAuthoringTypes,
} from '../src/core/type-constructors';
import { enumTypes, type FidelityRow, rows } from './default-fidelity.rows';

type Compared = JsonValue | ColumnDefault | undefined;

interface ComparedValues {
  readonly live: Compared;
  readonly contract: Compared;
  readonly stored: JsonValue;
}

interface Observation {
  readonly columnDefault: string;
  readonly live: ColumnDefault | undefined;
  readonly contract: ColumnDefault;
  readonly values: ComparedValues | undefined;
}

interface CatalogColumn extends CatalogColumnType {
  readonly columnName: string;
  readonly columnDefault: string;
}

const enumNames: ReadonlySet<string> = new Set(enumTypes.map((enumType) => enumType.name));
const typeMap = createPostgresTypeMap(enumNames);
const typeConstructors = {
  type: { ...postgresScalarAuthoringTypes, ...postgresNativeAuthoringTypes },
};

/** The codec and type parameters the type constructor `contract infer` writes names, as `contract emit` reads it. */
function inferredCodecRef(pslType: { readonly name: string; readonly args?: readonly string[] }) {
  const descriptor = getAuthoringTypeConstructor(typeConstructors, [pslType.name]);
  if (descriptor === undefined) return undefined;
  const args = parsePslPositionalArgs(descriptor.args ?? [], pslType.args ?? []);
  return args === undefined ? undefined : instantiateAuthoringTypeConstructor(descriptor, args);
}

/** The codec `contract infer` binds to the column, as `inferredColumnDefaults` chooses it. */
function columnCodec(nativeType: string): Codec {
  const elementType = nativeType.endsWith('[]') ? nativeType.slice(0, -2) : nativeType;
  const resolution = typeMap.resolve(elementType, undefined);
  if ('unsupported' in resolution) throw new Error(`no PSL type for ${elementType}`);
  const ref = enumNames.has(elementType)
    ? { codecId: PG_TEXT_CODEC_ID, typeParams: undefined }
    : inferredCodecRef(resolution.pslType);
  const descriptor =
    ref === undefined ? undefined : postgresCodecDescriptorRegistry.descriptorFor(ref.codecId);
  if (ref === undefined || descriptor === undefined) {
    throw new Error(`no codec for ${elementType}`);
  }
  return materializeCodec(
    descriptor,
    {
      codecId: ref.codecId,
      ...(ref.typeParams === undefined ? {} : { typeParams: ref.typeParams as JsonValue }),
    },
    { name: `<fidelity:${ref.codecId}>` },
  );
}
type PgClient = Parameters<Parameters<typeof withClient>[1]>[0];

interface Oracle {
  readonly client: PgClient;
  /** A temporary table per element type, with one column `v` of that type. */
  readonly tables: ReadonlyMap<string, string>;
}

const JSON_ELEMENT_TYPES: ReadonlySet<string> = new Set(['json', 'jsonb']);

const elementTypeOf = (storageType: string): string => storageType.replace(/\[\]$/, '');

/*
 * Each parse is compared with the stored value on its own, and Postgres decides equality. A string
 * is stored in a column of the element type and read back (`INSERT ... RETURNING v::text`), so two
 * spellings of one value agree and a value the column refuses fails. Before that, both sides go
 * through the column codec's JSON form, so a value of the wrong JSON type fails. json and jsonb
 * values are compared as jsonb instead, because the json codec reads numbers into JavaScript numbers:
 * the parsed value is sent as `JSON.stringify(value)`, the stored text is used as Postgres prints it,
 * and jsonb `=` decides, so `1` matches a stored `1.0`. A stored array is split into elements by `postgres-array`, not by the parser
 * under test.
 */
async function storedValue(
  oracle: Oracle,
  stored: string | null,
  storageType: string,
  nativeType: string,
): Promise<JsonValue> {
  if (stored === null) return null;
  const many = storageType.endsWith('[]');
  if (JSON_ELEMENT_TYPES.has(elementTypeOf(storageType))) {
    if (!many) return asJsonb(oracle, stored);
    const elements: JsonValue[] = [];
    for (const element of parsePostgresListText(stored)) {
      elements.push(typeof element === 'string' ? await asJsonb(oracle, element) : null);
    }
    return elements;
  }
  const codec = columnCodec(nativeType);
  if (!many) return inColumn(oracle, codec.encodeJson(await codec.decode(stored, {})), storageType);
  const elements: JsonValue[] = [];
  for (const element of parsePostgresListText(stored)) {
    elements.push(element === null ? null : codec.encodeJson(await codec.decode(element, {})));
  }
  return inColumn(oracle, elements, storageType);
}

async function parsedValue(
  oracle: Oracle,
  parsed: ColumnDefault | undefined,
  storageType: string,
  nativeType: string,
  stored: JsonValue,
): Promise<Compared> {
  if (parsed?.kind !== 'literal') return parsed;
  const { value } = parsed;
  if (value instanceof Date) return parsed;
  try {
    if (!JSON_ELEMENT_TYPES.has(elementTypeOf(storageType))) {
      return await inColumn(oracle, literalAsJson(value, nativeType), storageType);
    }
    if (!storageType.endsWith('[]') || !Array.isArray(value)) {
      return await jsonbMatching(oracle, value, stored);
    }
    const elements: JsonValue[] = [];
    for (const [index, element] of value.entries()) {
      elements.push(
        await jsonbMatching(oracle, element, Array.isArray(stored) ? stored[index] : null),
      );
    }
    return elements;
  } catch (error) {
    return { rejected: error instanceof Error ? error.message : String(error) };
  }
}

function literalAsJson(value: JsonValue, nativeType: string): JsonValue {
  if (value === null) return null;
  const codec = columnCodec(nativeType);
  if (!nativeType.endsWith('[]') || !Array.isArray(value)) {
    return codec.encodeJson(codec.decodeJson(value));
  }
  return value.map((element) =>
    element === null ? null : codec.encodeJson(codec.decodeJson(element)),
  );
}

async function inColumn(oracle: Oracle, json: JsonValue, storageType: string): Promise<JsonValue> {
  const elementType = elementTypeOf(storageType);
  const table = oracle.tables.get(elementType);
  if (table === undefined) throw new Error(`no table for ${elementType}`);
  const stored = async (value: JsonValue): Promise<JsonValue> => {
    if (typeof value !== 'string') return value;
    return singleValue(
      oracle,
      `INSERT INTO pg_temp.${table} (v) VALUES ($1) RETURNING v::text AS value`,
      value,
    );
  };
  if (!storageType.endsWith('[]') || !Array.isArray(json)) return stored(json);
  const elements: JsonValue[] = [];
  for (const element of json) elements.push(await stored(element));
  return elements;
}

function asJsonb(oracle: Oracle, text: string): Promise<string> {
  return singleValue(oracle, 'SELECT $1::jsonb::text AS value', text);
}

/** The parsed value as jsonb text, or the stored text when the two are equal as jsonb. */
async function jsonbMatching(
  oracle: Oracle,
  value: JsonValue,
  stored: JsonValue | undefined,
): Promise<string> {
  const text = JSON.stringify(value);
  if (typeof stored === 'string') {
    const result = await oracle.client.query<{ equal: boolean }>(
      'SELECT $1::jsonb = $2::jsonb AS equal',
      [text, stored],
    );
    if (result.rows[0]?.equal === true) return stored;
  }
  return asJsonb(oracle, text);
}

async function singleValue(oracle: Oracle, sql: string, parameter: string): Promise<string> {
  const result = await oracle.client.query<{ value: string }>(sql, [parameter]);
  const [row] = result.rows;
  if (row === undefined) throw new Error(`no row from ${sql}`);
  return row.value;
}

async function createOracle(client: PgClient): Promise<Oracle> {
  const elementTypes = new Set(
    rows
      .filter((row) => row.expect === 'literal' || row.expect === 'refused-by-codec')
      .map((row) => elementTypeOf(row.storageType))
      .filter((elementType) => !JSON_ELEMENT_TYPES.has(elementType)),
  );
  const tables = new Map<string, string>();
  for (const elementType of elementTypes) {
    const table = `assign_${tables.size}`;
    await client.query(`CREATE TEMPORARY TABLE ${table} (v ${elementType})`);
    tables.set(elementType, table);
  }
  return { client, tables };
}

async function observe(): Promise<ReadonlyMap<string, Observation>> {
  return withDevDatabase(({ connectionString }) =>
    withClient(connectionString, async (client) => {
      for (const enumType of enumTypes) {
        const values = enumType.values.map((value) => `'${value}'`).join(', ');
        await client.query(`CREATE TYPE "${enumType.name}" AS ENUM (${values})`);
      }
      const definitions = rows.map(
        (row) => `${row.name} ${row.storageType} DEFAULT ${row.written}`,
      );
      await client.query(`CREATE TABLE fidelity (${definitions.join(', ')})`);
      const catalog = await client.query<CatalogColumn>(
        `SELECT c.column_name AS "columnName", c.column_default AS "columnDefault",
                format_type(a.atttypid, a.atttypmod) AS "formattedType",
                c.data_type AS "dataType", c.udt_name AS "udtName",
                c.character_maximum_length AS "characterMaximumLength",
                c.numeric_precision AS "numericPrecision", c.numeric_scale AS "numericScale"
           FROM information_schema.columns c
           JOIN pg_catalog.pg_attribute a
             ON a.attrelid = 'fidelity'::regclass AND a.attname = c.column_name
          WHERE c.table_name = 'fidelity'`,
      );
      await client.query('INSERT INTO fidelity DEFAULT VALUES');
      const projection = rows.map((row) => `${row.name}::text AS ${row.name}`).join(', ');
      const stored = await client.query<Record<string, string | null>>(
        `SELECT ${projection} FROM fidelity`,
      );
      const [storedRow] = stored.rows;
      if (storedRow === undefined) throw new Error('INSERT ... DEFAULT VALUES stored no row');
      const oracle = await createOracle(client);
      const byName = new Map(catalog.rows.map((column) => [column.columnName, column]));
      const observations = new Map<string, Observation>();
      for (const row of rows) {
        const column = byName.get(row.name);
        const storedText = storedRow[row.name];
        if (column === undefined || storedText === undefined) {
          throw new Error(`column ${row.name} missing from the catalog or the stored row`);
        }
        const { resolvedNativeType: nativeType } = introspectedNativeType(column);
        const live = parsePostgresDefault(column.columnDefault, nativeType);
        const contract = postgresResolveDefault(
          { kind: 'function', expression: row.written },
          nativeType,
        );
        let values: ComparedValues | undefined;
        if (row.expect === 'literal' || row.expect === 'refused-by-codec') {
          const stored = await storedValue(oracle, storedText, row.storageType, nativeType);
          values = {
            live: await parsedValue(oracle, live, row.storageType, nativeType, stored),
            contract: await parsedValue(oracle, contract, row.storageType, nativeType, stored),
            stored,
          };
        }
        observations.set(row.name, {
          columnDefault: column.columnDefault,
          live,
          contract,
          values,
        });
      }
      return observations;
    }),
  );
}

describe('default parser against the value Postgres stores', () => {
  let observations: ReadonlyMap<string, Observation> = new Map();

  beforeAll(async () => {
    observations = await observe();
  }, timeouts.spinUpPpgDev);

  function observation(row: FidelityRow): Observation {
    const found = observations.get(row.name);
    if (found === undefined) throw new Error(`no observation for ${row.name}`);
    return found;
  }

  it.each(rows.map((row) => [row.name, row] as const))('%s', (_name, row) => {
    const { columnDefault, live, contract, values } = observation(row);
    if (row.expect === 'raw') {
      expect({ live, contract }).toEqual({
        live: { kind: 'function', expression: columnDefault },
        contract: { kind: 'function', expression: row.written },
      });
      return;
    }
    if (row.expect === 'refused-by-codec') {
      if (values === undefined) throw new Error(`no compared values for ${row.name}`);
      expect({ live: values.live, contract: values.contract }).toEqual({
        live: { rejected: expect.any(String) },
        contract: { rejected: expect.any(String) },
      });
      expect(values.stored).not.toHaveProperty('rejected');
      return;
    }
    if (row.expect !== 'literal') {
      const expected = { kind: 'function', expression: row.expect.function };
      expect({ live, contract }).toEqual({ live: expected, contract: expected });
      return;
    }
    if (values === undefined) throw new Error(`no compared values for ${row.name}`);
    expect({ live: values.live, contract: values.contract }).toEqual({
      live: values.stored,
      contract: values.stored,
    });
  });
});
