import {
  dataTypeParams,
  renderSqlTypeName,
  type SqlDataType,
  sqlBaseName,
} from '@internal/sql-contract/data-type';
import {
  pgBytea,
  pgDate,
  pgJson,
  pgJsonb,
  pgTime,
  pgTimestamp,
  pgTimestamptz,
  pgTimetz,
} from './data-types';
import { postgresTargetDescriptorMeta } from './descriptor-meta';
import { postgresNowGeneratorIdFor } from './now-generators';
import { postgresCreateNamespace } from './postgres-schema';
import { storedTemporalText } from './prisma7-temporal-defaults';
import { prisma7PostgresTypeMap } from './prisma7-type-map';
import { junctionRelationFieldNames } from './psl-infer/junction-relation-field-names';

const TEMPORAL_TYPES: ReadonlyMap<string, SqlDataType> = new Map(
  [pgTimestamp, pgTimestamptz, pgDate, pgTime, pgTimetz].map((type) => [type.id, type]),
);

const BYTEA_LIST_TYPE = sqlBaseName(pgBytea, {}).toUpperCase();

function sqlStringLiteral(value: string | undefined): string | undefined {
  return value === undefined ? undefined : `'${value.replace(/'/g, "''")}'`;
}

function base64ToHex(base64: string): string | undefined {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 !== 0) return undefined;
  return `\\x${Buffer.from(base64, 'base64').toString('hex')}`;
}

function arrayLiteral(literals: readonly string[], typeName: string): string {
  return `ARRAY[${literals.join(', ')}]::${typeName}[]`;
}

/**
 * What the Postgres target supplies to the Prisma 7 interpreter. A `Bytes` or
 * `DateTime` default is carried as the SQL literal of the default Postgres
 * stores (`'\x68656c6c6f'`, `'2024-01-02 03:04:05'`), and a list default as an
 * `ARRAY[...]` of those literals cast to the column type, rather than through
 * the column codec, whose JSON form (base64, ISO 8601 text) is not what
 * introspection reads back; verify parses both sides with the same parser.
 */
export const prisma7PostgresBinding = {
  target: postgresTargetDescriptorMeta,
  createNamespace: postgresCreateNamespace,
  providers: ['postgresql', 'postgres'],
  typeMap: prisma7PostgresTypeMap,
  nativeEnum: { entityKind: 'native_enum', typeConstructor: ['pg', 'enum'] },
  indexTypes: {
    BTree: 'btree',
    Hash: 'hash',
    Gin: 'gin',
    Gist: 'gist',
    SpGist: 'spgist',
    Brin: 'brin',
  },
  /** `NAMEDATALEN - 1`. */
  identifierMaxBytes: 63,
  junctionRelationFieldNames,
  updatedAtGeneratorId: postgresNowGeneratorIdFor,
  literalDefaultForm: ({
    dataType,
    typeParams,
  }: {
    readonly dataType: string;
    readonly typeParams?: Readonly<Record<string, unknown>> | undefined;
  }) => {
    if (dataType === pgJson.id || dataType === pgJsonb.id) return { kind: 'json' } as const;
    if (dataType === pgBytea.id) {
      return {
        kind: 'sqlExpression',
        literal: (text: string) => sqlStringLiteral(base64ToHex(text)),
        list: (literals: readonly string[]) => arrayLiteral(literals, BYTEA_LIST_TYPE),
      } as const;
    }
    const type = TEMPORAL_TYPES.get(dataType);
    if (type === undefined) return undefined;
    const typeName = renderSqlTypeName(type, dataTypeParams(type, typeParams)).toUpperCase();
    return {
      kind: 'sqlExpression',
      literal: (text: string) => sqlStringLiteral(storedTemporalText(text, type.id)),
      list: (literals: readonly string[]) => arrayLiteral(literals, typeName),
    } as const;
  },
} as const;
