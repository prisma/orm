import { ContractValidationError } from '@internal/contract/contract-validation-error';
import { parseNaming } from '@internal/sql-schema-ir/naming';
import type { IndexElements, IndexInput } from './ir/sql-index';

/**
 * An index as `contract.json` stores it: full `name`, optional `prefix` whose
 * presence marks wire mode. The `table` entity kind hydrates it through
 * {@link indexInputFromSerialized}.
 */
export type SerializedIndex = IndexElements & {
  readonly name: string;
  readonly prefix?: string;
  readonly where?: string;
  readonly unique: boolean;
  readonly type?: string;
  readonly options?: Record<string, unknown>;
};

/**
 * Hydrates one stored index into constructor input. The parameter is typed
 * but the values are whatever the file held, so each field the union depends
 * on is checked here rather than downstream — by the time `Index` sees the
 * data it is already a valid union.
 */
export function indexInputFromSerialized(flat: SerializedIndex): IndexInput {
  if (flat.name === undefined || flat.name.length === 0) {
    throw new ContractValidationError(
      'Index: every index carries a full physical name; an expression index must be explicitly named (a default name cannot be derived from an expression).',
      'storage',
    );
  }
  if ((flat.columns === undefined) === (flat.expression === undefined)) {
    throw new ContractValidationError(
      `Index "${flat.name}": exactly one of columns or expression must be set.`,
      'storage',
    );
  }
  const carried = {
    naming: parseNaming(flat.name, flat.prefix),
    where: flat.where,
    unique: flat.unique,
    type: flat.type,
    options: flat.options,
  };
  return flat.expression !== undefined
    ? { ...carried, expression: flat.expression }
    : { ...carried, columns: flat.columns ?? [] };
}
