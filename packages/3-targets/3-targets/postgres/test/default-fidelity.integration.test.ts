import type { ColumnDefault, JsonValue } from '@internal/contract/types';
import { fewestArgumentsCall, inferredTypeConstructors } from '@internal/family-sql/psl-build';
import { instantiateAuthoringTypeConstructor } from '@internal/framework-components/authoring';
import {
  type Codec,
  createDataTypeLookup,
  materializeCodec,
} from '@internal/framework-components/codec';
import { resolveReportedSqlType } from '@internal/sql-contract/data-type';
import type { ReportedSqlType } from '@internal/sql-schema-ir/types';
import { timeouts, withClient, withDevDatabase } from '@repo/test-utils';
import { beforeAll, describe, expect, it } from 'vitest';
import { PG_TEXT_CODEC_ID } from '../src/core/codec-ids';
import { postgresDataTypes } from '../src/core/data-types';
import { parsePostgresListText } from '../src/core/list-decoder';
import { type CatalogColumnType, introspectedNativeType } from '../src/core/native-type-normalizer';
import { readDefaultWithCodec } from '../src/core/psl-infer/infer-read-defaults';
import { postgresCodecDescriptorRegistry } from '../src/core/registry';
import { postgresPslTypeConstructors } from '../src/core/type-constructors';
import { toContractJson } from './contract-json';
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
  readonly reportedText: string;
  readonly reportedSchema: string;
  readonly reportedName: string;
}

/** A fidelity column: its type as introspection normalizes it, and as the database reports its element type. */
interface FidelityColumn {
  readonly nativeType: string;
  readonly reportedType: ReportedSqlType;
}

const enumNames: ReadonlySet<string> = new Set(enumTypes.map((enumType) => enumType.name));
const constructors = inferredTypeConstructors({
  authoringTypes: postgresPslTypeConstructors,
  codecLookup: postgresCodecDescriptorRegistry,
  dataTypeLookup: createDataTypeLookup(postgresDataTypes),
});

/** The codec and type parameters of the call `contract infer` writes for the column, as `contract emit` reads it. */
function inferredCodecRef(reportedType: ReportedSqlType) {
  const resolved = resolveReportedSqlType(reportedType, postgresDataTypes);
  const marked = resolved && constructors.get(resolved.dataType);
  const call = resolved && marked && fewestArgumentsCall(marked, resolved.typeParams);
  return marked && call && instantiateAuthoringTypeConstructor(marked.descriptor, call.args);
}

/** The codec `contract infer` binds to the column, as `inferredColumnDefaults` chooses it. */
function columnCodec({ nativeType, reportedType }: FidelityColumn): Codec {
  const elementType = nativeType.endsWith('[]') ? nativeType.slice(0, -2) : nativeType;
  const ref = enumNames.has(elementType)
    ? { codecId: PG_TEXT_CODEC_ID, typeParams: undefined }
    : inferredCodecRef(reportedType);
  const descriptor =
    ref === undefined ? undefined : postgresCodecDescriptorRegistry.descriptorFor(ref.codecId);
  if (ref === undefined || descriptor === undefined) {
    throw new Error(`no codec for ${elementType}`);
  }
  const codec = materializeCodec(
    descriptor,
    {
      codecId: ref.codecId,
      ...(ref.typeParams === undefined ? {} : { typeParams: ref.typeParams as JsonValue }),
    },
    { name: `<fidelity:${ref.codecId}>` },
  );
  return codec;
}
function codecOrUndefined(column: FidelityColumn): Codec | undefined {
  try {
    return columnCodec(column);
  } catch {
    return undefined;
  }
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
  column: FidelityColumn,
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
  const codec = columnCodec(column);
  if (!many)
    return inColumn(oracle, toContractJson(codec, await codec.fromWire(stored, {})), storageType);
  const elements: JsonValue[] = [];
  for (const element of parsePostgresListText(stored)) {
    elements.push(
      element === null ? null : toContractJson(codec, await codec.fromWire(element, {})),
    );
  }
  return inColumn(oracle, elements, storageType);
}

async function parsedValue(
  oracle: Oracle,
  parsed: ColumnDefault | undefined,
  storageType: string,
  stored: JsonValue,
): Promise<Compared> {
  if (parsed?.kind !== 'literal') return parsed;
  const { value } = parsed;
  if (value instanceof Date) return parsed;
  try {
    if (!JSON_ELEMENT_TYPES.has(elementTypeOf(storageType))) {
      return await inColumn(oracle, value, storageType);
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
                c.numeric_precision AS "numericPrecision", c.numeric_scale AS "numericScale",
                format_type(COALESCE(et.oid, t.oid), a.atttypmod) AS "reportedText",
                tns.nspname AS "reportedSchema",
                COALESCE(et.typname, t.typname) AS "reportedName"
           FROM information_schema.columns c
           JOIN pg_catalog.pg_attribute a
             ON a.attrelid = 'fidelity'::regclass AND a.attname = c.column_name
           JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
           LEFT JOIN pg_catalog.pg_type et ON et.typarray = t.oid
           JOIN pg_catalog.pg_namespace tns
             ON tns.oid = COALESCE(et.typnamespace, t.typnamespace)
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
        const fidelityColumn: FidelityColumn = {
          nativeType,
          reportedType: {
            text: column.reportedText,
            kind: undefined,
            schema: column.reportedSchema,
            name: column.reportedName,
          },
        };
        const codec = codecOrUndefined(fidelityColumn);
        const live = await readDefaultWithCodec(column.columnDefault, nativeType, codec);
        const contract = await readDefaultWithCodec(row.written, nativeType, codec);
        let values: ComparedValues | undefined;
        if (row.expect === 'literal' || row.expect === 'refused-by-codec') {
          const stored = await storedValue(oracle, storedText, row.storageType, fidelityColumn);
          values = {
            live: await parsedValue(oracle, live, row.storageType, stored),
            contract: await parsedValue(oracle, contract, row.storageType, stored),
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

describe('a reported default read with the codec contract infer prints, against the value Postgres stores', () => {
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
      expect({ live, contract }).toEqual({
        live: { kind: 'function', expression: columnDefault },
        contract: { kind: 'function', expression: row.written },
      });
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
