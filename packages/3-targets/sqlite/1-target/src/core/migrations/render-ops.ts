import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import type { MigrationPlanOperation, OpFactoryCall } from '@internal/framework-components/control';
import { blindCast } from '@internal/utils/casts';
import { isThenable } from '@internal/utils/promise';
import { sqliteError } from '../errors';
import { isSqliteOpFactoryCall } from './op-factory-call';
import type { SqlitePlanTargetDetails } from './planner-target-details';

type Op = SqlMigrationPlanOperation<SqlitePlanTargetDetails>;

function assertSqliteOp(op: MigrationPlanOperation, callFactoryName: string): asserts op is Op {
  const targetId = blindCast<
    { target?: { id?: string } },
    'op.target is present on concrete SqlMigrationPlanOperation but absent on the framework MigrationPlanOperation base'
  >(op).target?.id;
  if (targetId !== 'sqlite') {
    throw sqliteError(
      'MIGRATION.TARGET_MISMATCH',
      `renderOps: expected sqlite op but got target.id="${String(targetId)}" for op.id="${op.id}" (factoryName="${callFactoryName}"). An OpFactoryCall produced an op for a different target on the sqlite planner path; check the call's target binding.`,
      { meta: { opId: op.id, targetId: String(targetId), factoryName: callFactoryName } },
    );
  }
}

function checkedOp(
  opOrPromise: MigrationPlanOperation | Promise<MigrationPlanOperation>,
  callFactoryName: string,
): Op | Promise<Op> {
  if (isThenable(opOrPromise)) {
    const checked = opOrPromise.then((op) => {
      assertSqliteOp(op, callFactoryName);
      return op;
    });
    // A reader may take a plan's operations without awaiting each one, as with a placeholder's.
    checked.catch(() => undefined);
    return checked;
  }
  assertSqliteOp(opOrPromise, callFactoryName);
  return opOrPromise;
}

export function renderOps(
  calls: readonly OpFactoryCall[],
  lowerer?: ExecuteRequestLowerer,
): (Op | Promise<Op>)[] {
  return calls.flatMap((c) => {
    const lowered = isSqliteOpFactoryCall(c)
      ? c.toOps(lowerer)
      : [
          blindCast<
            { toOp(lowerer?: ExecuteRequestLowerer): Op | Promise<Op> },
            'SQLite OpFactoryCall.toOp accepts an optional ExecuteRequestLowerer; the framework interface omits it because not all targets need a lowerer — the SQLite target overrides with this extended signature'
          >(c).toOp(lowerer),
        ];
    return lowered.map((opOrPromise) => checkedOp(opOrPromise, c.factoryName));
  });
}
