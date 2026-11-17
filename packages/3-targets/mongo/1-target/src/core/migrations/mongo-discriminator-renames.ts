import type { ContractWithDomain } from '@internal/contract/types';
import {
  fieldStatementText,
  type ModelCoordinate,
  modelStatementText,
  type ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import { statementFlag } from './mongo-statement-flags';
import { modelAt } from './mongo-statement-planning';

/** The origin base's discriminator, named through the destination base as a field rename statement names it, and the `--rename` statements that move its values to the destination base's discriminator, after the `--rename` of the base itself when the base is renamed and no statement says so. */
export interface DiscriminatorRename {
  readonly from: string;
  readonly flags: string;
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
  const text = fieldStatementText(contracts.contract, { ...destination, field: oldField });
  const baseRenamed =
    origin.namespaceId !== destination.namespaceId || origin.model !== destination.model;
  const baseRenameStated = contracts.statements.some(
    (statement) =>
      statement.kind === 'rename' &&
      statement.entity === 'model' &&
      statement.from.namespaceId === origin.namespaceId &&
      statement.from.model === origin.model,
  );
  const fieldRename = statementFlag(
    'rename',
    `${text}:${fieldStatementText(contracts.contract, { ...destination, field: newField })}`,
  );
  return {
    from: text,
    flags:
      baseRenamed && !baseRenameStated
        ? `${statementFlag(
            'rename',
            `${modelStatementText(contracts.fromContract, origin)}:${modelStatementText(contracts.contract, destination)}`,
          )} ${fieldRename}`
        : fieldRename,
  };
}
