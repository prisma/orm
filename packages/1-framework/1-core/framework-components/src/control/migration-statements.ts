import type { ContractWithDomain, NamespaceId } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '../ir/namespace';

/** A model: its namespace and its name as the contract source writes it, never a table name. */
export interface ModelCoordinate {
  readonly namespaceId: NamespaceId;
  readonly model: string;
}

/**
 * A field of a model, named as the contract's model keys it in `fields`. Whether that is the
 * field's name in the contract source or its stored name in every family is not settled yet.
 */
export interface FieldCoordinate extends ModelCoordinate {
  readonly field: string;
}

export interface ResolvedModelRenameStatement {
  readonly kind: 'rename';
  readonly entity: 'model';
  readonly from: ModelCoordinate;
  readonly to: ModelCoordinate;
}

export interface ResolvedFieldRenameStatement {
  readonly kind: 'rename';
  readonly entity: 'field';
  readonly from: FieldCoordinate;
  readonly to: FieldCoordinate;
}

/**
 * A statement resolved against the origin and destination contracts into domain coordinates:
 * `from` is a coordinate of the origin contract and `to` one of the destination contract. Each
 * member's `entity` names the kind of coordinate its sides use, so another kind of entity is a
 * further member with its own coordinate type.
 */
export type ResolvedMigrationStatement =
  | ResolvedModelRenameStatement
  | ResolvedFieldRenameStatement;

/**
 * A statement as a plan applied it: `operationIndexes` are the positions, in the plan's
 * `operations`, of the operations the statement accounts for, in plan order, and empty when the
 * storage did not change. Statements refer to operations by position because operation ids are
 * not unique within a plan.
 */
export interface AppliedMigrationStatement {
  readonly statement: ResolvedMigrationStatement;
  readonly operationIndexes: readonly number[];
}

/**
 * A model's name in messages: `namespace.Model`, or `Model` alone in the unbound namespace, whose
 * id is internal.
 */
export function modelDisplayName(coordinate: ModelCoordinate): string {
  return coordinate.namespaceId === UNBOUND_NAMESPACE_ID
    ? coordinate.model
    : `${coordinate.namespaceId}.${coordinate.model}`;
}

function modelName(contract: ContractWithDomain, coordinate: ModelCoordinate): string {
  return Object.keys(contract.domain.namespaces).length > 1
    ? modelDisplayName(coordinate)
    : coordinate.model;
}

/** A model coordinate in JSON output: `namespaceId` is left out for the unbound namespace. */
export interface ModelCoordinateJson {
  readonly namespaceId?: NamespaceId;
  readonly model: string;
}

/** A field coordinate in JSON output: `namespaceId` is left out for the unbound namespace. */
export interface FieldCoordinateJson extends ModelCoordinateJson {
  readonly field: string;
}

/** A resolved statement in JSON output, with each coordinate written as `*CoordinateJson`. */
export type MigrationStatementJson =
  | {
      readonly kind: 'rename';
      readonly entity: 'model';
      readonly from: ModelCoordinateJson;
      readonly to: ModelCoordinateJson;
    }
  | {
      readonly kind: 'rename';
      readonly entity: 'field';
      readonly from: FieldCoordinateJson;
      readonly to: FieldCoordinateJson;
    };

function coordinateJson<T extends ModelCoordinate>(
  coordinate: T,
): Omit<T, 'namespaceId'> & ModelCoordinateJson {
  if (coordinate.namespaceId !== UNBOUND_NAMESPACE_ID) return coordinate;
  const { namespaceId: _unbound, ...rest } = coordinate;
  return rest;
}

/** The statement as JSON output writes it. */
export function migrationStatementJson(
  statement: ResolvedMigrationStatement,
): MigrationStatementJson {
  return statement.entity === 'model'
    ? { ...statement, from: coordinateJson(statement.from), to: coordinateJson(statement.to) }
    : { ...statement, from: coordinateJson(statement.from), to: coordinateJson(statement.to) };
}

/**
 * The text that reports a statement, in domain names: a model or field is named with its
 * namespace only when its contract has more than one. A field is named through its model as the
 * destination contract names it, as the statement itself is written.
 */
export function describeMigrationStatement(
  statement: ResolvedMigrationStatement,
  fromContract: ContractWithDomain,
  contract: ContractWithDomain,
): string {
  if (statement.entity === 'model') {
    return `rename model "${modelName(fromContract, statement.from)}" to "${modelName(contract, statement.to)}"`;
  }
  const model = modelName(contract, statement.to);
  return `rename field "${model}.${statement.from.field}" to "${model}.${statement.to.field}"`;
}
