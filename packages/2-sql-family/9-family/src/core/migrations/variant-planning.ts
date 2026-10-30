import {
  asNamespaceId,
  type Contract,
  type ContractModelBase,
  type ContractWithDomain,
} from '@internal/contract/types';
import type { CodecRef } from '@internal/framework-components/codec';
import {
  type ModelCoordinate,
  modelStatementText,
  type ResolvedMigrationStatement,
  type ResolvedModelRenameStatement,
  type ResolvedVariantConvertStatement,
} from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import { notOk, ok, type Result } from '@internal/utils/result';
import { buildColumnCodecRef } from './contract-to-schema-ir';
import type { SchemaTables } from './schema-tables';
import { isSqlModelStorage, tableControlPolicy } from './statement-planning';
import type { SqlPlannerConflict } from './types';

/**
 * One variant's rewrite of the rows of its base table: the discriminator value `from` becomes `to`,
 * or, when `to` is absent, the rows that hold `from` are deleted. The base table and its
 * discriminator column are named as the destination contract names them.
 */
export interface VariantRowRewrite {
  /** The variant, as the origin contract names it. */
  readonly model: ModelCoordinate;
  readonly namespaceId: string;
  readonly table: string;
  readonly column: string;
  /** The discriminator column's codec, which writes `from` and `to` as the database stores them. */
  readonly codecRef: CodecRef;
  readonly from: string;
  readonly to: string | undefined;
  /** Whether the destination contract has no such variant, so the plan also drops its columns or table. */
  readonly removed: boolean;
  /** The rename or convert statement the rewrite carries out, if any. */
  readonly statement: ResolvedModelRenameStatement | ResolvedVariantConvertStatement | undefined;
}

interface BaseColumn {
  readonly namespaceId: string;
  readonly table: string;
  readonly column: string;
  readonly codecRef: CodecRef;
}

function modelAt(
  contract: ContractWithDomain,
  coordinate: ModelCoordinate,
): ContractModelBase | undefined {
  const namespaces = contract.domain.namespaces;
  const namespace = Object.hasOwn(namespaces, coordinate.namespaceId)
    ? namespaces[coordinate.namespaceId]
    : undefined;
  return namespace !== undefined && Object.hasOwn(namespace.models, coordinate.model)
    ? namespace.models[coordinate.model]
    : undefined;
}

function baseOf(
  contract: ContractWithDomain,
  variant: ModelCoordinate,
): ModelCoordinate | undefined {
  const base = modelAt(contract, variant)?.base;
  return base === undefined
    ? undefined
    : { namespaceId: asNamespaceId(base.namespace), model: base.model };
}

function variantValue(contract: ContractWithDomain, variant: ModelCoordinate): string | undefined {
  const base = baseOf(contract, variant);
  if (base === undefined) return undefined;
  return Object.entries(modelAt(contract, base)?.variants ?? {}).find(
    ([, reference]) =>
      reference.namespace === variant.namespaceId && reference.model === variant.model,
  )?.[0];
}

/** The discriminator column of `base` in the destination, when a managed table of the working schema has it. */
function discriminatorColumn(
  contract: Contract<SqlStorage>,
  base: ModelCoordinate,
  tables: SchemaTables,
): BaseColumn | undefined {
  const model = modelAt(contract, base);
  const discriminator = model?.discriminator;
  if (model === undefined || discriminator === undefined || !isSqlModelStorage(model.storage)) {
    return undefined;
  }
  const { namespaceId, table } = model.storage;
  const column = model.storage.fields[discriminator.field]?.column;
  if (column === undefined || !tables.hasColumn(namespaceId, table, column)) return undefined;
  if (tableControlPolicy(contract, { namespaceId, table }) !== 'managed') return undefined;
  const stored = contract.storage.namespaces[namespaceId]?.entries.table?.[table]?.columns[column];
  if (stored === undefined) return undefined;
  return { namespaceId, table, column, codecRef: buildColumnCodecRef(stored, undefined) };
}

function sameModel(left: ModelCoordinate, right: ModelCoordinate): boolean {
  return left.namespaceId === right.namespaceId && left.model === right.model;
}

function originVariants(contract: ContractWithDomain): readonly ModelCoordinate[] {
  return Object.entries(contract.domain.namespaces).flatMap(([namespaceId, namespace]) =>
    Object.entries(namespace.models).flatMap(([model, definition]) =>
      definition.base === undefined ? [] : [{ namespaceId: asNamespaceId(namespaceId), model }],
    ),
  );
}

/** Where a model of the origin is in the destination, after the plan's namespace and model renames. */
function destinationOf(
  model: ModelCoordinate,
  statements: readonly ResolvedMigrationStatement[],
): {
  readonly coordinate: ModelCoordinate;
  readonly rename: ResolvedModelRenameStatement | undefined;
} {
  const rename = statements.find(
    (statement): statement is ResolvedModelRenameStatement =>
      statement.kind === 'rename' &&
      statement.entity === 'model' &&
      sameModel(statement.from, model),
  );
  if (rename !== undefined) return { coordinate: rename.to, rename };
  const namespace = statements.find(
    (statement) =>
      statement.kind === 'rename' &&
      statement.entity === 'namespace' &&
      statement.from === model.namespaceId,
  );
  return {
    coordinate:
      namespace?.kind === 'rename' && namespace.entity === 'namespace'
        ? { ...model, namespaceId: namespace.to }
        : model,
    rename: undefined,
  };
}

function rewriteOf(
  model: ModelCoordinate,
  input: {
    readonly statements: readonly ResolvedMigrationStatement[];
    readonly fromContract: Contract<SqlStorage>;
    readonly contract: Contract<SqlStorage>;
    readonly tables: SchemaTables;
  },
): VariantRowRewrite | undefined {
  const from = variantValue(input.fromContract, model);
  const originBase = baseOf(input.fromContract, model);
  if (from === undefined || originBase === undefined) return undefined;
  const destination = destinationOf(model, input.statements);
  const to = variantValue(input.contract, destination.coordinate);
  const removed = modelAt(input.contract, destination.coordinate) === undefined;
  if (to === from || (to === undefined && !removed)) return undefined;
  const base =
    baseOf(input.contract, destination.coordinate) ??
    destinationOf(originBase, input.statements).coordinate;
  const column = discriminatorColumn(input.contract, base, input.tables);
  if (column === undefined) return undefined;
  const convert = input.statements.find(
    (statement): statement is ResolvedVariantConvertStatement =>
      statement.kind === 'convert' &&
      statement.entity === 'model' &&
      sameModel(statement.model, destination.coordinate),
  );
  const statement = to === undefined ? undefined : (destination.rename ?? convert);
  return {
    model,
    ...column,
    from,
    to: statement === undefined ? undefined : to,
    removed,
    statement,
  };
}

function chainRefusal(
  rewrite: VariantRowRewrite,
  other: VariantRowRewrite,
  contract: ContractWithDomain,
): SqlPlannerConflict {
  return {
    kind: 'unsupportedOperation',
    summary: `Cannot rewrite discriminator value "${rewrite.from}" of variant "${modelStatementText(contract, rewrite.model)}" to "${rewrite.to}": variant "${modelStatementText(contract, other.model)}" moves from that value in the same column`,
    why: `Column "${rewrite.column}" of "${rewrite.table}" would hold one value for rows of two variants while the plan rewrites them. Change one discriminator value in this migration and the other in a later one.`,
  };
}

/**
 * The row rewrites a plan makes for the variants of the origin whose discriminator value the
 * destination changes or drops. A rename or convert statement rewrites a changed value in the base
 * table's discriminator column; a changed value with no statement, and a variant the destination no
 * longer has, delete the rows that hold the old value, which the plan asks about. Deletions come
 * first, so a value freed by a deleted variant can be taken by another. A rewrite whose new value
 * another variant still moves from is refused. With no origin contract, nothing is known to have
 * changed.
 */
export function planVariantRowRewrites(input: {
  readonly statements: readonly ResolvedMigrationStatement[];
  readonly fromContract: Contract<SqlStorage> | null;
  readonly contract: Contract<SqlStorage>;
  readonly tables: SchemaTables;
}): Result<readonly VariantRowRewrite[], SqlPlannerConflict> {
  const { fromContract } = input;
  if (fromContract === null) return ok([]);
  const rewrites = originVariants(fromContract).flatMap((model) => {
    const rewrite = rewriteOf(model, { ...input, fromContract });
    return rewrite === undefined ? [] : [rewrite];
  });
  const sameColumn = (left: VariantRowRewrite, right: VariantRowRewrite) =>
    left.namespaceId === right.namespaceId &&
    left.table === right.table &&
    left.column === right.column;
  for (const rewrite of rewrites) {
    if (rewrite.to === undefined) continue;
    const other = rewrites.find(
      (candidate) =>
        candidate !== rewrite &&
        candidate.to !== undefined &&
        sameColumn(candidate, rewrite) &&
        candidate.from === rewrite.to,
    );
    if (other !== undefined) return notOk(chainRefusal(rewrite, other, fromContract));
  }
  return ok([
    ...rewrites.filter(({ to }) => to === undefined),
    ...rewrites.filter(({ to }) => to !== undefined),
  ]);
}
