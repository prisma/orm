import { postgresTargetDescriptorMeta } from './descriptor-meta';
import { postgresNowGeneratorIdFor } from './now-generators';
import { postgresCreateNamespace } from './postgres-schema';
import { storedTemporalText, type TemporalNativeType } from './prisma7-temporal-defaults';
import { prisma7PostgresTypeMap } from './prisma7-type-map';
import { junctionRelationFieldNames } from './psl-infer/junction-relation-field-names';

const TEMPORAL_NATIVE_TYPES: ReadonlySet<string> = new Set<TemporalNativeType>([
  'timestamp',
  'timestamptz',
  'date',
  'time',
  'timetz',
]);

function isTemporalNativeType(nativeType: string): nativeType is TemporalNativeType {
  return TEMPORAL_NATIVE_TYPES.has(nativeType);
}

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
 * the column codec, whose JSON form (base64, a Temporal value) is not what
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
    nativeType,
    typeParams,
  }: {
    readonly nativeType: string;
    readonly typeParams?: Readonly<Record<string, unknown>> | undefined;
  }) => {
    if (nativeType === 'json' || nativeType === 'jsonb') return { kind: 'json' } as const;
    if (nativeType === 'bytea') {
      return {
        kind: 'sqlExpression',
        literal: (text: string) => sqlStringLiteral(base64ToHex(text)),
        list: (literals: readonly string[]) => arrayLiteral(literals, 'BYTEA'),
      } as const;
    }
    if (!isTemporalNativeType(nativeType)) return undefined;
    const precision = typeParams?.['precision'];
    const typeName = `${nativeType.toUpperCase()}${typeof precision === 'number' ? `(${precision})` : ''}`;
    return {
      kind: 'sqlExpression',
      literal: (text: string) => sqlStringLiteral(storedTemporalText(text, nativeType)),
      list: (literals: readonly string[]) => arrayLiteral(literals, typeName),
    } as const;
  },
} as const;
