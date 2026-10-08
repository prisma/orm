import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import type { MigrationPlanOperation, OpFactoryCall } from '@internal/framework-components/control';
import { blindCast } from '@internal/utils/casts';
import { isThenable } from '@internal/utils/promise';
import { postgresError } from '../errors';
import { isPostgresOpFactoryCall } from './op-factory-call';
import type { PostgresPlanTargetDetails } from './planner-target-details';

type Op = SqlMigrationPlanOperation<PostgresPlanTargetDetails>;

/**
 * Asserts an op materialised by an `OpFactoryCall` targets postgres. The
 * extension surface lets any contributor emit calls, so this is the
 * integration boundary where a stray non-postgres op would otherwise
 * silently flow through to postgres-shaped renderers — exactly the
 * place to fail loudly with op metadata (`id` + `target.id`).
 */
function assertPostgresOp(op: MigrationPlanOperation, callFactoryName: string): asserts op is Op {
  const targetId = blindCast<
    { target?: { id?: string } },
    'op.target is present on concrete SqlMigrationPlanOperation but absent on the framework MigrationPlanOperation base'
  >(op).target?.id;
  if (targetId !== 'postgres') {
    throw postgresError(
      'MIGRATION.TARGET_MISMATCH',
      `renderOps: expected postgres op but got target.id="${String(targetId)}" for op.id="${op.id}" (factoryName="${callFactoryName}"). An OpFactoryCall produced an op for a different target on the postgres planner path; check the call's target binding.`,
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
      assertPostgresOp(op, callFactoryName);
      return op;
    });
    // A reader may take a plan's operations without awaiting each one, as with a placeholder's.
    checked.catch(() => undefined);
    return checked;
  }
  assertPostgresOp(opOrPromise, callFactoryName);
  return opOrPromise;
}

export function renderOps(
  calls: readonly OpFactoryCall[],
  lowerer?: ExecuteRequestLowerer,
): (Op | Promise<Op>)[] {
  return calls.flatMap((c) => {
    const lowered = isPostgresOpFactoryCall(c)
      ? c.toOps(lowerer)
      : [
          blindCast<
            { toOp(lowerer?: ExecuteRequestLowerer): Op | Promise<Op> },
            'PG OpFactoryCall.toOp accepts an optional ExecuteRequestLowerer; the framework interface omits it because not all targets need a lowerer — the PG target overrides with this extended signature'
          >(c).toOp(lowerer),
        ];
    return lowered.map((opOrPromise) => checkedOp(opOrPromise, c.factoryName));
  });
}
