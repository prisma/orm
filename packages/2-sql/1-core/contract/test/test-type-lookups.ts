/**
 * Codec and data type lookups for SQL unit tests that build contracts without a real stack.
 *
 * Every codec id represents the data type the real stack gives it (`CODEC_DATA_TYPES`), else the
 * codec id without its version. A data type is written as the name in `names` (by codec id),
 * `CODEC_TYPE_NAMES` or `DATA_TYPE_NAMES`, else its name part. Each codec stores its values as
 * authored and takes any parameters.
 */

import type { JsonValue } from '@internal/contract/types';
import type {
  AnyCodecDescriptor,
  Codec,
  CodecLookup,
  CodecLookupWithDescriptors,
  DataType,
  DataTypeLookup,
} from '@internal/framework-components/codec';
import { blindCast } from '@internal/utils/casts';
import { type } from 'arktype';
import { sqlDataType } from '../src/sql-data-type';

const CODEC_TYPE_NAMES: Readonly<Record<string, string>> = {
  'pg/timestamptz-temporal@1': 'timestamptz',
  'pg/timestamptz-date@1': 'timestamptz',
  'pg/timestamptz-string@1': 'timestamptz',
  'pg/timestamp-temporal@1': 'timestamp',
  'pg/timestamp-string@1': 'timestamp',
  'pg/date-temporal@1': 'date',
  'pg/date-string@1': 'date',
  'pg/time-temporal@1': 'time',
  'pg/time-string@1': 'time',
  'pg/int8number@1': 'int8',
  'pg/unboundedint@1': 'numeric',
  'sql/char@1': 'character',
  'sql/varchar@1': 'character varying',
  'sql/int@1': 'int4',
  'sql/float@1': 'float8',
};

const CODEC_DATA_TYPES: Readonly<Record<string, string>> = {
  'pg/timestamptz-temporal@1': 'pg/timestamptz',
  'pg/timestamptz-date@1': 'pg/timestamptz',
  'pg/timestamptz-string@1': 'pg/timestamptz',
  'pg/timestamp-temporal@1': 'pg/timestamp',
  'pg/timestamp-string@1': 'pg/timestamp',
  'pg/date-temporal@1': 'pg/date',
  'pg/date-string@1': 'pg/date',
  'pg/time-temporal@1': 'pg/time',
  'pg/time-string@1': 'pg/time',
  'pg/int@1': 'pg/int4',
  'pg/float@1': 'pg/float8',
  'pg/int8number@1': 'pg/int8',
  'pg/unboundedint@1': 'pg/numeric',
  'pg/vector@1': 'pgvector/vector',
  'pg/geometry@1': 'postgis/geometry',
  'arktype/json@1': 'pg/jsonb',
  'sql/char@1': 'pg/char',
  'sql/varchar@1': 'pg/varchar',
  'sql/int@1': 'pg/int4',
  'sql/float@1': 'pg/float8',
  'sql/text@1': 'pg/text',
  'sqlite/bigint@1': 'sqlite/integer',
  'sqlite/bigintnumber@1': 'sqlite/integer',
  'sqlite/datetime@1': 'sqlite/text',
  'sqlite/json@1': 'sqlite/text',
};

const DATA_TYPE_NAMES: Readonly<Record<string, string>> = {
  'pg/char': 'character',
  'pg/varchar': 'character varying',
  'pg/varbit': 'bit varying',
  'pgvector/vector': 'vector',
  'postgis/geometry': 'geometry',
  'sqlite/character': 'character',
  'sqlite/character-varying': 'character varying',
};

const ENUM_CODEC_IDS: ReadonlySet<string> = new Set(['pg/enum@1']);
const ENUM_DATA_TYPE_IDS: ReadonlySet<string> = new Set(['pg/enum']);

function dataTypeIdOf(codecId: string): string {
  return CODEC_DATA_TYPES[codecId] ?? codecId.replace(/@[^@]*$/, '');
}

function nameOfDataType(id: string): string {
  return DATA_TYPE_NAMES[id] ?? id.split('/')[1] ?? id;
}

function writtenName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_ (),.]/g, '_');
}

function testDataType(id: string, name: string | undefined): DataType {
  if (name === undefined) {
    return sqlDataType(id, {
      params: type({ typeName: 'string > 0' }),
      claimsKind: 'enum',
      render: ({ typeName }) => typeName,
    });
  }
  return sqlDataType(id, { texts: [{ text: writtenName(name), written: true }] });
}

const acceptAnything: AnyCodecDescriptor['paramsSchema'] = {
  '~standard': {
    version: 1,
    vendor: 'sql-contract-test',
    validate: (value: unknown) => ({ value }),
  },
};

function storesAsAuthored(codecId: string): Codec {
  return blindCast<Codec, 'a test codec needs only the conversions a contract build calls'>({
    id: codecId,
    encode: async (value: unknown) => value,
    decode: async (wire: unknown) => wire,
    encodeJson: (value: unknown) =>
      blindCast<JsonValue, 'a test codec stores what it is given'>(value),
    decodeJson: (json: JsonValue) => json,
  });
}

/** A test's own codecs: a codec lookup, with descriptors where the test has them. */
export type TestCodecs = CodecLookup & Partial<Pick<CodecLookupWithDescriptors, 'descriptorFor'>>;

export interface TestSqlTypeLookups {
  readonly codecLookup: CodecLookupWithDescriptors;
  readonly dataTypeLookup: DataTypeLookup;
}

/** Shared by every set of test lookups, so any of them reads a type another one declared. */
const sharedDataTypes = new Map<string, DataType>();

function sharedDataType(id: string): DataType {
  const existing = sharedDataTypes.get(id);
  if (existing !== undefined) return existing;
  const created = testDataType(id, ENUM_DATA_TYPE_IDS.has(id) ? undefined : nameOfDataType(id));
  sharedDataTypes.set(id, created);
  return created;
}

/**
 * Test lookups. `names` maps a codec id to the type name its data type is written as. `codecs`, when
 * given, supplies the codecs themselves: its descriptors are used where it has them, and every other
 * codec id still names a test data type, with the codec `codecs.get` returns, or none.
 */
export function testSqlTypeLookups(
  names: Readonly<Record<string, string>> = {},
  codecs?: TestCodecs,
): TestSqlTypeLookups {
  const ownDataTypes = new Map<string, DataType>();
  const codecOf = (codecId: string): Codec | undefined =>
    codecs === undefined ? storesAsAuthored(codecId) : codecs.get(codecId);

  const dataTypeOfCodec = (codecId: string): DataType => {
    const id = dataTypeIdOf(codecId);
    const name = names[codecId] ?? CODEC_TYPE_NAMES[codecId];
    if (name === undefined || ENUM_CODEC_IDS.has(codecId)) return lookupDataType(id);
    const existing = ownDataTypes.get(id);
    if (existing !== undefined) return existing;
    const created = testDataType(id, name);
    ownDataTypes.set(id, created);
    return created;
  };

  const lookupDataType = (id: string): DataType => ownDataTypes.get(id) ?? sharedDataType(id);

  const descriptorFor = (codecId: string): AnyCodecDescriptor => {
    const own = codecs?.descriptorFor?.(codecId);
    if (own !== undefined) {
      if (own.dataType !== undefined) return own;
      return { ...own, dataType: dataTypeOfCodec(codecId).id };
    }
    return {
      codecId,
      dataType: dataTypeOfCodec(codecId).id,
      traits: [],
      paramsSchema: acceptAnything,
      isParameterized: true,
      factory: () => () =>
        blindCast<
          Codec,
          'a test codec lookup may have no codec for this id, as a real one may not'
        >(codecOf(codecId)),
    };
  };

  return {
    codecLookup: {
      renderOutputTypeFor: () => undefined,
      ...codecs,
      get: codecOf,
      descriptorFor,
    },
    dataTypeLookup: {
      get: lookupDataType,
      has: () => true,
      all: () => [
        ...ownDataTypes.values(),
        ...[...sharedDataTypes.values()].filter((type) => !ownDataTypes.has(type.id)),
      ],
    },
  };
}

/** Lookups for tests that do not care which type names their columns are written with. */
export const testTypeLookups: TestSqlTypeLookups = testSqlTypeLookups();

/** The lookup arguments of `buildSqlContractFromDefinition`, around a test's own codecs. */
export function withTestTypes(
  codecs?: TestCodecs,
  names: Readonly<Record<string, string>> = {},
): readonly [CodecLookupWithDescriptors, DataTypeLookup] {
  const lookups = testSqlTypeLookups(names, codecs);
  return [lookups.codecLookup, lookups.dataTypeLookup];
}
