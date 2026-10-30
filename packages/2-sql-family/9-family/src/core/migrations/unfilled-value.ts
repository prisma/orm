import type { SqlPlannerConflict } from './types';

/**
 * A value a planner-written operation takes from the user: its `migration.ts` writes `placeholder(slot)` where the value goes. With `refusal`, no statement asked for the value: the plan asks its questions first, then refuses with `refusal` unless an answer leaves the operation out.
 */
export class UnfilledValue {
  readonly slot: string;
  readonly refusal: SqlPlannerConflict | undefined;

  constructor(slot: string, refusal?: SqlPlannerConflict) {
    this.slot = slot;
    this.refusal = refusal;
    Object.freeze(this);
  }
}
