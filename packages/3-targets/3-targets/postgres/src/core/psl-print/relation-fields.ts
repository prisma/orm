import type { ContractReferenceRelation, ContractRelation } from '@internal/contract/types';
import type { PslAttributeArgument, PslField } from '@internal/framework-components/psl-ast';
import type { ForeignKey, ReferentialAction } from '@internal/sql-contract/types';
import { escapePslString } from '@internal/sql-relational-core/ast';
import { ifDefined } from '@internal/utils/defined';
import { postgresError } from '../errors';
import { buildAttribute, namedArg, SYNTHETIC_SPAN } from '../psl-ast/psl-literals';
import {
  crossReferenceCoordinate,
  type ModelWithTable,
  modelCoordinate,
  pslNamespaceName,
  type VariantInfo,
} from './contract-model-index';
import {
  refuseManyToManyWithoutJunctionRelation,
  refuseNonIdentifier,
  refuseRelationToOtherContractSpace,
  refuseToOneRelationWithoutForeignKey,
} from './refusals';

const PSL_REFERENTIAL_ACTIONS: Readonly<Record<ReferentialAction, string>> = {
  noAction: 'NoAction',
  restrict: 'Restrict',
  cascade: 'Cascade',
  setNull: 'SetNull',
  setDefault: 'SetDefault',
};

/** One relation of one model, resolved against the models it connects. */
export interface ModelRelation {
  readonly owner: ModelWithTable;
  readonly fieldName: string;
  readonly relation: ContractReferenceRelation;
  readonly targetCoordinate: string;
}

function isReferenceRelation(relation: ContractRelation): relation is ContractReferenceRelation {
  return 'on' in relation;
}

export function collectRelations(models: readonly ModelWithTable[]): readonly ModelRelation[] {
  const entries: ModelRelation[] = [];
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
export function isOwningRelation(entry: ModelRelation): boolean {
  return entry.relation.cardinality === 'N:1';
}

export function relationKey(entry: ModelRelation): string {
  return JSON.stringify([entry.owner.namespaceId, entry.owner.name, entry.fieldName]);
}

/** The relation name a pair is pinned with when the model pair carries more than one relation. */
export function relationName(entry: ModelRelation): string {
  return `${entry.owner.name}_${entry.fieldName}`;
}

function columnsIn(model: ModelWithTable, fieldNames: readonly string[]): readonly string[] {
  return fieldNames.map((fieldName) => model.storage.fields[fieldName]?.column ?? fieldName);
}

function columnsOf(entry: ModelRelation, fieldNames: readonly string[]): readonly string[] {
  return columnsIn(entry.owner, fieldNames);
}

function sameColumns(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** The foreign key that backs an owning relation. */
export function foreignKeyFor(
  entry: ModelRelation,
  target: ModelWithTable,
): ForeignKey | undefined {
  const localColumns = columnsOf(entry, entry.relation.on.localFields);
  const targetColumns = columnsIn(target, entry.relation.on.targetFields);
  return entry.owner.table.foreignKeys.find(
    (fk) =>
      fk.target.spaceId === undefined &&
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
  entry: ModelRelation,
  relationsByModel: ReadonlyMap<string, readonly ModelRelation[]>,
): ModelRelation | undefined {
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
  entry: ModelRelation,
  relationsByModel: ReadonlyMap<string, readonly ModelRelation[]>,
): ModelRelation | undefined {
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

/** The PSL field one relation is written as. */
function buildRelationField(input: {
  readonly entry: ModelRelation;
  readonly target: ModelWithTable;
  readonly name: string | undefined;
  /** The owner shares its base's table, so the PSL source lowers no foreign key for it. */
  readonly ownerIsSingleTableVariant: boolean;
}): PslField {
  const { entry, target, name } = input;
  const { relation } = entry;
  const typeNamespaceId =
    target.namespaceId === entry.owner.namespaceId
      ? undefined
      : pslNamespaceName(target.namespaceId);

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
      refuseToOneRelationWithoutForeignKey(entry.owner.name, entry.fieldName);
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
    // Every index the contract carries is written as its own `@@index`, so the
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

/** The relations of each model, keyed by the model's coordinate. */
export function relationsByModel(
  relations: readonly ModelRelation[],
): ReadonlyMap<string, readonly ModelRelation[]> {
  const byModel = new Map<string, ModelRelation[]>();
  for (const entry of relations) {
    const key = modelCoordinate(entry.owner.namespaceId, entry.owner.name);
    const bucket = byModel.get(key) ?? [];
    bucket.push(entry);
    byModel.set(key, bucket);
  }
  return byModel;
}

/**
 * The relation names to pin. A pair needs one when either of its models
 * carries more than one relation to the other; a many-to-many list field
 * additionally pins the junction-side relation it travels through, so that
 * relation is named too.
 */
export function resolvePinnedRelations(
  relations: readonly ModelRelation[],
  relationsByModel: ReadonlyMap<string, readonly ModelRelation[]>,
): ReadonlySet<string> {
  const pairCounts = new Map<string, number>();
  for (const entry of relations) {
    const key = JSON.stringify([
      modelCoordinate(entry.owner.namespaceId, entry.owner.name),
      entry.targetCoordinate,
    ]);
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
  }
  const ambiguous = (entry: ModelRelation): boolean => {
    const ownerCoordinate = modelCoordinate(entry.owner.namespaceId, entry.owner.name);
    const forward = pairCounts.get(JSON.stringify([ownerCoordinate, entry.targetCoordinate])) ?? 0;
    const backward = pairCounts.get(JSON.stringify([entry.targetCoordinate, ownerCoordinate])) ?? 0;
    return forward > 1 || backward > 1;
  };

  const pinned = new Set<string>();
  for (const entry of relations) {
    if (!ambiguous(entry)) continue;
    const owning = isOwningRelation(entry)
      ? entry
      : entry.relation.cardinality === 'N:M'
        ? junctionParentRelation(entry, relationsByModel)
        : owningPartner(entry, relationsByModel);
    if (owning !== undefined) {
      pinned.add(relationKey(owning));
    }
  }
  return pinned;
}

/**
 * Relation fields in the order their foreign keys appear in storage, so the
 * `foreignKeys` the PSL source derives come back in the same order. A relation
 * that owns no foreign key keeps its place at the end.
 */
function orderedByForeignKey(
  entry: ModelWithTable,
  relations: readonly ModelRelation[],
): readonly ModelRelation[] {
  const positions = new Map<ModelRelation, number>();
  for (const relation of relations) {
    const target = relation.relation.on.localFields.map(
      (fieldName) => relation.owner.storage.fields[fieldName]?.column ?? fieldName,
    );
    const position = entry.table.foreignKeys.findIndex(
      (fk) =>
        fk.source.columns.length === target.length &&
        fk.source.columns.every((column, index) => column === target[index]),
    );
    positions.set(
      relation,
      isOwningRelation(relation) && position >= 0 ? position : relations.length,
    );
  }
  return [...relations].sort((a, b) => (positions.get(a) ?? 0) - (positions.get(b) ?? 0));
}

/**
 * The relation fields of one model, in the order of its foreign keys. Each foreign key an owning
 * relation travels is added to `travelledForeignKeys`.
 */
export function buildRelationFields(input: {
  readonly entry: ModelWithTable;
  readonly variant: VariantInfo | undefined;
  readonly relations: readonly ModelRelation[];
  readonly relationsByModel: ReadonlyMap<string, readonly ModelRelation[]>;
  readonly modelsByCoordinate: ReadonlyMap<string, ModelWithTable>;
  readonly pinned: ReadonlySet<string>;
  readonly travelledForeignKeys: Set<ForeignKey>;
}): readonly PslField[] {
  const fields: PslField[] = [];
  for (const modelRelation of orderedByForeignKey(input.entry, input.relations)) {
    refuseNonIdentifier('field', modelRelation.fieldName);
    const target = relationTarget(modelRelation, input.modelsByCoordinate);
    const junctionRelation =
      modelRelation.relation.cardinality === 'N:M'
        ? junctionParentRelation(modelRelation, input.relationsByModel)
        : undefined;
    if (modelRelation.relation.cardinality === 'N:M' && junctionRelation === undefined) {
      refuseManyToManyWithoutJunctionRelation(modelRelation.owner.name, modelRelation.fieldName);
    }
    const owning = isOwningRelation(modelRelation)
      ? modelRelation
      : modelRelation.relation.cardinality === 'N:M'
        ? junctionRelation
        : owningPartner(modelRelation, input.relationsByModel);
    const name =
      owning !== undefined && input.pinned.has(relationKey(owning))
        ? relationName(owning)
        : undefined;
    if (isOwningRelation(modelRelation)) {
      const foreignKey = foreignKeyFor(modelRelation, target);
      if (foreignKey !== undefined) input.travelledForeignKeys.add(foreignKey);
    }
    fields.push(
      buildRelationField({
        entry: modelRelation,
        target,
        name,
        ownerIsSingleTableVariant: input.variant?.singleTable === true,
      }),
    );
  }
  return fields;
}

/**
 * The model a relation points at. A relation into another contract space is
 * refused: the printer does not write one yet.
 */
function relationTarget(
  entry: ModelRelation,
  modelsByCoordinate: ReadonlyMap<string, ModelWithTable>,
): ModelWithTable {
  const { to } = entry.relation;
  refuseRelationToOtherContractSpace({
    modelName: entry.owner.name,
    fieldName: entry.fieldName,
    targetModel: to.model,
    space: to.space,
  });
  const target = modelsByCoordinate.get(entry.targetCoordinate);
  if (target === undefined) {
    throw postgresError(
      'CONTRACT.MODEL_UNKNOWN',
      `contract print: relation "${entry.owner.name}.${entry.fieldName}" targets model "${to.namespace}.${to.model}", which the contract does not declare.`,
      {
        why: 'A relation is written as a field typed by the model it targets.',
        fix: 'The contract source produced a relation to a model it does not declare. Fix the relation if the source is a TypeScript contract; otherwise report the bug to the source that produced it.',
        meta: {
          model: entry.owner.name,
          field: entry.fieldName,
          target: `${to.namespace}.${to.model}`,
        },
      },
    );
  }
  return target;
}
