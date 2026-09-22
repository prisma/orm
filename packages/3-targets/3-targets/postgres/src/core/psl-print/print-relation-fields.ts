import type { ContractReferenceRelation, ContractRelation } from '@internal/contract/types';
import type { PslAttributeArgument, PslField } from '@internal/framework-components/psl-ast';
import type { ForeignKey, ReferentialAction } from '@internal/sql-contract/types';
import { escapePslString } from '@internal/sql-relational-core/ast';
import { ifDefined } from '@internal/utils/defined';
import { postgresError } from '../errors';
import { buildAttribute, namedArg, SYNTHETIC_SPAN } from '../psl-infer/psl-literals';
import { crossReferenceCoordinate, type ModelEntry, modelCoordinate } from './contract-model-index';

const PSL_REFERENTIAL_ACTIONS: Readonly<Record<ReferentialAction, string>> = {
  noAction: 'NoAction',
  restrict: 'Restrict',
  cascade: 'Cascade',
  setNull: 'SetNull',
  setDefault: 'SetDefault',
};

/** One relation of one model, resolved against the models it connects. */
export interface RelationEntry {
  readonly owner: ModelEntry;
  readonly fieldName: string;
  readonly relation: ContractReferenceRelation;
  readonly targetCoordinate: string;
}

function isReferenceRelation(relation: ContractRelation): relation is ContractReferenceRelation {
  return 'on' in relation;
}

export function collectRelations(models: readonly ModelEntry[]): readonly RelationEntry[] {
  const entries: RelationEntry[] = [];
  for (const owner of models) {
    for (const [fieldName, relation] of Object.entries(owner.model.relations)) {
      if (!isReferenceRelation(relation)) continue;
      entries.push({
        owner,
        fieldName,
        relation,
        targetCoordinate: crossReferenceCoordinate(relation.to),
      });
    }
  }
  return entries;
}

/** A relation whose local fields carry the foreign key — the side `@relation(fields:…)` goes on. */
export function isOwningRelation(entry: RelationEntry): boolean {
  return entry.relation.cardinality === 'N:1';
}

export function relationKey(entry: RelationEntry): string {
  return `${modelCoordinate(entry.owner.namespaceId, entry.owner.name)}\u0000${entry.fieldName}`;
}

/** The relation name a pair is pinned with when the model pair carries more than one relation. */
export function relationName(entry: RelationEntry): string {
  return `${entry.owner.name}_${entry.fieldName}`;
}

function columnsIn(model: ModelEntry, fieldNames: readonly string[]): readonly string[] {
  return fieldNames.map((fieldName) => model.storage.fields[fieldName]?.column ?? fieldName);
}

function columnsOf(entry: RelationEntry, fieldNames: readonly string[]): readonly string[] {
  return columnsIn(entry.owner, fieldNames);
}

function sameColumns(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** The foreign key that backs an owning relation. */
export function foreignKeyFor(entry: RelationEntry, target: ModelEntry): ForeignKey | undefined {
  const localColumns = columnsOf(entry, entry.relation.on.localFields);
  const targetColumns = columnsIn(target, entry.relation.on.targetFields);
  return entry.owner.table.foreignKeys.find(
    (fk) =>
      fk.target.tableName === target.tableName &&
      fk.target.namespaceId === target.namespaceId &&
      sameColumns(fk.source.columns, localColumns) &&
      sameColumns(fk.target.columns, targetColumns),
  );
}

/**
 * The owning relation on `target` that pairs with a back-relation `entry`: the
 * one pointing back at `entry`'s model over the same columns. The
 * back-relation's target fields name fields of the target model, so they are
 * resolved to columns through the candidate's own model, not through the
 * back-relation's.
 */
export function owningPartner(
  entry: RelationEntry,
  relationsByModel: ReadonlyMap<string, readonly RelationEntry[]>,
): RelationEntry | undefined {
  const ownerCoordinate = modelCoordinate(entry.owner.namespaceId, entry.owner.name);
  return relationsByModel
    .get(entry.targetCoordinate)
    ?.find(
      (candidate) =>
        isOwningRelation(candidate) &&
        candidate.targetCoordinate === ownerCoordinate &&
        sameColumns(
          columnsOf(candidate, candidate.relation.on.localFields),
          columnsIn(candidate.owner, entry.relation.on.targetFields),
        ),
    );
}

/**
 * The junction-side relation that points back at the parent of a many-to-many
 * relation — the one whose columns are the junction's parent columns.
 */
export function junctionParentRelation(
  entry: RelationEntry,
  relationsByModel: ReadonlyMap<string, readonly RelationEntry[]>,
): RelationEntry | undefined {
  const through = entry.relation.through;
  if (through === undefined) return undefined;
  const ownerCoordinate = modelCoordinate(entry.owner.namespaceId, entry.owner.name);
  for (const [, relations] of relationsByModel) {
    for (const candidate of relations) {
      if (
        candidate.owner.tableName !== through.table ||
        candidate.owner.namespaceId !== through.namespaceId ||
        candidate.targetCoordinate !== ownerCoordinate ||
        !isOwningRelation(candidate)
      ) {
        continue;
      }
      if (
        sameColumns(columnsOf(candidate, candidate.relation.on.localFields), through.parentColumns)
      ) {
        return candidate;
      }
    }
  }
  return undefined;
}

/** The PSL field one relation prints as. */
export function printRelationField(input: {
  readonly entry: RelationEntry;
  readonly target: ModelEntry;
  readonly name: string | undefined;
  /** The owner shares its base's table, so the PSL source lowers no foreign key for it. */
  readonly ownerIsSingleTableVariant: boolean;
}): PslField {
  const { entry, target, name } = input;
  const { relation } = entry;
  const typeNamespaceId =
    target.namespaceId === entry.owner.namespaceId ? undefined : target.namespaceId;

  const args: PslAttributeArgument[] = [];
  if (name !== undefined) {
    args.push(namedArg('name', `"${escapePslString(name)}"`));
  }

  if (relation.cardinality === 'N:1' && input.ownerIsSingleTableVariant) {
    args.push(namedArg('fields', `[${relation.on.localFields.join(', ')}]`));
    args.push(namedArg('references', `[${relation.on.targetFields.join(', ')}]`));
  } else if (relation.cardinality === 'N:1') {
    const foreignKey = foreignKeyFor(entry, target);
    if (foreignKey === undefined) {
      throw postgresError(
        'CONTRACT.PRINT_UNSUPPORTED',
        `contract print: relation "${entry.owner.name}.${entry.fieldName}" has no foreign key in storage, which Prisma 8 PSL cannot express.`,
        {
          why: 'A to-one relation is authored as `@relation(fields:…, references:…)`, which always lowers to a foreign key.',
          fix: 'Author the Prisma 8 contract by hand for this relation.',
          meta: { model: entry.owner.name, field: entry.fieldName },
        },
      );
    }
    args.push(namedArg('fields', `[${relation.on.localFields.join(', ')}]`));
    args.push(namedArg('references', `[${relation.on.targetFields.join(', ')}]`));
    if (foreignKey.onDelete !== undefined) {
      args.push(namedArg('onDelete', PSL_REFERENTIAL_ACTIONS[foreignKey.onDelete]));
    }
    if (foreignKey.onUpdate !== undefined) {
      args.push(namedArg('onUpdate', PSL_REFERENTIAL_ACTIONS[foreignKey.onUpdate]));
    }
    if (foreignKey.name !== undefined) {
      args.push(namedArg('map', `"${escapePslString(foreignKey.name)}"`));
    }
    // Every index the contract carries is printed as its own `@@index`, so the
    // relation must not also ask for a backing one.
    args.push(namedArg('index', 'false'));
  }

  const list = relation.cardinality === '1:N' || relation.cardinality === 'N:M';
  const optional =
    !list &&
    (relation.cardinality === '1:1' || relation.cardinality === 'N:1') &&
    relation.nullable === true;

  return {
    kind: 'field',
    name: entry.fieldName,
    typeName: target.name,
    ...ifDefined('typeNamespaceId', typeNamespaceId),
    optional,
    list,
    attributes: args.length > 0 ? [buildAttribute('field', 'relation', args)] : [],
    span: SYNTHETIC_SPAN,
  };
}
