import type {
  Contract,
  ContractModel,
  ContractReferenceRelation,
  ContractRelation,
} from '@internal/contract/types';
import type { SqlModelStorage, SqlStorage } from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';
import { InternalError } from '@internal/utils/internal-error';

export interface RelationSite {
  readonly namespaceId: string;
  readonly modelName: string;
  readonly fieldName: string;
  readonly model: ContractModel;
  readonly relation: ContractReferenceRelation;
}

/** Embedded relations carry no columns and have no Prisma 8 PSL spelling. */
export function referenceRelation(
  relation: ContractRelation,
  label: string,
): ContractReferenceRelation {
  if (!('on' in relation)) {
    throw new InternalError(`${label}: an embedded relation has no Prisma 8 PSL spelling`);
  }
  return relation;
}

export function relationKey(namespaceId: string, modelName: string, fieldName: string): string {
  return JSON.stringify([namespaceId, modelName, fieldName]);
}

export function modelStorageOf(model: ContractModel): SqlModelStorage {
  return blindCast<SqlModelStorage, 'a SQL contract model carries SQL model storage'>(
    model.storage,
  );
}

export function upperFirst(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function columnsOf(model: ContractModel, fieldNames: readonly string[]): readonly string[] {
  const storage = modelStorageOf(model);
  return fieldNames.map((fieldName) => storage.fields[fieldName]?.column ?? fieldName);
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Whether `site` is the foreign-key side of its relation: the model's own
 * table declares a foreign key over exactly the relation's local columns
 * that points at the target model's table.
 */
export function isForeignKeySide(contract: Contract<SqlStorage>, site: RelationSite): boolean {
  return foreignKeyOf(contract, site) !== undefined;
}

export function foreignKeyOf(contract: Contract<SqlStorage>, site: RelationSite) {
  const { relation, model } = site;
  if (relation.cardinality === 'N:M') return undefined;
  const storage = modelStorageOf(model);
  const table = contract.storage.namespaces[storage.namespaceId]?.entries.table?.[storage.table];
  const target = contract.domain.namespaces[relation.to.namespace]?.models[relation.to.model];
  if (table === undefined || target === undefined) return undefined;
  const localColumns = columnsOf(model, relation.on.localFields);
  const targetStorage = modelStorageOf(target);
  return table.foreignKeys.find(
    (foreignKey) =>
      sameList(foreignKey.source.columns, localColumns) &&
      foreignKey.target.tableName === targetStorage.table &&
      foreignKey.target.namespaceId === targetStorage.namespaceId,
  );
}

function allSites(contract: Contract<SqlStorage>): RelationSite[] {
  const sites: RelationSite[] = [];
  for (const [namespaceId, namespace] of Object.entries(contract.domain.namespaces)) {
    for (const [modelName, model] of Object.entries(namespace.models)) {
      for (const [fieldName, relation] of Object.entries(model.relations)) {
        sites.push({
          namespaceId,
          modelName,
          fieldName,
          model,
          relation: referenceRelation(relation, `Model "${modelName}", relation "${fieldName}"`),
        });
      }
    }
  }
  return sites;
}

function modelByTable(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  table: string,
): { readonly name: string; readonly model: ContractModel } | undefined {
  const namespace = contract.domain.namespaces[namespaceId];
  if (namespace === undefined) return undefined;
  for (const [name, model] of Object.entries(namespace.models)) {
    if (modelStorageOf(model).table === table) return { name, model };
  }
  return undefined;
}

/**
 * The `@relation("Name")` each relation field needs so the PSL interpreter
 * pairs it as the contract does. The domain plane carries no relation names,
 * so a name is written only where pairing would otherwise be ambiguous:
 *
 * - Two or more foreign keys from one model to the same target: each
 *   foreign-key field and its back-relation share `<Model><Field>`.
 * - A many-to-many list whose target model holds a foreign key to the list's
 *   model (the interpreter would pair it with that foreign key), or whose
 *   junction is one of several linking the two models: the list field and the
 *   junction relation over its parent columns share the junction model's
 *   name; a self-referential junction uses the list field's own name for each
 *   side. Both list fields of a pair are named when either needs it.
 */
export function relationNames(contract: Contract<SqlStorage>): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  const sites = allSites(contract);
  const foreignKeySites = sites.filter((site) => isForeignKeySide(contract, site));

  const foreignKeyCount = new Map<string, number>();
  for (const site of foreignKeySites) {
    const key = `${site.namespaceId}.${site.modelName}>${site.relation.to.namespace}.${site.relation.to.model}`;
    foreignKeyCount.set(key, (foreignKeyCount.get(key) ?? 0) + 1);
  }
  for (const site of foreignKeySites) {
    const key = `${site.namespaceId}.${site.modelName}>${site.relation.to.namespace}.${site.relation.to.model}`;
    if ((foreignKeyCount.get(key) ?? 0) < 2) continue;
    const name = `${site.modelName}${upperFirst(site.fieldName)}`;
    names.set(relationKey(site.namespaceId, site.modelName, site.fieldName), name);
    const back = sites.find(
      (candidate) =>
        candidate.namespaceId === site.relation.to.namespace &&
        candidate.modelName === site.relation.to.model &&
        candidate.relation.to.model === site.modelName &&
        candidate.relation.to.namespace === site.namespaceId &&
        candidate.relation.cardinality !== 'N:M' &&
        !isForeignKeySide(contract, candidate) &&
        sameList(candidate.relation.on.targetFields, site.relation.on.localFields),
    );
    if (back) names.set(relationKey(back.namespaceId, back.modelName, back.fieldName), name);
  }

  const manyToMany = sites.filter((site) => site.relation.cardinality === 'N:M');
  const needsName = (site: RelationSite): boolean => {
    const targetHoldsForeignKeyToModel = foreignKeySites.some(
      (candidate) =>
        candidate.namespaceId === site.relation.to.namespace &&
        candidate.modelName === site.relation.to.model &&
        candidate.relation.to.namespace === site.namespaceId &&
        candidate.relation.to.model === site.modelName,
    );
    if (targetHoldsForeignKeyToModel) return true;
    let junctionPairs = 0;
    const byModel = new Map<string, RelationSite[]>();
    for (const candidate of foreignKeySites) {
      const key = `${candidate.namespaceId}.${candidate.modelName}`;
      byModel.set(key, [...(byModel.get(key) ?? []), candidate]);
    }
    for (const junctionRelations of byModel.values()) {
      const toModel = junctionRelations.filter(
        (candidate) =>
          candidate.relation.to.namespace === site.namespaceId &&
          candidate.relation.to.model === site.modelName,
      ).length;
      const toTarget = junctionRelations.filter(
        (candidate) =>
          candidate.relation.to.namespace === site.relation.to.namespace &&
          candidate.relation.to.model === site.relation.to.model,
      ).length;
      const selfReferential =
        site.relation.to.namespace === site.namespaceId &&
        site.relation.to.model === site.modelName;
      junctionPairs += selfReferential ? toModel * (toModel - 1) : toModel * toTarget;
    }
    return junctionPairs > 1;
  };
  for (const site of manyToMany) {
    if (site.relation.cardinality !== 'N:M') continue;
    const { through } = site.relation;
    const junction = modelByTable(contract, through.namespaceId, through.table);
    if (junction === undefined) {
      throw new InternalError(
        `Model "${site.modelName}", relation "${site.fieldName}": junction table "${through.namespaceId}.${through.table}" has no model, so the many-to-many relation has no Prisma 8 PSL spelling`,
      );
    }
    const partner = manyToMany.find(
      (candidate) =>
        candidate !== site &&
        candidate.relation.cardinality === 'N:M' &&
        candidate.relation.through.table === through.table &&
        candidate.relation.through.namespaceId === through.namespaceId &&
        sameList(candidate.relation.through.parentColumns, through.childColumns),
    );
    if (!needsName(site) && !(partner !== undefined && needsName(partner))) continue;
    const selfReferential =
      site.relation.to.namespace === site.namespaceId && site.relation.to.model === site.modelName;
    const name = selfReferential ? upperFirst(site.fieldName) : junction.name;
    names.set(relationKey(site.namespaceId, site.modelName, site.fieldName), name);
    const junctionStorage = modelStorageOf(junction.model);
    for (const [fieldName, junctionRelation] of Object.entries(junction.model.relations)) {
      const relation = referenceRelation(
        junctionRelation,
        `Model "${junction.name}", relation "${fieldName}"`,
      );
      if (relation.cardinality === 'N:M') continue;
      const columns = relation.on.localFields.map(
        (field) => junctionStorage.fields[field]?.column ?? field,
      );
      if (
        sameList(columns, through.parentColumns) &&
        relation.to.namespace === site.namespaceId &&
        relation.to.model === site.modelName
      ) {
        names.set(relationKey(through.namespaceId, junction.name, fieldName), name);
      }
    }
  }
  return names;
}
