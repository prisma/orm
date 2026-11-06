import { APP_SPACE_ID } from '@internal/framework-components/control';
import {
  type Adapter,
  type AdapterProfile,
  type AnyQueryAst,
  isDdlNode,
  type LoweredStatement,
  type LowererContext,
  type SqlQueryable,
} from '@internal/sql-relational-core/ast';
import type { MysqlCodecRegistry } from '@internal/target-mysql/codecs';
import { structuredError } from '@internal/utils/structured-error';
import { mysqlAdapterCapabilities } from '../capabilities';
import { type MarkerQuery, readMarkerResult } from '../marker-read';
import { type MysqlContract, renderMysqlSql } from '../sql-renderer';

function markerQuery(queryable: SqlQueryable): MarkerQuery {
  return {
    async query<Row = Record<string, unknown>>(sql: string, params?: readonly unknown[]) {
      const rows: Row[] = [];
      for await (const row of queryable.query<Row>({
        sql,
        ...(params ? { params } : {}),
      })) {
        rows.push(row);
      }
      return { rows };
    },
  };
}

class MysqlAdapterImpl implements Adapter<AnyQueryAst, MysqlContract, LoweredStatement> {
  readonly familyId = 'sql' as const;
  readonly targetId = 'mysql' as const;
  readonly profile: AdapterProfile<'mysql'>;
  readonly #codecs: MysqlCodecRegistry;

  constructor(codecs: MysqlCodecRegistry) {
    this.#codecs = codecs;
    this.profile = Object.freeze({
      id: 'mysql/default@1',
      target: 'mysql',
      capabilities: mysqlAdapterCapabilities,
      readMarker: (queryable: SqlQueryable) =>
        readMarkerResult(markerQuery(queryable), APP_SPACE_ID),
    });
  }

  lower(ast: AnyQueryAst, context: LowererContext<MysqlContract>): LoweredStatement {
    if (isDdlNode(ast)) {
      throw structuredError(
        'RUNTIME.DDL_UNSUPPORTED',
        'lower() does not lower DDL on the runtime adapter: DDL lowering belongs to the control adapter.',
        { meta: { surface: 'runtime-adapter' } },
      );
    }
    return renderMysqlSql(ast, context.contract, this.#codecs);
  }
}

/** The MySQL runtime adapter: it lowers queries with the MySQL renderer and reads the marker 2b's control tables hold. */
export function createMysqlAdapter(codecs: MysqlCodecRegistry) {
  return Object.freeze(new MysqlAdapterImpl(codecs));
}
