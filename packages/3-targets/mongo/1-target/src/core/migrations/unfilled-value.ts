/** A value a planner-written operation takes from the user: its `migration.ts` writes `placeholder(slot)` where the value goes. */
export class UnfilledValue {
  readonly slot: string;

  constructor(slot: string) {
    this.slot = slot;
    Object.freeze(this);
  }
}
