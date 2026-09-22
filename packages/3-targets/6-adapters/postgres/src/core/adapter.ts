import { APP_SPACE_ID } from '@internal/framework-components/control';
import type {
  Adapter,
  AdapterProfile,
  AnyQueryAst,
  LowererContext,
  RawSqlLiteral,
  SqlQueryable,
} from '@internal/sql-relational-core/ast';
import { isDdlNode } from '@internal/sql-relational-core/ast';
import type { RawCodecInferer } from '@internal/sql-relational-core/expression';
import type { PostgresDdlNode } from '@internal/target-postgres/ddl';
import { adapterError } from './adapter-errors';
import { createPostgresCodecRegistryWithBuiltins } from './codec-lookup';
import { PostgresControlAdapter } from './control-adapter';
import { renderLoweredSql } from './sql-renderer';
import type {
  PostgresAdapterOptions,
  PostgresCodecRegistry,
  PostgresContract,
  PostgresLoweredStatement,
} from './types';

const defaultCapabilities = Object.freeze({
  postgres: {
    orderBy: true,
    limit: true,
    lateral: true,
    jsonAgg: true,
    returning: true,
    distinctOn: true,
  },
  sql: {
    enums: true,
    returning: true,
    defaultInInsert: true,
    lateral: true,
    scalarList: true,
    checkConstraint: true,
    insertOnConflictSkip: true,
    insertOnConflictWithoutTarget: true,
  },
});

class PostgresAdapterImpl
  implements Adapter<AnyQueryAst, PostgresContract, PostgresLoweredStatement>
{
  // These fields make the adapter instance structurally compatible with RuntimeAdapterInstance<'sql', 'postgres'> without introducing a runtime-plane dependency.
  readonly familyId = 'sql' as const;
  readonly targetId = 'postgres' as const;

  readonly profile: AdapterProfile<'postgres'>;
  private readonly codecRegistry: PostgresCodecRegistry;

  constructor(codecRegistry: PostgresCodecRegistry, profileId?: string) {
    this.codecRegistry = codecRegistry;
    const controlAdapter = new PostgresControlAdapter(codecRegistry);
    this.profile = Object.freeze({
      id: profileId ?? 'postgres/default@1',
      target: 'postgres',
      capabilities: defaultCapabilities,
      readMarker: (queryable: SqlQueryable) =>
        controlAdapter.readMarkerDiscriminated(
          {
            familyId: 'sql',
            targetId: 'postgres',
            query: async <Row = Record<string, unknown>>(
              sql: string,
              params?: readonly unknown[],
            ) => {
              const rows: Row[] = [];
              for await (const row of queryable.query<Row>({
                sql,
                ...(params === undefined ? {} : { params }),
              })) {
                rows.push(row);
              }
              return { rows };
            },
            close: async () => {},
          },
          APP_SPACE_ID,
        ),
    });
  }

  lower(
    ast: AnyQueryAst | PostgresDdlNode,
    context: LowererContext<PostgresContract>,
  ): PostgresLoweredStatement {
    if (isDdlNode(ast)) {
      throw adapterError(
        'RUNTIME.DDL_UNSUPPORTED',
        'lower() does not lower DDL on the runtime adapter — DDL lowering is a control-plane concern handled by the control adapter.',
        { meta: { surface: 'runtime-adapter' } },
      );
    }
    return renderLoweredSql(ast, context.contract, this.codecRegistry);
  }
}

const INT4_MIN = -2_147_483_648;
const INT4_MAX = 2_147_483_647;

/**
 * The codec a bare JS number is bound through.
 *
 * An integer picks the narrowest column type that holds it: `int4` while it
 * fits the signed 32-bit range, `int8` (number-valued) up to the safe-integer
 * limit. Past that limit a JS number is no longer an exact integer, so it
 * binds as `float8` rather than pretending to a precision it does not have.
 */
function inferNumberCodecId(value: number): string {
  if (!Number.isSafeInteger(value)) return 'pg/float8@1';
  return value >= INT4_MIN && value <= INT4_MAX ? 'pg/int4@1' : 'pg/int8number@1';
}

/**
 * Codec-id lookup for bare-literal interpolations used by `fns.raw` on a postgres client. Contributed as the descriptor's static `rawCodecInferer` slot.
 *
 * The ids are versioned because that is how the codec registry keys them: lowering resolves an interpolated value's codec by exact id through `descriptorFor`.
 */
export const postgresRawCodecInferer: RawCodecInferer = {
  inferCodec(value: RawSqlLiteral): string {
    switch (typeof value) {
      case 'number':
        return inferNumberCodecId(value);
      case 'bigint':
        return 'pg/int8@1';
      case 'string':
        return 'pg/text@1';
      case 'boolean':
        return 'pg/bool@1';
      case 'object':
        if (value instanceof Uint8Array) return 'pg/bytea@1';
    }
    throw adapterError(
      'RUNTIME.RAW_SQL_UNSUPPORTED_INTERPOLATION',
      'unsupported JS value type for raw-SQL interpolation: wrap this value in `param(...)` with an explicit codec',
      { meta: { valueType: typeof value } },
    );
  },
};

export function createPostgresAdapter(options?: PostgresAdapterOptions) {
  const codecRegistry = createPostgresCodecRegistryWithBuiltins(options?.codecDescriptors);
  return Object.freeze(new PostgresAdapterImpl(codecRegistry, options?.profileId));
}

export function createPostgresAdapterWithCodecRegistry(codecRegistry: PostgresCodecRegistry) {
  return Object.freeze(new PostgresAdapterImpl(codecRegistry));
}
