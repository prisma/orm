import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import type { MigrationPlanOperation, OpFactoryCall } from '@internal/framework-components/control';
import { blindCast } from '@internal/utils/casts';
import { InternalError } from '@internal/utils/internal-error';
import { isThenable } from '@internal/utils/promise';
import { isMysqlOpFactoryCall } from './op-factory-call';
import type { Op } from './operations';

function assertMysqlOp(op: MigrationPlanOperation, factoryName: string): asserts op is Op {
  const targetId = blindCast<
    { target?: { id?: string } },
    'op.target is present on a SqlMigrationPlanOperation but absent on the framework MigrationPlanOperation base'
  >(op).target?.id;
  if (targetId !== 'mysql') {
    throw new InternalError(
      `renderOps: expected a mysql operation but got target.id="${String(targetId)}" for op.id="${op.id}" (factoryName="${factoryName}").`,
    );
  }
}

function checkedOp(
  opOrPromise: MigrationPlanOperation | Promise<MigrationPlanOperation>,
  factoryName: string,
): Op | Promise<Op> {
  if (isThenable(opOrPromise)) {
    const checked = opOrPromise.then((op) => {
      assertMysqlOp(op, factoryName);
      return op;
    });
    checked.catch(() => undefined);
    return checked;
  }
  assertMysqlOp(opOrPromise, factoryName);
  return opOrPromise;
}

/** The operations `calls` lower to, in order, each checked to be a MySQL operation. */
export function renderOps(
  calls: readonly OpFactoryCall[],
  lowerer?: ExecuteRequestLowerer,
): (Op | Promise<Op>)[] {
  return calls.map((call) =>
    checkedOp(
      isMysqlOpFactoryCall(call)
        ? call.toOp(lowerer)
        : blindCast<
            {
              toOp(
                lowerer?: ExecuteRequestLowerer,
              ): MigrationPlanOperation | Promise<MigrationPlanOperation>;
            },
            'a codec or extension call on the MySQL planner path takes the optional lowerer the framework OpFactoryCall leaves out'
          >(call).toOp(lowerer),
      call.factoryName,
    ),
  );
}
