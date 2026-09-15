import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import type {
  FieldSymbol,
  PslSpan,
  ResolvedAttribute,
  ResolvedAttributeArg,
} from '@internal/psl-parser';
import { fkRelationPairKey, type InvalidFkPairing } from '@internal/psl-parser/interpret';
import { ArrayLiteralAst, IdentifierAst, StringLiteralExprAst } from '@internal/psl-parser/syntax';
import type { ReferentialAction } from '@internal/sql-contract/types';
import {
  applyBackrelationCandidates,
  type FkRelationMetadata,
  indexFkRelations,
  type ModelBackrelationCandidate,
  normalizeReferentialAction,
} from '@internal/sql-contract-psl/resolution';
import type {
  FieldNode,
  ForeignKeyNode,
  IndexNode,
  ModelNode,
  RelationNode,
} from '@internal/sql-contract-ts/contract-builder';
import { prisma7Diagnostic } from './diagnostics';
import { prisma7ConstraintName } from './indexes';

export interface RelationAttribute {
  readonly name: string | undefined;
  readonly fields: readonly string[] | undefined;
  readonly references: readonly string[] | undefined;
  readonly onDelete: ReferentialAction | undefined;
  readonly onUpdate: ReferentialAction | undefined;
  readonly span: PslSpan;
}

/** A model-typed field: the FK side (`fields:` present) or a back-relation side. */
export interface RelationField {
  readonly field: FieldSymbol;
  readonly targetModelName: string;
  readonly attribute: RelationAttribute | undefined;
}

/** Everything the relation pass needs to know about one interpreted model. */
export interface RelationModel {
  readonly modelName: string;
  readonly tableName: string;
  readonly namespaceId: string;
  readonly sourceId: string;
  readonly columns: ReadonlyMap<string, FieldNode>;
  /** Field names of scalars skipped with `@ignore`; a relation over one is dropped silently. */
  readonly ignoredFields: ReadonlySet<string>;
  readonly idFields: readonly string[];
  readonly uniqueFieldSets: readonly (readonly string[])[];
  readonly relationFields: readonly RelationField[];
}

export interface RelationLowering {
  readonly junctions: readonly ModelNode[];
  readonly foreignKeys: ReadonlyMap<string, readonly ForeignKeyNode[]>;
  readonly relations: ReadonlyMap<string, readonly RelationNode[]>;
}

function identifierNames(expression: ResolvedAttributeArg['expression']): string[] | undefined {
  if (expression === undefined) return undefined;
  const array = ArrayLiteralAst.cast(expression.syntax);
  if (array === undefined) return undefined;
  const names: string[] = [];
  for (const element of array.elements()) {
    const name = IdentifierAst.cast(element.syntax)?.name();
    if (name === undefined) return undefined;
    names.push(name);
  }
  return names;
}

function stringValue(expression: ResolvedAttributeArg['expression']): string | undefined {
  return expression === undefined
    ? undefined
    : StringLiteralExprAst.cast(expression.syntax)?.value();
}

const PRISMA7_REFERENTIAL_ACTIONS: ReadonlySet<string> = new Set([
  'Cascade',
  'Restrict',
  'NoAction',
  'SetNull',
  'SetDefault',
]);

function actionValue(
  expression: ResolvedAttributeArg['expression'],
): ReferentialAction | undefined {
  const token =
    expression === undefined ? undefined : IdentifierAst.cast(expression.syntax)?.name();
  return token !== undefined && PRISMA7_REFERENTIAL_ACTIONS.has(token)
    ? normalizeReferentialAction(token)
    : undefined;
}

export function parseRelationAttribute(
  attribute: ResolvedAttribute,
  label: string,
  sourceId: string,
  diagnostics: ContractSourceDiagnostic[],
): RelationAttribute | undefined {
  let name: string | undefined;
  let fields: readonly string[] | undefined;
  let references: readonly string[] | undefined;
  let onDelete: ReferentialAction | undefined;
  let onUpdate: ReferentialAction | undefined;
  const invalid = (what: string, span: PslSpan): undefined => {
    diagnostics.push({
      code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      message: `${label}: @relation ${what}.`,
      sourceId,
      span,
    });
    return undefined;
  };
  for (const arg of attribute.args) {
    const key = arg.kind === 'positional' ? 'name' : arg.name;
    switch (key) {
      case 'name':
        name = stringValue(arg.expression);
        if (name === undefined) return invalid('name must be a string', arg.span);
        break;
      case 'fields':
        fields = identifierNames(arg.expression);
        if (fields === undefined) return invalid('fields must be a list of field names', arg.span);
        break;
      case 'references':
        references = identifierNames(arg.expression);
        if (references === undefined) {
          return invalid('references must be a list of field names', arg.span);
        }
        break;
      case 'onDelete':
        onDelete = actionValue(arg.expression);
        if (onDelete === undefined)
          return invalid('onDelete must be a referential action', arg.span);
        break;
      case 'onUpdate':
        onUpdate = actionValue(arg.expression);
        if (onUpdate === undefined)
          return invalid('onUpdate must be a referential action', arg.span);
        break;
      case 'map':
        break;
      default:
        return invalid(`argument "${key ?? ''}" is not supported`, arg.span);
    }
  }
  return { name, fields, references, onDelete, onUpdate, span: attribute.span };
}

function columnNames(
  model: RelationModel,
  fieldNames: readonly string[],
): readonly string[] | undefined {
  const columns: string[] = [];
  for (const fieldName of fieldNames) {
    const column = model.columns.get(fieldName);
    if (column === undefined) return undefined;
    columns.push(column.columnName);
  }
  return columns;
}

function unresolved(
  label: string,
  reason: string,
  sourceId: string,
  span: PslSpan,
): ContractSourceDiagnostic {
  return prisma7Diagnostic('PRISMA7_RELATION_UNRESOLVED', `${label} ${reason}`, sourceId, span);
}

interface JunctionSide {
  readonly model: RelationModel;
  readonly field: RelationField;
}

function junctionPairKey(name: string): string {
  return `_${name}`;
}

/**
 * Prisma 7's default relation name: the two model names in alphabetical
 * order joined by `To`. Giving every unnamed relation that name lets the
 * shared pairing helper match Prisma 7's rule that an unnamed side pairs only
 * with the unnamed side of the same model pair.
 */
function effectiveRelationName(
  attribute: RelationAttribute | undefined,
  modelName: string,
  targetModelName: string,
): string {
  if (attribute?.name !== undefined) return attribute.name;
  const [first, second] =
    modelName < targetModelName ? [modelName, targetModelName] : [targetModelName, modelName];
  return `${first}To${second}`;
}

export function lowerRelations(
  models: ReadonlyMap<string, RelationModel>,
  diagnostics: ContractSourceDiagnostic[],
): RelationLowering {
  const fkRelationMetadata: FkRelationMetadata[] = [];
  const candidates: ModelBackrelationCandidate[] = [];
  const invalidFkPairings: InvalidFkPairing[] = [];
  const foreignKeys = new Map<string, ForeignKeyNode[]>();
  const junctions = new Map<string, ModelNode>();
  const addForeignKey = (modelName: string, node: ForeignKeyNode): void => {
    const existing = foreignKeys.get(modelName) ?? [];
    foreignKeys.set(modelName, existing);
    existing.push(node);
  };

  const isFkSide = (relationField: RelationField): boolean =>
    relationField.attribute?.fields !== undefined;
  const sameName = (left: RelationField, right: RelationField): boolean =>
    left.attribute?.name === right.attribute?.name;
  const rejectFkSide = (
    model: RelationModel,
    relationField: RelationField,
    diagnostic: ContractSourceDiagnostic,
  ): void => {
    diagnostics.push(diagnostic);
    invalidFkPairings.push({
      pairKey: fkRelationPairKey(model.modelName, relationField.targetModelName),
      relationName: effectiveRelationName(
        relationField.attribute,
        model.modelName,
        relationField.targetModelName,
      ),
    });
  };

  for (const model of models.values()) {
    for (const relationField of model.relationFields) {
      const { field, targetModelName } = relationField;
      const label = `Relation field "${model.modelName}.${field.name}"`;
      const target = models.get(targetModelName);
      if (target === undefined) continue;

      if (isFkSide(relationField)) {
        const attribute = relationField.attribute;
        if (attribute === undefined || attribute.fields === undefined) continue;
        if (attribute.fields.some((name) => model.ignoredFields.has(name))) continue;
        if (attribute.references === undefined) {
          rejectFkSide(
            model,
            relationField,
            unresolved(
              label,
              'declares fields without references.',
              model.sourceId,
              attribute.span,
            ),
          );
          continue;
        }
        const localColumns = columnNames(model, attribute.fields);
        const referencedColumns = columnNames(target, attribute.references);
        if (localColumns === undefined || referencedColumns === undefined) {
          rejectFkSide(
            model,
            relationField,
            unresolved(
              label,
              'names a field that is not a scalar column of the model or its target.',
              model.sourceId,
              attribute.span,
            ),
          );
          continue;
        }
        if (localColumns.length !== referencedColumns.length) {
          rejectFkSide(
            model,
            relationField,
            unresolved(
              label,
              'must list as many fields as references.',
              model.sourceId,
              attribute.span,
            ),
          );
          continue;
        }
        const anyNullable = attribute.fields.some(
          (name) => model.columns.get(name)?.nullable === true,
        );
        if (anyNullable !== field.optional) {
          rejectFkSide(
            model,
            relationField,
            unresolved(
              label,
              anyNullable
                ? 'must be optional because one of its fields is optional.'
                : 'must be required because every one of its fields is required.',
              model.sourceId,
              field.span,
            ),
          );
          continue;
        }
        const onDelete = attribute.onDelete ?? (anyNullable ? 'setNull' : 'restrict');
        const onUpdate = attribute.onUpdate ?? 'cascade';
        addForeignKey(model.modelName, {
          columns: localColumns,
          references: {
            model: target.modelName,
            table: target.tableName,
            columns: referencedColumns,
            namespaceId: target.namespaceId,
          },
          onDelete,
          onUpdate,
          index: false,
        });
        fkRelationMetadata.push({
          declaringModelName: model.modelName,
          declaringFieldName: field.name,
          declaringTableName: model.tableName,
          declaringNamespaceId: model.namespaceId,
          targetModelName: target.modelName,
          targetTableName: target.tableName,
          targetNamespaceId: target.namespaceId,
          relationName: effectiveRelationName(attribute, model.modelName, target.modelName),
          nullable: field.optional,
          localColumns,
          referencedColumns,
        });
        continue;
      }

      const fkSides = target.relationFields.filter(
        (other) =>
          other.targetModelName === model.modelName &&
          isFkSide(other) &&
          sameName(other, relationField),
      );
      if (fkSides.length > 0 || !field.list) {
        candidates.push({
          modelName: model.modelName,
          tableName: model.tableName,
          field,
          targetModelName: target.modelName,
          isList: field.list,
          relationName: effectiveRelationName(
            relationField.attribute,
            model.modelName,
            target.modelName,
          ),
        });
        continue;
      }

      const partners = target.relationFields.filter(
        (other) =>
          other !== relationField &&
          other.targetModelName === model.modelName &&
          other.field.list &&
          !isFkSide(other) &&
          sameName(other, relationField),
      );
      const [partner] = partners;
      if (partner === undefined) {
        diagnostics.push(
          unresolved(
            label,
            `has no matching relation field on "${target.modelName}".`,
            model.sourceId,
            field.span,
          ),
        );
        continue;
      }
      if (
        partners.length > 1 ||
        (target === model && relationField.attribute?.name === undefined)
      ) {
        diagnostics.push(
          unresolved(
            label,
            `is ambiguous: more than one list field on "${target.modelName}" could pair with it. Name both sides with @relation("name").`,
            model.sourceId,
            field.span,
          ),
        );
        continue;
      }
      const junction = synthesizeJunction(
        { model, field: relationField },
        { model: target, field: partner },
        diagnostics,
      );
      if (junction === undefined) continue;
      const key = junctionPairKey(junction.name);
      if (!junctions.has(key)) {
        junctions.set(key, junction.node);
        fkRelationMetadata.push(...junction.foreignKeys);
      }
      candidates.push({
        modelName: model.modelName,
        tableName: model.tableName,
        field,
        targetModelName: target.modelName,
        isList: true,
        relationName: junction.candidateRelationName,
      });
    }
  }

  const { modelRelations, fkRelationsByPair, fkRelationsByDeclaringModel } = indexFkRelations({
    fkRelationMetadata,
  });
  const modelIdColumns = new Map<string, readonly string[]>();
  const modelUniqueColumnSets = new Map<string, readonly (readonly string[])[]>();
  for (const model of models.values()) {
    const id = columnNames(model, model.idFields);
    if (id !== undefined && id.length > 0) modelIdColumns.set(model.modelName, id);
    const sets: (readonly string[])[] = [];
    if (id !== undefined && id.length > 0) sets.push(id);
    for (const unique of model.uniqueFieldSets) {
      const columns = columnNames(model, unique);
      if (columns !== undefined) sets.push(columns);
    }
    modelUniqueColumnSets.set(model.modelName, sets);
  }
  for (const junction of junctions.values()) {
    modelIdColumns.set(junction.modelName, ['A', 'B']);
    modelUniqueColumnSets.set(junction.modelName, [['A', 'B']]);
  }
  // The shared helper reports every diagnostic against one sourceId, so the
  // candidates are paired one declaring file at a time: a diagnostic then
  // names the file that declares the relation field it is about.
  const pairingDiagnostics: ContractSourceDiagnostic[] = [];
  const candidatesBySourceId = new Map<string, ModelBackrelationCandidate[]>();
  for (const candidate of candidates) {
    const sourceId = models.get(candidate.modelName)?.sourceId ?? 'schema.prisma';
    const group = candidatesBySourceId.get(sourceId) ?? [];
    candidatesBySourceId.set(sourceId, group);
    group.push(candidate);
  }
  for (const [sourceId, backrelationCandidates] of candidatesBySourceId) {
    applyBackrelationCandidates({
      backrelationCandidates,
      fkRelationsByPair,
      invalidFkPairings,
      fkRelationsByDeclaringModel,
      modelIdColumns,
      modelUniqueColumnSets,
      modelRelations,
      diagnostics: pairingDiagnostics,
      sourceId,
    });
  }
  for (const diagnostic of pairingDiagnostics) {
    diagnostics.push(
      diagnostic.code.startsWith('PSL_') && diagnostic.code.endsWith('_BACKRELATION')
        ? { ...diagnostic, code: 'PRISMA7_RELATION_UNRESOLVED' }
        : diagnostic,
    );
  }

  const relations = new Map<string, readonly RelationNode[]>();
  for (const [modelName, nodes] of modelRelations) {
    relations.set(
      modelName,
      [...nodes].sort((left, right) => left.fieldName.localeCompare(right.fieldName)),
    );
  }
  return { junctions: [...junctions.values()], foreignKeys, relations };
}

interface SynthesizedJunction {
  readonly name: string;
  readonly node: ModelNode;
  readonly foreignKeys: readonly FkRelationMetadata[];
  /** The relation name the requesting side's back-relation candidate pairs on. */
  readonly candidateRelationName: string;
}

/**
 * The id column a junction side contributes. The diagnostic names the
 * requesting relation field, so it is located at that field, whichever side's
 * id is at fault.
 */
function singleIdColumn(
  side: JunctionSide,
  requester: JunctionSide,
  diagnostics: ContractSourceDiagnostic[],
): FieldNode | undefined {
  const [idField, ...rest] = side.model.idFields;
  const column = idField === undefined ? undefined : side.model.columns.get(idField);
  if (column === undefined || rest.length > 0) {
    diagnostics.push(
      prisma7Diagnostic(
        'PRISMA7_JUNCTION_ID_UNSUPPORTED',
        `Relation field "${requester.model.modelName}.${requester.field.field.name}" is an implicit many-to-many relation, but "${side.model.modelName}" ${column === undefined ? 'has no single-field @id' : 'has a composite id'}; Prisma 7 requires a single-field @id on both models of an implicit many-to-many relation.`,
        requester.model.sourceId,
        requester.field.field.span,
      ),
    );
    return undefined;
  }
  return column;
}

/**
 * Prisma 7's implicit junction: table `_AToB` (or `_Name`), columns `A` and `B`
 * typed like the two ids, primary key `(A, B)`, index `_AToB_B_index`, and two
 * cascading foreign keys. `A` is the model whose name is smaller in plain
 * string order; for a self-relation, the field whose name is smaller. This is
 * prisma-engines' rule (`psl/parser-database/src/relations.rs`,
 * `ingest_relation`: the side with the greater model name, or field name for a
 * self relation, is skipped so the smaller one owns `field_a`).
 */
function synthesizeJunction(
  requester: JunctionSide,
  partner: JunctionSide,
  diagnostics: ContractSourceDiagnostic[],
): SynthesizedJunction | undefined {
  const selfRelation = requester.model === partner.model;
  const requesterFirst = selfRelation
    ? requester.field.field.name < partner.field.field.name
    : requester.model.modelName < partner.model.modelName;
  const [sideA, sideB] = requesterFirst ? [requester, partner] : [partner, requester];
  const name =
    requester.field.attribute?.name ?? `${sideA.model.modelName}To${sideB.model.modelName}`;
  const idA = singleIdColumn(sideA, requester, diagnostics);
  const idB = singleIdColumn(sideB, requester, diagnostics);
  if (idA === undefined || idB === undefined) return undefined;

  const tableName = prisma7ConstraintName(`_${name}`, '');
  const namespaceId = sideA.model.namespaceId;
  const foreignKey = (column: 'A' | 'B', side: JunctionSide, id: FieldNode): ForeignKeyNode => ({
    columns: [column],
    references: {
      model: side.model.modelName,
      table: side.model.tableName,
      columns: [id.columnName],
      namespaceId: side.model.namespaceId,
    },
    onDelete: 'cascade',
    onUpdate: 'cascade',
    index: false,
  });
  const metadata = (column: 'A' | 'B', side: JunctionSide, id: FieldNode): FkRelationMetadata => ({
    declaringModelName: name,
    declaringFieldName: column.toLowerCase(),
    declaringTableName: tableName,
    declaringNamespaceId: namespaceId,
    targetModelName: side.model.modelName,
    targetTableName: side.model.tableName,
    targetNamespaceId: side.model.namespaceId,
    relationName: `${name}:${column}`,
    nullable: false,
    localColumns: [column],
    referencedColumns: [id.columnName],
  });
  const index: IndexNode = {
    columns: ['B'],
    type: undefined,
    options: undefined,
    where: undefined,
    unique: undefined,
    map: prisma7ConstraintName(`_${name}`, '_B_index'),
    name: undefined,
  };
  return {
    name,
    node: {
      modelName: name,
      tableName,
      namespaceId,
      fields: [
        { fieldName: 'A', columnName: 'A', descriptor: idA.descriptor, nullable: false },
        { fieldName: 'B', columnName: 'B', descriptor: idB.descriptor, nullable: false },
      ],
      id: { columns: ['A', 'B'] },
      indexes: [index],
      foreignKeys: [foreignKey('A', sideA, idA), foreignKey('B', sideB, idB)],
    },
    foreignKeys: [metadata('A', sideA, idA), metadata('B', sideB, idB)],
    candidateRelationName: requesterFirst ? `${name}:A` : `${name}:B`,
  };
}
