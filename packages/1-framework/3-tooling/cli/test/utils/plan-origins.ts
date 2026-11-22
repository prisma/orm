import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import {
  type MigrationPlanArgument,
  migrationPlanFrom,
  type RunnablePlanArgument,
} from '../../src/control-api/operations/plan-arguments';
import { buildGraph, entry } from './graph-helpers';

/** The contract a database is at that no migration records. */
export const UNRECORDED = 'c'.repeat(64);

/** The origin of a database at a contract no migration records, as the rule says it. */
export const NOT_RECORDED: MigrationPlanArgument = migrationPlanFrom(
  { graph: buildGraph([entry(EMPTY_CONTRACT_HASH, 'a'.repeat(64), 'initial')]), refs: {} },
  { kind: 'contract', hash: UNRECORDED },
);

/** A database at `hash`, which a migration records, or at a contract none records. */
export function originOf(hash: string | undefined): MigrationPlanArgument {
  return hash === undefined ? NOT_RECORDED : reference(hash);
}

/** Why no plan starts at {@link UNRECORDED}. */
export const NOT_RECORDED_REASON = NOT_RECORDED.kind === 'none' ? NOT_RECORDED.reason : '';

/** A contract reference a test names, as a `--from` or `--to`. */
export function reference(value: string): RunnablePlanArgument {
  return { kind: 'reference', reference: value };
}
