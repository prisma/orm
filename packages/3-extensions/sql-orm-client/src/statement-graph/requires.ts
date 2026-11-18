import { Edge, type NodeId } from './edge';

export class Requires extends Edge<undefined> {
  constructor(from: NodeId) {
    super(from);
    Object.freeze(this);
  }

  override output(): undefined {
    return undefined;
  }
}

export type RequiresSlot = { requires: Requires[] };

export function requirementUnmet(requires: readonly (readonly undefined[])[] | null): boolean {
  return requires?.some((rows) => rows.length === 0) === true;
}
