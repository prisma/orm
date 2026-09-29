import type { ColumnDefault, JsonValue } from '@internal/contract/types';
import { type Codec, materializeCodec } from '@internal/framework-components/codec';
import { timeouts, withClient, withDevDatabase } from '@repo/test-utils';
import { beforeAll, describe, expect, it } from 'vitest';
import { PG_TEXT_CODEC_ID } from '../src/core/codec-ids';
import { parsePostgresDefault, postgresResolveDefault } from '../src/core/default-normalizer';
import { parsePostgresListText } from '../src/core/list-decoder';
import { normalizeSchemaNativeType } from '../src/core/native-type-normalizer';
import { createPostgresTypeMap } from '../src/core/psl-build/postgres-type-map';
import { CODEC_ID_BY_INFERRED_TYPE } from '../src/core/psl-infer/infer-default-codec';
import { postgresCodecDescriptorRegistry } from '../src/core/registry';
import { enumTypes, type FidelityRow, rows } from './default-fidelity.rows';

interface Observation {
  readonly columnDefault: string;
  readonly nativeType: string;
  readonly live: ColumnDefault | undefined;
  readonly contract: ColumnDefault;
  readonly stored: string | null;
}

interface CatalogColumn {
  readonly column_name: string;
  readonly column_default: string;
  readonly data_type: string;
  readonly udt_name: string;
  readonly formatted_type: string;
}

/** Copy of `normalizeFormattedType` in `adapter-postgres/src/core/control-adapter.ts`, which this package cannot import. */
function normalizeFormattedType(formattedType: string, dataType: string, udtName: string): string {
  if (formattedType.endsWith('[]')) {
    return `${normalizeFormattedType(formattedType.slice(0, -2), dataType, udtName)}[]`;
  }
  if (formattedType === 'integer') return 'int4';
  if (formattedType === 'smallint') return 'int2';
  if (formattedType === 'bigint') return 'int8';
  if (formattedType === 'real') return 'float4';
  if (formattedType === 'double precision') return 'float8';
  if (formattedType === 'boolean') return 'bool';
  if (formattedType.startsWith('varchar')) {
    return formattedType.replace('varchar', 'character varying');
  }
  if (formattedType.startsWith('bpchar')) return formattedType.replace('bpchar', 'character');
  if (formattedType.startsWith('varbit')) return formattedType.replace('varbit', 'bit varying');
  if (dataType === 'timestamp with time zone' || udtName === 'timestamptz') {
    return formattedType.replace('timestamp', 'timestamptz').replace(' with time zone', '').trim();
  }
  if (dataType === 'timestamp without time zone' || udtName === 'timestamp') {
    return formattedType.replace(' without time zone', '').trim();
  }
  if (dataType === 'time with time zone' || udtName === 'timetz') {
    return formattedType.replace('time', 'timetz').replace(' with time zone', '').trim();
  }
  if (dataType === 'time without time zone' || udtName === 'time') {
    return formattedType.replace(' without time zone', '').trim();
  }
  return splitQualifiedName(formattedType).map(unquoteIdentifier).join('.');
}

function splitQualifiedName(name: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quoted = false;
  for (const char of name) {
    if (char === '"') quoted = !quoted;
    if (char === '.' && !quoted) {
      segments.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  segments.push(current);
  return segments;
}

function unquoteIdentifier(segment: string): string {
  return segment.length >= 2 && segment.startsWith('"') && segment.endsWith('"')
    ? segment.slice(1, -1).replaceAll('""', '"')
    : segment;
}

/** The `resolvedNativeType` the adapter's introspection hands to `parsePostgresDefault`. */
function resolvedNativeType(column: CatalogColumn): string {
  const formatted = normalizeFormattedType(
    column.formatted_type,
    column.data_type,
    column.udt_name,
  );
  const many = formatted.endsWith('[]');
  const nativeType = many ? normalizeSchemaNativeType(formatted.slice(0, -2)) : formatted;
  return `${normalizeSchemaNativeType(nativeType)}${many ? '[]' : ''}`;
}

const enumNames: ReadonlySet<string> = new Set(enumTypes.map((enumType) => enumType.name));
const typeMap = createPostgresTypeMap(enumNames);

/** The codec `contract infer` binds to the column, as `inferredDefaultReadsBack` chooses it. */
function columnCodec(nativeType: string): Codec {
  const elementType = nativeType.endsWith('[]') ? nativeType.slice(0, -2) : nativeType;
  const resolution = typeMap.resolve(elementType, undefined);
  if ('unsupported' in resolution) throw new Error(`no PSL type for ${elementType}`);
  const codecId = enumNames.has(elementType)
    ? PG_TEXT_CODEC_ID
    : CODEC_ID_BY_INFERRED_TYPE.get(resolution.pslType.name);
  const descriptor =
    codecId === undefined ? undefined : postgresCodecDescriptorRegistry.descriptorFor(codecId);
  if (codecId === undefined || descriptor === undefined) {
    throw new Error(`no codec for ${elementType}`);
  }
  return materializeCodec(descriptor, { codecId }, { name: `<fidelity:${codecId}>` });
}

/*
 * Both sides are compared as the column codec's JSON form. The stored value is read as the text
 * Postgres prints, split into elements by `postgres-array` (not the parser under test), decoded
 * like a query result, and encoded to JSON. The parsed literal goes through `decodeJson` and back,
 * so two spellings of one value agree while a codec that refuses the literal fails the row.
 */
async function storedAsJson(stored: string | null, nativeType: string): Promise<JsonValue> {
  if (stored === null) return null;
  const codec = columnCodec(nativeType);
  if (!nativeType.endsWith('[]')) return codec.encodeJson(await codec.decode(stored, {}));
  const elements: JsonValue[] = [];
  for (const element of parsePostgresListText(stored)) {
    elements.push(element === null ? null : codec.encodeJson(await codec.decode(element, {})));
  }
  return elements;
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
        `SELECT c.column_name, c.column_default, c.data_type, c.udt_name,
                format_type(a.atttypid, a.atttypmod) AS formatted_type
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
      const storedRow = stored.rows[0] ?? {};
      const byName = new Map(catalog.rows.map((column) => [column.column_name, column]));
      return new Map(
        rows.map((row): [string, Observation] => {
          const column = byName.get(row.name);
          if (column === undefined) throw new Error(`column ${row.name} missing from catalog`);
          const nativeType = resolvedNativeType(column);
          return [
            row.name,
            {
              columnDefault: column.column_default,
              nativeType,
              live: parsePostgresDefault(column.column_default, nativeType),
              contract: postgresResolveDefault(
                { kind: 'function', expression: row.written },
                nativeType,
              ),
              stored: storedRow[row.name] ?? null,
            },
          ];
        }),
      );
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

  async function check(row: FidelityRow): Promise<void> {
    const { columnDefault, nativeType, live, contract, stored } = observation(row);
    if (row.expect === 'raw') {
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
    expect(contract).toEqual(live);
    if (live?.kind !== 'literal' || live.value instanceof Date) {
      throw new Error(`${columnDefault} did not parse to a JSON literal`);
    }
    expect(literalAsJson(live.value, nativeType)).toEqual(await storedAsJson(stored, nativeType));
  }

  const agreeing = rows.filter((row) => row.knownBug === undefined);
  const disagreeing = rows.filter((row) => row.knownBug !== undefined);

  it.each(agreeing.map((row) => [row.name, row] as const))('%s', async (_name, row) => {
    await check(row);
  });

  if (disagreeing.length > 0) {
    it.fails.each(disagreeing.map((row) => [`${row.name}: ${row.knownBug}`, row] as const))(
      '%s',
      async (_name, row) => {
        await check(row);
      },
    );
  }
});
