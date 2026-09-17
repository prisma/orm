import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import type {
  FieldSymbol,
  PslSpan,
  ResolvedAttribute,
  ResolvedAttributeArg,
} from '@internal/psl-parser';
import { createPslDiagnosticCollector } from '@internal/psl-parser';
import { fkRelationPairKey, type InvalidFkPairing } from '@internal/psl-parser/interpret';
import type { PslSources } from '@internal/psl-parser/syntax';
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
import {
  andList,
  fieldList,
  ignoredFieldReferenced,
  type Prisma7DiagnosticCode,
  prisma7Diagnostic,
} from './diagnostics';
import { prisma7ConstraintName } from './indexes';
import type { Prisma7TargetBinding } from './target-binding';

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
  /** The model's `@@map` attribute, or the model when it has none. */
  readonly tableSpan: PslSpan;
  readonly namespaceId: string;
  readonly sourceId: string;
  readonly sources: PslSources;
  readonly columns: ReadonlyMap<string, FieldNode>;
  readonly ignoredFields: ReadonlySet<string>;
  /** Relation fields marked `@ignore`; their back-relations are omitted with them. */
  readonly ignoredRelationFields: readonly RelationField[];
  /** Fields whose type or attributes were reported; keys and relations over them report nothing more. */
  readonly rejectedFields: ReadonlySet<string>;
  readonly idFields: readonly string[];
  readonly uniqueFieldSets: readonly (readonly string[])[];
  readonly relationFields: readonly RelationField[];
}

/** The codes `applyBackrelationCandidates` reports, each shown as `PSL.PRISMA7_RELATION_UNRESOLVED`. */
export const RELATION_PAIRING_CODES: ReadonlySet<string> = new Set([
  'PSL_ORPHANED_BACKRELATION',
  'PSL_AMBIGUOUS_BACKRELATION',
  'PSL_NON_UNIQUE_BACKRELATION',
  'PSL_REQUIRED_ONE_TO_ONE_BACKRELATION',
  'PSL_JUNCTION_ID_NOT_FK_COVERING',
  'PSL_JUNCTION_TARGET_FK_NOT_ID',
]);

/** What the relation pass needs from the target to name junction tables, indexes and fields. */
export type JunctionNaming = Pick<
  Prisma7TargetBinding,
  'identifierMaxBytes' | 'junctionRelationFieldNames'
>;

export interface RelationLowering {
  readonly junctions: ReadonlyMap<string, ModelNode>;
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
  return prisma7Diagnostic('PSL.PRISMA7_RELATION_UNRESOLVED', `${label} ${reason}`, sourceId, span);
}

interface JunctionSide {
  readonly model: RelationModel;
  readonly field: RelationField;
}

interface JunctionRequest {
  readonly requester: JunctionSide;
  readonly partner: JunctionSide;
  readonly name: string;
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(keyOf(item)) ?? [];
    groups.set(keyOf(item), group);
    group.push(item);
  }
  return groups;
}

function orderJunctionSides(
  requester: JunctionSide,
  partner: JunctionSide,
): readonly [JunctionSide, JunctionSide] {
  const requesterFirst =
    requester.model === partner.model
      ? requester.field.field.name < partner.field.field.name
      : requester.model.modelName < partner.model.modelName;
  return requesterFirst ? [requester, partner] : [partner, requester];
}

function junctionKey(namespaceId: string, name: string): string {
  return JSON.stringify([namespaceId, name]);
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

/**
 * Prisma 7 accepts `SetNull` over a required field and `SetDefault` over a
 * required field with no default, and writes them into the foreign key; the
 * contract rejects both, because the action would fail the first time it runs.
 */
function referentialActionRejections(input: {
  readonly model: RelationModel;
  readonly relationField: FieldSymbol;
  readonly label: string;
  readonly fieldNames: readonly string[];
  readonly actions: Readonly<Record<'onDelete' | 'onUpdate', ReferentialAction>>;
  readonly span: PslSpan;
}): ContractSourceDiagnostic[] {
  const { model, relationField, label, fieldNames, span } = input;
  const anotherAction =
    "choose another action, which replaces the foreign key on Prisma 7's next migration and leaves the Prisma 7 client unchanged.";
  const fieldsWhere = (predicate: (column: FieldNode) => boolean): readonly string[] =>
    fieldNames.filter((name) => {
      const column = model.columns.get(name);
      return column !== undefined && predicate(column);
    });
  const rejections: ContractSourceDiagnostic[] = [];
  for (const [key, action] of Object.entries(input.actions)) {
    if (action === 'setNull') {
      const required = fieldsWhere((column) => !column.nullable);
      if (required.length === 0) continue;
      const fields = fieldList(model.modelName, required);
      rejections.push(
        prisma7Diagnostic(
          'PSL.PRISMA7_REFERENTIAL_ACTION_UNSUPPORTED',
          `${label}: ${key}: SetNull sets the foreign key fields to null, but ${fields} ${required.length === 1 ? 'is' : 'are'} required, so Prisma 8 cannot describe this foreign key. Make ${fields}${relationField.optional ? '' : ` and "${model.modelName}.${relationField.name}"`} optional, which drops NOT NULL on Prisma 7's next migration and makes ${required.length === 1 && relationField.optional ? 'it' : 'them'} nullable in the Prisma 7 client, or ${anotherAction}`,
          model.sourceId,
          span,
        ),
      );
    }
    if (action === 'setDefault') {
      const withoutDefault = fieldsWhere(
        (column) => !column.nullable && column.default === undefined,
      );
      if (withoutDefault.length === 0) continue;
      const fields = fieldList(model.modelName, withoutDefault);
      const one = withoutDefault.length === 1;
      const generated = withoutDefault.filter(
        (name) => model.columns.get(name)?.executionDefaults?.onCreate !== undefined,
      );
      const plain = withoutDefault.filter((name) => !generated.includes(name));
      const generatorNote =
        generated.length > 0
          ? ' (a client-side generator such as uuid() does not give the column one)'
          : '';
      const example =
        'a column default, such as a literal or @default(dbgenerated("<expression>"))';
      const plainFields = fieldList(model.modelName, plain);
      const generatedFields = fieldList(model.modelName, generated);
      const edit =
        generated.length === 0
          ? `Give ${plainFields} ${example}`
          : plain.length === 0
            ? `Replace the @default on ${generatedFields} with ${example}, because a field takes only one @default`
            : `Give ${plainFields} ${example}, and replace the @default on ${generatedFields} with one, because a field takes only one @default`;
      const effects = [
        `Prisma 7's next migration sets ${one ? 'it' : 'them'}`,
        ...(plain.length > 0
          ? [
              `${plainFields} ${plain.length === 1 ? 'becomes' : 'become'} optional when creating records with the Prisma 7 client`,
            ]
          : []),
        ...(generated.length > 0
          ? [
              `the Prisma 7 client stops generating ${generated.length === 1 ? 'a value' : 'values'} for ${generatedFields}`,
            ]
          : []),
      ];
      rejections.push(
        prisma7Diagnostic(
          'PSL.PRISMA7_REFERENTIAL_ACTION_UNSUPPORTED',
          `${label}: ${key}: SetDefault sets the foreign key fields to their column defaults, but ${fields} ${one ? 'is' : 'are'} required and ${one ? 'has' : 'have'} no column default${generatorNote}, so Prisma 8 cannot describe this foreign key. ${edit}: ${andList(effects)}. Or ${anotherAction}`,
          model.sourceId,
          span,
        ),
      );
    }
  }
  return rejections;
}

export function lowerRelations(
  models: ReadonlyMap<string, RelationModel>,
  naming: JunctionNaming,
  diagnostics: ContractSourceDiagnostic[],
): RelationLowering {
  const fkRelationMetadata: FkRelationMetadata[] = [];
  const candidates: ModelBackrelationCandidate[] = [];
  const invalidFkPairings: InvalidFkPairing[] = [];
  const foreignKeys = new Map<string, ForeignKeyNode[]>();
  const junctions = new Map<string, ModelNode>();
  const reportedJunctionNames = new Set<string>();
  const junctionRequests: JunctionRequest[] = [];
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
    ...rejections: readonly ContractSourceDiagnostic[]
  ): void => {
    diagnostics.push(...rejections);
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
        const ignoredScalars = attribute.fields.filter((name) => model.ignoredFields.has(name));
        if (ignoredScalars.length > 0) {
          rejectFkSide(
            model,
            relationField,
            ignoredFieldReferenced({
              modelName: model.modelName,
              fieldNames: ignoredScalars,
              usedBy: `relation field "${model.modelName}.${field.name}"`,
              constraint: 'foreign key',
              sourceId: model.sourceId,
              span: attribute.span,
            }),
          );
          continue;
        }
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
        if (
          attribute.fields.some((name) => model.rejectedFields.has(name)) ||
          attribute.references.some(
            (name) => target.ignoredFields.has(name) || target.rejectedFields.has(name),
          )
        ) {
          rejectFkSide(model, relationField);
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
        const nullability = attribute.fields.map(
          (name) => model.columns.get(name)?.nullable === true,
        );
        const anyNullable = nullability.includes(true);
        if (anyNullable && !field.optional) {
          rejectFkSide(
            model,
            relationField,
            unresolved(
              label,
              'must be optional because one of its fields is optional.',
              model.sourceId,
              field.span,
            ),
          );
          continue;
        }
        const onDelete =
          attribute.onDelete ?? (nullability.includes(false) ? 'restrict' : 'setNull');
        const onUpdate = attribute.onUpdate ?? 'cascade';
        const actionRejections = referentialActionRejections({
          model,
          relationField: field,
          label,
          fieldNames: attribute.fields,
          actions: { onDelete, onUpdate },
          span: attribute.span,
        });
        if (actionRejections.length > 0) {
          rejectFkSide(model, relationField, ...actionRejections);
          continue;
        }
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
          nullable: anyNullable,
          localColumns,
          referencedColumns,
        });
        continue;
      }

      if (
        target.ignoredRelationFields.some(
          (other) => other.targetModelName === model.modelName && sameName(other, relationField),
        )
      ) {
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
      const junctionName = effectiveRelationName(
        relationField.attribute,
        model.modelName,
        target.modelName,
      );
      const requester: JunctionSide = { model, field: relationField };
      const partnerSide: JunctionSide = { model: target, field: partner };
      const junctionNamespaceId = orderJunctionSides(requester, partnerSide)[0].model.namespaceId;
      const namesake = models.get(junctionName);
      if (namesake !== undefined && namesake.namespaceId === junctionNamespaceId) {
        const reportedKey = junctionKey(junctionNamespaceId, junctionName);
        if (!reportedJunctionNames.has(reportedKey)) {
          reportedJunctionNames.add(reportedKey);
          diagnostics.push(
            prisma7Diagnostic(
              'PSL.PRISMA7_JUNCTION_NAME_COLLISION',
              `${label} is an implicit many-to-many relation whose junction model would be named "${junctionName}", but model "${junctionName}" already has that name. Rename model "${junctionName}" and keep its table with @@map("${namesake.tableName}"); Prisma 7's next migration is then empty.`,
              model.sourceId,
              field.span,
            ),
          );
        }
        continue;
      }
      junctionRequests.push({ requester, partner: partnerSide, name: junctionName });
    }
  }

  const requestsByJunction = groupBy(junctionRequests, (request) =>
    junctionKey(
      orderJunctionSides(request.requester, request.partner)[0].model.namespaceId,
      request.name,
    ),
  );
  for (const requests of requestsByJunction.values()) {
    const [first] = requests;
    if (first === undefined) continue;
    const name = first.name;
    const [sideA] = orderJunctionSides(first.requester, first.partner);
    const tableName = prisma7ConstraintName(`_${name}`, '', naming.identifierMaxBytes);
    const sideLabel = (side: JunctionSide): string =>
      `${side.model.modelName}.${side.field.field.name}`;
    const pairs = new Map<string, JunctionRequest>();
    for (const request of requests) {
      const key = [sideLabel(request.requester), sideLabel(request.partner)].sort().join('|');
      if (!pairs.has(key)) pairs.set(key, request);
    }
    if (pairs.size > 1) {
      const pairRequests = [...pairs.values()];
      for (const request of pairRequests) {
        const others = pairRequests
          .filter((other) => other !== request)
          .map((other) => `"${sideLabel(other.requester)}"`);
        diagnostics.push(
          prisma7Diagnostic(
            'PSL.PRISMA7_RELATION_NAME_SHARED',
            `Relation field "${sideLabel(request.requester)}" is an implicit many-to-many relation named "${name}", and so ${others.length === 1 ? 'is relation field' : 'are relation fields'} ${andList(others)}; Prisma 7 creates one table "${tableName}" for them, wired to only one of the relations (its foreign keys show which). Give each relation its own name with @relation("<name>") on both fields: renaming a relation that "${tableName}" does not reference makes Prisma 7's next migration create its own table, while renaming the one it references moves "${tableName}"'s foreign keys to another relation, which fails on rows whose ids that relation's models lack and attaches the rest to the wrong records.`,
            request.requester.model.sourceId,
            request.requester.field.field.span,
          ),
        );
      }
      continue;
    }
    const tableOwner = [...models.values()].find(
      (other) => other.tableName === tableName && other.namespaceId === sideA.model.namespaceId,
    );
    if (tableOwner !== undefined) {
      const relationField = `${first.requester.model.modelName}.${first.requester.field.field.name}`;
      const message = `Model "${tableOwner.modelName}" and the implicit many-to-many relation "${relationField}" both use table "${tableOwner.namespaceId}"."${tableName}"; Prisma 7 creates the relation's table there and never creates the model's. Rename the model's table with @@map, which makes Prisma 7's next migration create it, or give the relation its own name with @relation("<name>") on both fields, which makes Prisma 7's next migration rebuild "${tableName}" as the model's table and create an empty table for the relation, losing the relation's rows.`;
      diagnostics.push(
        prisma7Diagnostic(
          'PSL.PRISMA7_TABLE_COLLISION',
          message,
          tableOwner.sourceId,
          tableOwner.tableSpan,
        ),
        prisma7Diagnostic(
          'PSL.PRISMA7_TABLE_COLLISION',
          message,
          first.requester.model.sourceId,
          first.requester.field.field.span,
        ),
      );
      continue;
    }
    for (const { requester, partner } of requests) {
      const junction = synthesizeJunction(requester, partner, naming, diagnostics);
      if (junction === undefined) continue;
      if (!junctions.has(junction.key)) {
        junctions.set(junction.key, junction.node);
        fkRelationMetadata.push(...junction.foreignKeys);
      }
      candidates.push({
        modelName: requester.model.modelName,
        tableName: requester.model.tableName,
        field: requester.field.field,
        targetModelName: partner.model.modelName,
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
  for (const key of junctions.keys()) {
    modelIdColumns.set(key, ['A', 'B']);
    modelUniqueColumnSets.set(key, [['A', 'B']]);
  }
  // Keep pairing groups per declaring file so every candidate field remains
  // covered by the document registry that owns its syntax node.
  const candidatesBySourceId = new Map<
    string,
    { readonly sources: PslSources; readonly candidates: ModelBackrelationCandidate[] }
  >();
  for (const candidate of candidates) {
    const model = models.get(candidate.modelName);
    if (model === undefined) continue;
    const group = candidatesBySourceId.get(model.sourceId) ?? {
      sources: model.sources,
      candidates: [],
    };
    candidatesBySourceId.set(model.sourceId, group);
    group.candidates.push(candidate);
  }
  for (const { sources, candidates: backrelationCandidates } of candidatesBySourceId.values()) {
    const pairingDiagnostics = createPslDiagnosticCollector(sources);
    applyBackrelationCandidates({
      backrelationCandidates,
      fkRelationsByPair,
      invalidFkPairings,
      fkRelationsByDeclaringModel,
      modelIdColumns,
      modelUniqueColumnSets,
      modelRelations,
      diagnostics: pairingDiagnostics,
      sources,
    });
    for (const diagnostic of pairingDiagnostics.toExternal()) {
      diagnostics.push(
        RELATION_PAIRING_CODES.has(diagnostic.code)
          ? {
              ...diagnostic,
              code: 'PSL.PRISMA7_RELATION_UNRESOLVED' satisfies Prisma7DiagnosticCode,
            }
          : diagnostic,
      );
    }
  }

  const relations = new Map<string, readonly RelationNode[]>();
  for (const [modelName, nodes] of modelRelations) {
    relations.set(
      modelName,
      [...nodes].sort((left, right) => left.fieldName.localeCompare(right.fieldName)),
    );
  }
  return { junctions, foreignKeys, relations };
}

interface SynthesizedJunction {
  readonly key: string;
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
  if (
    side.model.idFields.some(
      (name) => side.model.ignoredFields.has(name) || side.model.rejectedFields.has(name),
    )
  ) {
    return undefined;
  }
  const [idField, ...rest] = side.model.idFields;
  const column = idField === undefined ? undefined : side.model.columns.get(idField);
  if (column === undefined || rest.length > 0) {
    diagnostics.push(
      prisma7Diagnostic(
        'PSL.PRISMA7_JUNCTION_ID_UNSUPPORTED',
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
 * cascading foreign keys, with relation fields named as `contract infer` names
 * them. `A` is the model whose name is smaller in plain
 * string order; for a self-relation, the field whose name is smaller. This is
 * prisma-engines' rule (`psl/parser-database/src/relations.rs`,
 * `ingest_relation`: the side with the greater model name, or field name for a
 * self relation, is skipped so the smaller one owns `field_a`).
 */
function synthesizeJunction(
  requester: JunctionSide,
  partner: JunctionSide,
  naming: JunctionNaming,
  diagnostics: ContractSourceDiagnostic[],
): SynthesizedJunction | undefined {
  const [sideA, sideB] = orderJunctionSides(requester, partner);
  const requesterFirst = sideA === requester;
  const name =
    requester.field.attribute?.name ?? `${sideA.model.modelName}To${sideB.model.modelName}`;
  const idA = singleIdColumn(sideA, requester, diagnostics);
  const idB = singleIdColumn(sideB, requester, diagnostics);
  if (idA === undefined || idB === undefined) return undefined;

  const tableName = prisma7ConstraintName(`_${name}`, '', naming.identifierMaxBytes);
  const namespaceId = sideA.model.namespaceId;
  const key = junctionKey(namespaceId, name);
  const [relationFieldA, relationFieldB] = naming.junctionRelationFieldNames(
    sideA.model.tableName,
    sideB.model.tableName,
  );
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
    declaringModelName: key,
    declaringFieldName: column === 'A' ? relationFieldA : relationFieldB,
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
    map: prisma7ConstraintName(`_${name}`, '_B_index', naming.identifierMaxBytes),
    name: undefined,
  };
  return {
    key,
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
