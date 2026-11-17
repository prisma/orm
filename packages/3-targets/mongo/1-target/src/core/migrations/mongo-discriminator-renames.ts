import type { ContractWithDomain } from '@internal/contract/types';
import {
  fieldStatementText,
  type ModelCoordinate,
  type ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import { statementFlag } from './mongo-statement-flags';
import { modelAt } from './mongo-statement-planning';

/** The origin base's discriminator, as statements name it, and the `--rename` that moves its values to the destination base's discriminator. */
export interface DiscriminatorRename {
  readonly from: string;
  readonly flag: string;
}

/**
 * The rename that gives a destination base's discriminator the values of its origin's, when the
 * origin's discriminator field is gone from the destination and no rename moves it elsewhere.
 */
export function discriminatorRenameOf(
  origin: ModelCoordinate | undefined,
  destination: ModelCoordinate,
  contracts: {
    readonly fromContract: ContractWithDomain;
    readonly contract: ContractWithDomain;
    readonly statements: readonly ResolvedMigrationStatement[];
  },
): DiscriminatorRename | undefined {
  const from = origin === undefined ? undefined : modelAt(contracts.fromContract, origin);
  const to = modelAt(contracts.contract, destination);
  const oldField = from?.discriminator?.field;
  const newField = to?.discriminator?.field;
  if (origin === undefined || to === undefined || oldField === undefined || newField === undefined)
    return undefined;
  const movedElsewhere = contracts.statements.some(
    (statement) =>
      statement.kind === 'rename' &&
      statement.entity === 'field' &&
      statement.from.namespaceId === origin.namespaceId &&
      statement.from.model === origin.model &&
      statement.from.field === oldField,
  );
  if (oldField === newField || Object.hasOwn(to.fields, oldField) || movedElsewhere)
    return undefined;
  const text = fieldStatementText(contracts.fromContract, { ...origin, field: oldField });
  return {
    from: text,
    flag: statementFlag('rename', `${text}:${text.slice(0, text.lastIndexOf('.'))}.${newField}`),
  };
}
