import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import type { MigrationPlanOperation, OpFactoryCall } from '@internal/framework-components/control';
import { blindCast } from '@internal/utils/casts';
import { InternalError } from '@internal/utils/internal-error';
import { isThenable } from '@internal/utils/promise';
import { isMysqlOpFactoryCall, MYSQL_TARGET_ID } from './op-factory-call';
import type { Op } from './operations';

function assertTargetOp(
  op: MigrationPlanOperation,
  factoryName: string,
  expectedTargetId: string,
): asserts op is Op {
  const targetId = blindCast<
    { target?: { id?: string } },
    'op.target is present on a SqlMigrationPlanOperation but absent on the framework MigrationPlanOperation base'
  >(op).target?.id;
  if (targetId !== expectedTargetId) {
    throw new InternalError(
      `renderOps: expected a ${expectedTargetId} operation but got target.id="${String(targetId)}" for op.id="${op.id}" (factoryName="${factoryName}").`,
    );
  }
}

function checkedOp(
  opOrPromise: MigrationPlanOperation | Promise<MigrationPlanOperation>,
  factoryName: string,
  targetId: string,
): Op | Promise<Op> {
  if (isThenable(opOrPromise)) {
    const checked = opOrPromise.then((op) => {
      assertTargetOp(op, factoryName, targetId);
      return op;
    });
    checked.catch(() => undefined);
    return checked;
  }
  assertTargetOp(opOrPromise, factoryName, targetId);
  return opOrPromise;
}

/** The operations `calls` lower to, in order, each checked to be an operation of the target `targetId` names. */
export function renderOps(
  calls: readonly OpFactoryCall[],
  lowerer?: ExecuteRequestLowerer,
  targetId: string = MYSQL_TARGET_ID,
): (Op | Promise<Op>)[] {
  return calls.map((call) =>
    checkedOp(
      isMysqlOpFactoryCall(call)
        ? call.toOp(lowerer, targetId)
        : blindCast<
            {
              toOp(
                lowerer?: ExecuteRequestLowerer,
              ): MigrationPlanOperation | Promise<MigrationPlanOperation>;
            },
            'a codec or extension call on the MySQL planner path takes the optional lowerer the framework OpFactoryCall leaves out'
          >(call).toOp(lowerer),
      call.factoryName,
      targetId,
    ),
  );
}
