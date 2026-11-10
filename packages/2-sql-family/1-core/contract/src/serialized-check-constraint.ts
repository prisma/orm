import { parseNaming } from '@internal/sql-schema-ir/naming';
import type { CheckConstraintInput } from './ir/check-constraint';

/**
 * A check constraint as `contract.json` stores it: full `name`, optional
 * `prefix` whose presence marks wire mode. The `table` entity kind hydrates it
 * through {@link checkConstraintInputFromSerialized}.
 */
export interface SerializedCheckConstraint {
  readonly name: string;
  readonly prefix?: string;
  readonly expression: string;
}

/**
 * Hydrates one stored check constraint into constructor input. `parseNaming`
 * is what rejects a hand-edited file whose `prefix` and `name` disagree.
 */
export function checkConstraintInputFromSerialized(
  flat: SerializedCheckConstraint,
): CheckConstraintInput {
  return { naming: parseNaming(flat.name, flat.prefix), expression: flat.expression };
}
