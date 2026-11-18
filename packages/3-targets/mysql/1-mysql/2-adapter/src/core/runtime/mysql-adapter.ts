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
import { structuredError } from '@internal/utils/structured-error';
import { type MarkerQuery, readMarkerResult } from '../marker-read';
import type { MysqlContract, MysqlSqlRenderer } from '../sql-renderer';

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

/** What a target that extends MySQL changes in the runtime adapter: its target id, its capabilities, and the renderer that writes its SQL. The profile id is `<targetId>/default@1`. */
export interface MysqlAdapterOptions<TargetId extends string> {
  readonly targetId: TargetId;
  readonly capabilities: AdapterProfile<TargetId>['capabilities'];
  readonly renderer: MysqlSqlRenderer;
}

class MysqlAdapterImpl<TargetId extends string>
  implements Adapter<AnyQueryAst, MysqlContract, LoweredStatement>
{
  readonly familyId = 'sql' as const;
  readonly targetId: TargetId;
  readonly profile: AdapterProfile<TargetId>;
  readonly #renderer: MysqlSqlRenderer;

  constructor(options: MysqlAdapterOptions<TargetId>) {
    this.targetId = options.targetId;
    this.#renderer = options.renderer;
    this.profile = Object.freeze({
      id: `${options.targetId}/default@1`,
      target: options.targetId,
      capabilities: options.capabilities,
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
    return this.#renderer.render(ast, context.contract);
  }
}

/** The runtime adapter of MySQL, or of a target that extends it: it lowers queries with the renderer it is given and reads the marker the control tables hold. */
export function createMysqlAdapter<TargetId extends string>(
  options: MysqlAdapterOptions<TargetId>,
) {
  return Object.freeze(new MysqlAdapterImpl(options));
}
