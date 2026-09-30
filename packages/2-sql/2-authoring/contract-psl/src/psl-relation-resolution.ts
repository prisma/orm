import type { AuthoringContributions } from '@internal/framework-components/authoring';
import { checkUncomposedNamespace } from '@internal/framework-components/authoring';
import type { Binder, FieldSymbol, ModelSymbol, SymbolTable } from '@internal/psl-parser';
import {
  diagnosticSource,
  type PslDiagnostic,
  type PslDiagnosticCollector,
} from '@internal/psl-parser';
import {
  fkRelationPairKey,
  type InvalidFkPairing,
  reportUncomposedNamespace,
  requiredOneToOneBackrelationDiagnostic,
} from '@internal/psl-parser/interpret';
import type { PslSources } from '@internal/psl-parser/syntax';
import type { ReferentialAction } from '@internal/sql-contract/types';
import type { RelationNode } from '@internal/sql-contract-ts/contract-builder';
import { assertDefined, invariant } from '@internal/utils/assertions';
import { ifDefined } from '@internal/utils/defined';

import { getAttribute } from './psl-attribute-parsing';
import {
  interpretFieldAttribute,
  type SqlRelationOutput,
  sqlAttributeSpecs,
} from './sql-attribute-specs';

export const REFERENTIAL_ACTION_MAP: Record<string, ReferentialAction | undefined> = {
  NoAction: 'noAction',
  Restrict: 'restrict',
  Cascade: 'cascade',
  SetNull: 'setNull',
  SetDefault: 'setDefault',
  noAction: 'noAction',
  restrict: 'restrict',
  cascade: 'cascade',
  setNull: 'setNull',
  setDefault: 'setDefault',
};

type ModelKey = string | { readonly name: string };

function modelName(key: ModelKey): string {
  return typeof key === 'string' ? key : key.name;
}

export type InvalidModelFkPairing<K> = {
  readonly declaringModel: K;
  readonly targetModel: K;
  readonly relationName?: string;
};

export type FkRelationMetadata<K = string> = {
  readonly declaringModelName: K;
  readonly declaringFieldName: string;
  readonly declaringTableName: string;
  /** Resolved namespace coordinate of the declaring model, when known. */
  readonly declaringNamespaceId?: string;
  readonly targetModelName: K;
  readonly targetTableName: string;
  /** Resolved namespace coordinate of the related model, when known. */
  readonly targetNamespaceId?: string;
  readonly relationName?: string;
  /** Optionality (`?`) of the declaring relation field. */
  readonly nullable: boolean;
  readonly localColumns: readonly string[];
  readonly referencedColumns: readonly string[];
};

export type ModelBackrelationCandidate<K = string> = {
  readonly modelName: K;
  readonly tableName: string;
  readonly field: FieldSymbol;
  readonly targetModelName: K;
  /** Whether the PSL field itself is list-typed (`Target[]`) rather than singular (`Target?`). A singular candidate is the back side of a 1:1 relation and can never be many-to-many. */
  readonly isList: boolean;
  readonly relationName?: string;
};

type ModelRelationMetadata = RelationNode;

export function normalizeReferentialAction(actionToken: string): ReferentialAction | undefined {
  // the token is already validated by the `@relation` spec's `oneOf(identifier(...))`, so this is just a lookup — no second validation path here.
  return REFERENTIAL_ACTION_MAP[actionToken];
}

export function interpretRelationAttribute(input: {
  readonly selfModel: ModelSymbol;
  readonly field: FieldSymbol;
  readonly symbols: SymbolTable;
  readonly sources: PslSources;
  readonly binder: Binder;
  readonly diagnostics: PslDiagnosticCollector;
}): SqlRelationOutput | undefined {
  const node = getAttribute(input.field.attributes, 'relation')?.node;
  if (node === undefined) return undefined;
  return interpretFieldAttribute({
    symbols: input.symbols,
    node,
    spec: sqlAttributeSpecs.field.relation(),
    model: input.selfModel,
    field: input.field,
    sources: input.sources,
    binder: input.binder,
    diagnostics: input.diagnostics,
  });
}

export function indexFkRelations<K extends ModelKey = string>(input: {
  readonly fkRelationMetadata: readonly FkRelationMetadata<K>[];
}): {
  readonly modelRelations: Map<K, ModelRelationMetadata[]>;
  readonly fkRelationsByPair: Map<K, Map<K, FkRelationMetadata<K>[]>>;
  readonly fkRelationsByDeclaringModel: Map<K, FkRelationMetadata<K>[]>;
} {
  const modelRelations = new Map<K, ModelRelationMetadata[]>();
  const fkRelationsByPair = new Map<K, Map<K, FkRelationMetadata<K>[]>>();
  const fkRelationsByDeclaringModel = new Map<K, FkRelationMetadata<K>[]>();

  for (const relation of input.fkRelationMetadata) {
    const declaringFkRelations = fkRelationsByDeclaringModel.get(relation.declaringModelName);
    if (declaringFkRelations) {
      declaringFkRelations.push(relation);
    } else {
      fkRelationsByDeclaringModel.set(relation.declaringModelName, [relation]);
    }

    const existing = modelRelations.get(relation.declaringModelName);
    const current = existing ?? [];
    if (!existing) {
      modelRelations.set(relation.declaringModelName, current);
    }
    current.push({
      fieldName: relation.declaringFieldName,
      toModel: modelName(relation.targetModelName),
      toTable: relation.targetTableName,
      ...ifDefined('toNamespaceId', relation.targetNamespaceId),
      cardinality: 'N:1',
      nullable: relation.nullable,
      on: {
        parentTable: relation.declaringTableName,
        parentColumns: relation.localColumns,
        childTable: relation.targetTableName,
        childColumns: relation.referencedColumns,
      },
    });

    let targets = fkRelationsByPair.get(relation.declaringModelName);
    if (!targets) {
      targets = new Map();
      fkRelationsByPair.set(relation.declaringModelName, targets);
    }
    const pairRelations = targets.get(relation.targetModelName);
    if (pairRelations) {
      pairRelations.push(relation);
    } else {
      targets.set(relation.targetModelName, [relation]);
    }
  }

  return { modelRelations, fkRelationsByPair, fkRelationsByDeclaringModel };
}

type JunctionFkPair<K> = {
  readonly parentFk: FkRelationMetadata<K>;
  readonly childFk: FkRelationMetadata<K>;
  /**
   * The child FK's junction columns reordered to the target model's
   * id-column order, so positional pairing against the target id stays
   * faithful to the authored references regardless of declaration order.
   */
  readonly childColumnsInTargetIdOrder: readonly string[];
};

function idColumnsAreExactlyFkPair(
  idColumns: readonly string[],
  parentColumns: readonly string[],
  childColumns: readonly string[],
): boolean {
  if (idColumns.length !== parentColumns.length + childColumns.length) {
    return false;
  }
  const fkColumns = new Set([...parentColumns, ...childColumns]);
  if (fkColumns.size !== parentColumns.length + childColumns.length) {
    return false;
  }
  return idColumns.every((column) => fkColumns.has(column));
}

/**
 * Reorders the child FK's junction columns into the target model's id-column
 * order. Returns undefined unless the FK references exactly the target's full
 * id, because downstream consumers pair `through.childColumns` positionally
 * against the target id columns — an FK referencing anything else (a non-id
 * unique, a partial id) would produce a silently wrong join.
 */
function childColumnsInTargetIdOrder<K>(
  childFk: FkRelationMetadata<K>,
  targetIdColumns: readonly string[],
): readonly string[] | undefined {
  if (childFk.referencedColumns.length !== targetIdColumns.length) {
    return undefined;
  }
  const localByReferenced = new Map<string, string>();
  for (const [index, referencedColumn] of childFk.referencedColumns.entries()) {
    const localColumn = childFk.localColumns[index];
    if (localColumn === undefined) {
      return undefined;
    }
    localByReferenced.set(referencedColumn, localColumn);
  }
  if (localByReferenced.size !== targetIdColumns.length) {
    return undefined;
  }
  const ordered: string[] = [];
  for (const idColumn of targetIdColumns) {
    const localColumn = localByReferenced.get(idColumn);
    if (localColumn === undefined) {
      return undefined;
    }
    ordered.push(localColumn);
  }
  return ordered;
}

/**
 * A model that carries an FK back to the candidate's model and an FK to the
 * candidate's target model — i.e. it is junction-shaped for this candidate —
 * but was declined as a many-to-many junction. The reason drives a
 * junction-specific diagnostic that is more actionable than the generic
 * orphaned-backrelation message.
 */
type JunctionNearMiss = {
  readonly junctionModelName: string;
  readonly reason: 'id-not-fk-covering' | 'target-fk-not-id';
};

/**
 * Finds explicit junction models that connect a bare backrelation list field
 * to its target model: a model whose composite id columns are exactly the FK
 * columns of one relation back to the candidate's model (the parent side) and
 * one relation to the candidate's target model (the child side). The child
 * FK must reference exactly the target model's id columns; its junction
 * columns are carried in target-id order on the pair. A relation name on the
 * list field pins the parent-side FK relation, which is how self-referential
 * many-to-many sides are disambiguated.
 *
 * Alongside the recognised pairs, returns junction-shaped near-misses (models
 * that link both sides but were declined) so the caller can emit a
 * junction-specific diagnostic instead of the generic orphaned-list message.
 */
function findJunctionFkPairs<K extends ModelKey>(input: {
  readonly candidate: ModelBackrelationCandidate<K>;
  readonly fkRelationsByDeclaringModel: ReadonlyMap<K, readonly FkRelationMetadata<K>[]>;
  readonly modelIdColumns: ReadonlyMap<K, readonly string[]>;
}): { readonly pairs: JunctionFkPair<K>[]; readonly nearMisses: JunctionNearMiss[] } {
  const targetIdColumns = input.modelIdColumns.get(input.candidate.targetModelName);
  if (!targetIdColumns || targetIdColumns.length === 0) {
    return { pairs: [], nearMisses: [] };
  }
  const pairs: JunctionFkPair<K>[] = [];
  const nearMisses: JunctionNearMiss[] = [];
  for (const [junctionModelName, junctionFks] of input.fkRelationsByDeclaringModel) {
    const idColumns = input.modelIdColumns.get(junctionModelName);
    for (const parentFk of junctionFks) {
      if (parentFk.targetModelName !== input.candidate.modelName) {
        continue;
      }
      if (
        input.candidate.relationName !== undefined &&
        parentFk.relationName !== input.candidate.relationName
      ) {
        continue;
      }
      for (const childFk of junctionFks) {
        if (childFk === parentFk || childFk.targetModelName !== input.candidate.targetModelName) {
          continue;
        }
        // The model links both sides, so it is junction-shaped for this
        // candidate: record why it is declined rather than silently skipping.
        if (
          !idColumns ||
          !idColumnsAreExactlyFkPair(idColumns, parentFk.localColumns, childFk.localColumns)
        ) {
          nearMisses.push({
            junctionModelName: modelName(junctionModelName),
            reason: 'id-not-fk-covering',
          });
          continue;
        }
        const orderedChildColumns = childColumnsInTargetIdOrder(childFk, targetIdColumns);
        if (!orderedChildColumns) {
          nearMisses.push({
            junctionModelName: modelName(junctionModelName),
            reason: 'target-fk-not-id',
          });
          continue;
        }
        pairs.push({ parentFk, childFk, childColumnsInTargetIdOrder: orderedChildColumns });
      }
    }
  }
  return { pairs, nearMisses };
}

function junctionNearMissDiagnostic<K extends ModelKey>(
  candidate: ModelBackrelationCandidate<K>,
  nearMiss: JunctionNearMiss,
  sources: PslSources,
): PslDiagnostic {
  const source = diagnosticSource(sources, candidate.field.node.syntax);
  const listField = `${modelName(candidate.modelName)}.${candidate.field.name}`;
  const targetModelName = modelName(candidate.targetModelName);
  const data = {
    listField,
    junctionModel: nearMiss.junctionModelName,
    targetModel: targetModelName,
  };
  if (nearMiss.reason === 'target-fk-not-id') {
    return {
      code: 'PSL_JUNCTION_TARGET_FK_NOT_ID',
      message: `Backrelation list field "${listField}" found junction model "${nearMiss.junctionModelName}", but its foreign key to "${targetModelName}" does not reference "${targetModelName}"'s @id. The junction's target-side foreign key must reference "${targetModelName}"'s full @id columns for many-to-many recognition.`,
      ...source.at(candidate.field.span),
      data,
    };
  }
  return {
    code: 'PSL_JUNCTION_ID_NOT_FK_COVERING',
    message: `Backrelation list field "${listField}" found junction-shaped model "${nearMiss.junctionModelName}" linking "${modelName(candidate.modelName)}" and "${targetModelName}", but its id does not cover exactly its foreign-key columns. Declare @@id([...]) on "${nearMiss.junctionModelName}" listing exactly the two foreign-key columns for many-to-many recognition.`,
    ...source.at(candidate.field.span),
    data,
  };
}

function manyToManyRelationNode<K extends ModelKey>(
  candidate: ModelBackrelationCandidate<K>,
  pair: JunctionFkPair<K>,
): ModelRelationMetadata {
  return {
    fieldName: candidate.field.name,
    toModel: modelName(pair.childFk.targetModelName),
    toTable: pair.childFk.targetTableName,
    ...ifDefined('toNamespaceId', pair.childFk.targetNamespaceId),
    cardinality: 'N:M',
    on: {
      parentTable: candidate.tableName,
      parentColumns: pair.parentFk.referencedColumns,
      childTable: pair.parentFk.declaringTableName,
      childColumns: pair.parentFk.localColumns,
    },
    through: {
      table: pair.parentFk.declaringTableName,
      ...ifDefined('namespaceId', pair.parentFk.declaringNamespaceId),
      parentColumns: pair.parentFk.localColumns,
      childColumns: pair.childColumnsInTargetIdOrder,
    },
  };
}

function relationsForModel<K>(
  modelRelations: Map<K, ModelRelationMetadata[]>,
  modelName: K,
): ModelRelationMetadata[] {
  const existing = modelRelations.get(modelName);
  if (existing) {
    return existing;
  }
  const created: ModelRelationMetadata[] = [];
  modelRelations.set(modelName, created);
  return created;
}

/**
 * A set of columns is unique when it exactly matches one of the model's unique
 * column sets — its primary key, any single- or multi-column `@unique` /
 * `@@unique` constraint, or a unique index over plain columns with no `where`
 * clause. Set equality (not subset) is required: a singular back-relation means
 * at most one child per parent, which a unique constraint covering exactly the
 * FK columns guarantees.
 */
function fkColumnsAreUnique(
  localColumns: readonly string[],
  uniqueColumnSets: readonly (readonly string[])[],
): boolean {
  const local = new Set(localColumns);
  return uniqueColumnSets.some(
    (columns) => columns.length === local.size && columns.every((column) => local.has(column)),
  );
}

export function applyBackrelationCandidates<K extends ModelKey = string>(input: {
  readonly backrelationCandidates: readonly ModelBackrelationCandidate<K>[];
  readonly fkRelationsByPair: ReadonlyMap<K, ReadonlyMap<K, readonly FkRelationMetadata<K>[]>>;
  readonly invalidFkPairings: (InvalidFkPairing | InvalidModelFkPairing<K>)[];
  readonly fkRelationsByDeclaringModel: ReadonlyMap<K, readonly FkRelationMetadata<K>[]>;
  readonly modelIdColumns: ReadonlyMap<K, readonly string[]>;
  readonly modelUniqueColumnSets: ReadonlyMap<K, readonly (readonly string[])[]>;
  readonly modelRelations: Map<K, ModelRelationMetadata[]>;
  readonly diagnostics: PslDiagnosticCollector;
  readonly sources: PslSources;
}): void {
  for (const candidate of input.backrelationCandidates) {
    const source = diagnosticSource(input.sources, candidate.field.node.syntax);
    const pairMatches =
      input.fkRelationsByPair.get(candidate.targetModelName)?.get(candidate.modelName) ?? [];
    const matches = candidate.relationName
      ? pairMatches.filter((relation) => relation.relationName === candidate.relationName)
      : [...pairMatches];

    if (matches.length === 0) {
      const invalidIndex = input.invalidFkPairings.findIndex((pairing) => {
        if (pairing.relationName !== candidate.relationName) return false;
        if ('pairKey' in pairing) {
          return (
            typeof candidate.targetModelName === 'string' &&
            typeof candidate.modelName === 'string' &&
            pairing.pairKey === fkRelationPairKey(candidate.targetModelName, candidate.modelName)
          );
        }
        return (
          pairing.declaringModel === candidate.targetModelName &&
          pairing.targetModel === candidate.modelName
        );
      });
      if (invalidIndex !== -1) {
        input.invalidFkPairings.splice(invalidIndex, 1);
        continue;
      }
      // A singular candidate is the back side of a 1:1 — many-to-many junction
      // matching only makes sense for a list-typed backrelation.
      if (candidate.isList) {
        const { pairs: junctionPairs, nearMisses } = findJunctionFkPairs({
          candidate,
          fkRelationsByDeclaringModel: input.fkRelationsByDeclaringModel,
          modelIdColumns: input.modelIdColumns,
        });
        const junctionPair = junctionPairs[0];
        if (junctionPairs.length === 1 && junctionPair) {
          relationsForModel(input.modelRelations, candidate.modelName).push(
            manyToManyRelationNode(candidate, junctionPair),
          );
          continue;
        }
        if (junctionPairs.length > 1) {
          input.diagnostics.push({
            code: 'PSL_AMBIGUOUS_BACKRELATION',
            message: `Backrelation list field "${modelName(candidate.modelName)}.${candidate.field.name}" matches multiple junction FK pairs for a many-to-many relation. Add @relation(name: "...") (or @relation("...")) to the list field and the junction FK-side relation pointing back at "${modelName(candidate.modelName)}" to disambiguate.`,
            ...source.at(candidate.field.span),
          });
          continue;
        }
        const nearMiss = nearMisses[0];
        if (nearMiss) {
          input.diagnostics.push(junctionNearMissDiagnostic(candidate, nearMiss, input.sources));
          continue;
        }
      }
      input.diagnostics.push({
        code: 'PSL_ORPHANED_BACKRELATION',
        message: `Backrelation field "${modelName(candidate.modelName)}.${candidate.field.name}" has no matching FK-side relation on model "${modelName(candidate.targetModelName)}". Add @relation(fields: [...], references: [...]) on the FK-side relation${candidate.isList ? ' or use an explicit join model for many-to-many' : ''}.`,
        ...source.at(candidate.field.span),
      });
      continue;
    }
    if (matches.length > 1) {
      input.diagnostics.push({
        code: 'PSL_AMBIGUOUS_BACKRELATION',
        message: `Backrelation field "${modelName(candidate.modelName)}.${candidate.field.name}" matches multiple FK-side relations on model "${modelName(candidate.targetModelName)}". Add @relation(name: "...") (or @relation("...")) to both sides to disambiguate.`,
        ...source.at(candidate.field.span),
      });
      continue;
    }

    invariant(matches.length === 1, 'Backrelation matching requires exactly one match');
    const matched = matches[0];
    assertDefined(matched, 'Backrelation matching requires a defined relation match');

    if (!candidate.isList) {
      const uniqueColumnSets = input.modelUniqueColumnSets.get(matched.declaringModelName) ?? [];
      if (!fkColumnsAreUnique(matched.localColumns, uniqueColumnSets)) {
        input.diagnostics.push({
          code: 'PSL_NON_UNIQUE_BACKRELATION',
          message: `Backrelation field "${modelName(candidate.modelName)}.${candidate.field.name}" is singular, but the matching FK on "${modelName(matched.declaringModelName)}" (fields ${matched.localColumns.map((column) => `"${column}"`).join(', ')}) is not unique. A singular back-relation implies at most one related row; add @unique (or @@unique([...])) to the FK fields, or make "${candidate.field.name}" a list.`,
          ...source.at(candidate.field.span),
        });
        continue;
      }
    }

    if (!candidate.isList && !candidate.field.optional) {
      input.diagnostics.push(
        requiredOneToOneBackrelationDiagnostic({
          modelName: modelName(candidate.modelName),
          field: candidate.field,
          targetModelName: modelName(candidate.targetModelName),
          sources: input.sources,
          recordNoun: 'row',
        }),
      );
    }

    relationsForModel(input.modelRelations, candidate.modelName).push({
      fieldName: candidate.field.name,
      toModel: modelName(matched.declaringModelName),
      toTable: matched.declaringTableName,
      ...ifDefined('toNamespaceId', matched.declaringNamespaceId),
      ...(candidate.isList
        ? { cardinality: '1:N' as const }
        : { cardinality: '1:1' as const, nullable: true }),
      on: {
        parentTable: candidate.tableName,
        parentColumns: matched.referencedColumns,
        childTable: matched.declaringTableName,
        childColumns: matched.localColumns,
      },
    });
  }
}

export function validateBackrelationFieldAttributes(input: {
  readonly modelName: string;
  readonly field: FieldSymbol;
  readonly sources: PslSources;
  readonly binder: Binder;
  readonly composedExtensions: Set<string>;
  readonly authoringContributions: AuthoringContributions | undefined;
  readonly diagnostics: PslDiagnosticCollector;
  readonly familyId: string;
  readonly targetId: string;
}): boolean {
  const source = diagnosticSource(input.sources, input.field.node.syntax);
  let valid = true;
  for (const attribute of input.field.attributes) {
    if (attribute.name === 'relation') {
      continue;
    }

    const uncomposedNamespace = checkUncomposedNamespace(attribute.name, input.composedExtensions, {
      familyId: input.familyId,
      targetId: input.targetId,
      authoringContributions: input.authoringContributions,
    });
    if (uncomposedNamespace) {
      reportUncomposedNamespace({
        subjectLabel: `Attribute "@${attribute.name}"`,
        namespace: uncomposedNamespace,
        source,
        span: attribute.span,
        diagnostics: input.diagnostics,
      });
      valid = false;
      continue;
    }
    input.diagnostics.push({
      code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
      message: `Field "${input.modelName}.${input.field.name}" uses unsupported attribute "@${attribute.name}"`,
      ...source.at(attribute.span),
    });
    valid = false;
  }
  return valid;
}
