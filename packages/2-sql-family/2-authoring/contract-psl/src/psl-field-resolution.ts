import type { ExecutionMutationDefaultPhases } from '@internal/contract/types';
import type {
  AuthoringContributions,
  DataTypeSupport,
} from '@internal/framework-components/authoring';
import type { CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import type {
  CapabilityMatrix,
  GeneratorFunctionRegistry,
} from '@internal/framework-components/components';
import type { ControlMutationDefaultRegistry } from '@internal/framework-components/control';
import type {
  Binder,
  BlockSymbol,
  DescribeUnsupportedAttribute,
  FieldAttributeSpecContext,
  FieldSymbol,
  ModelSymbol,
  ResolvedAttribute,
  SymbolTable,
} from '@internal/psl-parser';
import {
  diagnosticSource,
  type PslDiagnosticCollector,
  refuseRepeatedTypeAliasAttributes,
  typeReferenceNode,
} from '@internal/psl-parser';
import type { PslSources } from '@internal/psl-parser/syntax';
import {
  type AuthoredColumnDefault,
  type EnumTypeHandle,
  storedAsListColumn,
} from '@internal/sql-contract-ts/contract-builder';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import {
  formatDbAttributeMigrationMessage,
  getAttribute,
  storageName,
} from './psl-attribute-parsing';
import type { ColumnDescriptor } from './psl-column-resolution';
import {
  fieldAttributeOwner,
  lowerDefaultForField,
  lowerEnumDefault,
  lowerGeneratorAttributesForField,
  resolveFieldTypeDescriptor,
} from './psl-column-resolution';
import type { ResolvedTypeAliases } from './psl-named-type-resolution';
import {
  fieldSpecContext,
  interpretFieldAttribute,
  sqlAttributeSpecs,
} from './sql-attribute-specs';
import type { ValueObjectTypes } from './value-object-default';

type LoweredFieldDefault = {
  readonly defaultValue?: AuthoredColumnDefault;
};

export type ResolvedField = {
  readonly field: FieldSymbol;
  readonly columnName: string;
  readonly descriptor: ColumnDescriptor;
  readonly nullable: boolean;
  readonly defaultValue?: AuthoredColumnDefault;
  readonly executionDefaults?: ExecutionMutationDefaultPhases;
  readonly isId: boolean;
  readonly isUnique: boolean;
  readonly idName?: string;
  readonly uniqueName?: string;
  readonly many?: true;
  readonly elementNullable?: true;
  readonly valueObjectTypeName?: string;
  readonly enumTypeHandle?: EnumTypeHandle;
};

/**
 * A PSL model paired with its resolved namespace coordinate. Two models may share a bare name
 * across namespaces, so structures that must distinguish them are keyed by
 * the `(namespaceId, modelName)` coordinate produced by
 * {@link modelCoordinateKey} rather than the bare model name.
 */
export type ModelNamespaceEntry = {
  readonly model: ModelSymbol;
  readonly namespaceId: string;
};

const MODEL_COORDINATE_SEPARATOR = '\u0000';

export function modelCoordinateKey(namespaceId: string, modelName: string): string {
  return `${namespaceId}${MODEL_COORDINATE_SEPARATOR}${modelName}`;
}

export interface CollectResolvedFieldsInput {
  readonly model: ModelSymbol;
  readonly physicalNames: ReadonlyMap<ModelSymbol | FieldSymbol, string>;
  readonly symbolTable: SymbolTable;
  readonly enumTypeDescriptors: ReadonlyMap<BlockSymbol, ColumnDescriptor>;
  readonly typeAliases: ResolvedTypeAliases;
  /** The value objects the composite types declare, by name. */
  readonly valueObjectTypes: ValueObjectTypes;
  readonly authoringContributions: AuthoringContributions | undefined;
  readonly targetId: string;
  readonly defaultFunctionRegistry: ControlMutationDefaultRegistry;
  readonly generatorFunctions: GeneratorFunctionRegistry;
  readonly dataTypes: DataTypeSupport;
  readonly diagnostics: PslDiagnosticCollector;
  /** Collects each field left out because its type did not resolve, so the contract is not built without it. */
  readonly droppedFields: Set<FieldSymbol>;
  readonly sources: PslSources;
  readonly binder: Binder;
  readonly scalarColumnDescriptors: ReadonlyMap<string, ColumnDescriptor>;
  readonly enumHandles: ReadonlyMap<BlockSymbol, EnumTypeHandle>;
  readonly capabilities: CapabilityMatrix;
  /** The model's resolved namespace id — forwarded to `resolveFieldTypeDescriptor` for entity-ref value-set scoping. */
  readonly namespaceId?: string;
  /** Extension entities already lowered, keyed by namespace id — forwarded to `resolveFieldTypeDescriptor` for entity-ref type-constructor resolution (e.g. `pg.enum(Ref)`). */
  readonly namespaceExtensionEntities?: ReadonlyMap<
    string,
    Readonly<Record<string, Readonly<Record<string, unknown>>>>
  >;
  /** Codec-id-keyed descriptor lookup — forwarded to `resolveFieldTypeDescriptor` for entity-ref type-constructor resolution (e.g. `pg.enum(Ref)`). */
  readonly codecLookup: CodecLookupWithDescriptors;
}

/**
 * A Prisma 6 field attribute that Prisma 8 PSL removed. The `hint`, what to write instead, is appended to the `PSL_UNSUPPORTED_FIELD_ATTRIBUTE` message, unless `suppressWhen` says the field already writes it.
 */
interface RemovedAttributeRule {
  readonly hint: string;
  readonly suppressWhen: (field: FieldSymbol) => boolean;
}

const GENERATOR_ATTRIBUTE_NAMES = ['onCreate', 'onUpdate'] as const;

const REMOVED_ATTRIBUTE_RULES: ReadonlyMap<string, RemovedAttributeRule> = new Map([
  [
    'updatedAt',
    {
      hint: 'Use @onCreate(now()) @onUpdate(now()), or type the field temporal.UpdatedAt.',
      suppressWhen: (field) => field.attributes.some((attribute) => attribute.name === 'onUpdate'),
    },
  ],
]);

{
  const overlap = [...REMOVED_ATTRIBUTE_RULES.keys()].filter((name) =>
    Object.hasOwn(sqlAttributeSpecs.field, name),
  );
  if (overlap.length > 0) {
    throw new InternalError(
      `Registered SQL field attributes and REMOVED_ATTRIBUTE_RULES must not overlap. Names in both: ${overlap.join(', ')}`,
    );
  }
}

export function describeUnsupportedSqlAttribute(sources: PslSources): DescribeUnsupportedAttribute {
  return ({ attribute, level, owner, field }) => {
    // A composite type takes no attributes at all; `buildValueObjectNodes` refuses each one once.
    if (owner.kind === 'compositeType') return undefined;
    if (owner.kind === 'mixin' && owner.keyword === 'type') return undefined;
    if (level === 'model') {
      const source = diagnosticSource(sources, owner.node.syntax);
      return {
        code: 'PSL_UNSUPPORTED_MODEL_ATTRIBUTE',
        message: `${owner.kind === 'mixin' ? 'Mixin' : 'Model'} "${owner.name}" uses unsupported attribute "@@${attribute.name}"`,
        ...source.at(attribute.span),
      };
    }

    if (field === undefined) return undefined;
    const source = diagnosticSource(sources, field.node.syntax);

    if (attribute.name.startsWith('db.')) {
      return {
        code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
        message: formatDbAttributeMigrationMessage(attribute),
        ...source.at(attribute.span),
      };
    }

    const baseMessage = `Field "${owner.name}.${field.name}" uses unsupported attribute "@${attribute.name}"`;
    const removedRule = REMOVED_ATTRIBUTE_RULES.get(attribute.name);
    const message =
      removedRule && !removedRule.suppressWhen(field)
        ? `${baseMessage}. ${removedRule.hint}`
        : baseMessage;

    return {
      code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
      message,
      ...source.at(attribute.span),
    };
  };
}

function extractFieldConstraintNames(input: {
  readonly symbolTable: SymbolTable;
  readonly model: ModelSymbol;
  readonly field: FieldSymbol;
  readonly specContext: FieldAttributeSpecContext;
  readonly sources: PslSources;
  readonly binder: Binder;
  readonly diagnostics: PslDiagnosticCollector;
}): {
  readonly idAttribute: ResolvedAttribute | undefined;
  readonly uniqueAttribute: ResolvedAttribute | undefined;
  readonly idName: string | undefined;
  readonly uniqueName: string | undefined;
} {
  const idAttribute = getAttribute(input.field.attributes, 'id');
  const uniqueAttribute = getAttribute(input.field.attributes, 'unique');
  const idNode = getAttribute(input.field.attributes, 'id')?.node;
  const idName =
    idNode === undefined
      ? undefined
      : interpretFieldAttribute({
          node: idNode,
          symbols: input.symbolTable,
          spec: sqlAttributeSpecs.field.id(input.specContext),
          model: input.model,
          field: input.field,
          sources: input.sources,
          binder: input.binder,
          diagnostics: input.diagnostics,
        })?.map;
  const uniqueNode = getAttribute(input.field.attributes, 'unique')?.node;
  const uniqueName =
    uniqueNode === undefined
      ? undefined
      : interpretFieldAttribute({
          node: uniqueNode,
          symbols: input.symbolTable,
          spec: sqlAttributeSpecs.field.unique(input.specContext),
          model: input.model,
          field: input.field,
          sources: input.sources,
          binder: input.binder,
          diagnostics: input.diagnostics,
        })?.map;
  return { idAttribute, uniqueAttribute, idName, uniqueName };
}

export function collectResolvedFields(input: CollectResolvedFieldsInput): ResolvedField[] {
  const {
    model,
    symbolTable,
    enumTypeDescriptors,
    typeAliases,
    valueObjectTypes,
    authoringContributions,
    binder,
    targetId,
    defaultFunctionRegistry,
    generatorFunctions,
    dataTypes,
    diagnostics,
    droppedFields,
    sources,
    scalarColumnDescriptors,
    enumHandles,
    capabilities,
    namespaceId,
    namespaceExtensionEntities,
    codecLookup,
  } = input;
  const resolvedFields: ResolvedField[] = [];
  const valueObjectStorageTypeName = authoringContributions?.valueObjectStorageType;

  for (const field of Object.values(model.fields)) {
    const source = diagnosticSource(sources, field.node.syntax);
    const fieldTypeReference = typeReferenceNode(field);
    const fieldTypeResolution =
      fieldTypeReference === undefined ? undefined : binder.symbolForNode(fieldTypeReference);
    const isModelField = fieldTypeResolution?.kind === 'model';

    if (field.list && isModelField) {
      continue;
    }

    const relationAttribute = getAttribute(field.attributes, 'relation');
    if (isModelField && relationAttribute) {
      continue;
    }
    // Cross-contract-space relation fields (e.g. `supabase:auth.User @relation(...)`) are not
    // local model fields, but they carry a @relation attribute and should be skipped here.
    // Their FK and RelationNode lowering is handled separately in the interpreter.
    if (field.typeContractSpaceId !== undefined && relationAttribute) {
      continue;
    }
    // A model-typed, non-list field with no `@relation` is the back side of a
    // 1:1 relation — the owning side always carries `@relation(fields: [...],
    // references: [...])`. It is lowered separately, via the interpreter's
    // backrelation-candidate matching, not as a scalar column here.
    if (isModelField) {
      continue;
    }

    const valueObjectName =
      fieldTypeResolution?.kind === 'compositeType' ? fieldTypeResolution.symbol.name : undefined;
    const isValueObjectField = valueObjectName !== undefined;
    const isListField = field.list;
    const isListColumn = storedAsListColumn({
      list: isListField,
      typedByValueObject: isValueObjectField,
    });

    let descriptor: ColumnDescriptor | undefined;
    const resolveInput = {
      field,
      resolution: fieldTypeResolution,
      enumTypeDescriptors,
      typeAliases,
      diagnostics,
      sources,
      entityLabel: `Field "${model.name}.${field.name}"`,
      ...ifDefined('namespaceId', namespaceId),
      ...ifDefined('namespaceExtensionEntities', namespaceExtensionEntities),
      binder,
      codecLookup,
      dataTypes,
    };

    if (isValueObjectField) {
      if (valueObjectStorageTypeName === undefined) {
        diagnostics.push({
          code: 'PSL_UNSUPPORTED_FIELD_TYPE',
          message: `Field "${model.name}.${field.name}" is typed by the composite type "${field.typeName}", but the adapter of the stack declares no storage type for value objects, so the field has no column to be stored in.`,
          ...source.at(field.span),
        });
        continue;
      }
      descriptor = scalarColumnDescriptors.get(valueObjectStorageTypeName);
      if (descriptor === undefined) {
        throw new InternalError(
          `The stack declares "${valueObjectStorageTypeName}" as its value-object storage type, but it is not one of the stack's scalar types; the control stack checks this when it is assembled.`,
        );
      }
    } else if (isListField) {
      if (capabilities['sql']?.['scalarList'] !== true) {
        diagnostics.push({
          code: 'PSL_SCALAR_LIST_UNSUPPORTED_TARGET',
          message: `Field "${model.name}.${field.name}" is a scalar list, but target "${targetId}" does not support scalar lists (the adapter does not report the "scalarList" capability). Remove the list or author it against a target that supports scalar lists.`,
          ...source.at(field.span),
        });
        continue;
      }
      const resolved = resolveFieldTypeDescriptor(resolveInput);
      if (!resolved.ok) {
        droppedFields.add(field);
        continue;
      }
      descriptor = resolved.descriptor;
    } else {
      const resolved = resolveFieldTypeDescriptor(resolveInput);
      if (!resolved.ok) {
        droppedFields.add(field);
        continue;
      }
      descriptor = resolved.descriptor;
    }

    if (!descriptor) {
      continue;
    }

    const typeAlias = typeAliases.ofResolution(fieldTypeResolution);
    if (typeAlias !== undefined) {
      refuseRepeatedTypeAliasAttributes({
        field,
        fieldPath: `${model.name}.${field.name}`,
        alias: typeAlias.alias,
        sources,
        diagnostics,
      });
    }

    const defaultAttribute = getAttribute(field.attributes, 'default');
    const enumHandle =
      fieldTypeResolution?.kind === 'block'
        ? enumHandles.get(fieldTypeResolution.symbol)
        : typeAlias?.enumHandle;
    const fieldLowering = {
      modelName: model.name,
      fieldName: field.name,
      field,
      model,
      symbolTable,
      sources: input.sources,
      binder: input.binder,
      defaultFunctionRegistry,
      generatorFunctions,
      dataTypes,
      diagnostics,
    };
    const ownDefault: LoweredFieldDefault = defaultAttribute
      ? enumHandle
        ? lowerEnumDefault({
            ...fieldLowering,
            owner: fieldAttributeOwner(fieldLowering),
            enumHandle,
          })
        : lowerDefaultForField({
            ...fieldLowering,
            columnDescriptor: descriptor,
            columnTypeParams: descriptor.typeParams,
            isListColumn,
            valueObjectDefault:
              valueObjectName === undefined
                ? undefined
                : { valueObjectName, types: valueObjectTypes },
            codecLookup,
          })
      : {};
    if (isListField && typeAlias?.defaultValue !== undefined) {
      diagnostics.push({
        code: 'PSL_DEFAULT_LIST_EXPECTED',
        message: `Field "${model.name}.${field.name}" is a list, but its type alias "${typeAlias.name}" sets @default for a single value. Remove "[]" or the @default of the alias.`,
        ...source.at(field.span),
      });
      continue;
    }
    const loweredDefault: LoweredFieldDefault = {
      ...ifDefined('defaultValue', typeAlias?.defaultValue ?? ownDefault.defaultValue),
    };
    const generatedValues = mergeExecutionDefaults(
      lowerGeneratorAttributesForField({
        ...fieldLowering,
        columnDescriptor: descriptor,
        columnTypeParams: descriptor.typeParams,
      }),
      typeAlias?.executionDefaults,
    );
    if (
      isListField &&
      loweredDefault.defaultValue?.kind === 'function' &&
      loweredDefault.defaultValue.expression === 'autoincrement()'
    ) {
      diagnostics.push({
        code: 'PSL_LIST_AUTOINCREMENT_UNSUPPORTED',
        message: `Field "${model.name}.${field.name}" is a list and cannot use autoincrement(); it is a Prisma marker for a sequence-backed scalar column, not SQL.`,
        ...source.at(defaultAttribute?.span ?? field.span),
      });
      continue;
    }
    const ownGeneratorAttribute = GENERATOR_ATTRIBUTE_NAMES.map((name) =>
      getAttribute(field.attributes, name),
    ).find((attribute) => attribute !== undefined);
    if (isListField && generatedValues !== undefined) {
      const fieldLabel = `Field "${model.name}.${field.name}"`;
      const perElement = 'Lists have no per-element generated values;';
      const call =
        ownGeneratorAttribute?.args.find((arg) => arg.kind === 'positional')?.value.trim() ?? '';
      diagnostics.push({
        code: 'PSL_LIST_EXECUTION_DEFAULT_UNSUPPORTED',
        message:
          ownGeneratorAttribute === undefined
            ? `${fieldLabel} is a list, and its type alias "${typeAlias?.name}" generates a value. ${perElement} remove "[]" or type the field without the alias.`
            : `${fieldLabel} is a list and cannot use @${ownGeneratorAttribute.name}(${call}). ${perElement} remove @${ownGeneratorAttribute.name}(...).`,
        ...source.at(ownGeneratorAttribute?.span ?? field.span),
      });
      continue;
    }
    const mappedColumnName = storageName(field, input.physicalNames);
    const specContext = fieldSpecContext({
      symbols: symbolTable,
      model,
      field,
      binder,
      defaultFunctionRegistry,
      generatorFunctions,
      dataTypes,
    });
    const { idAttribute, uniqueAttribute, idName, uniqueName } = extractFieldConstraintNames({
      symbolTable: input.symbolTable,
      model,
      field,
      specContext,
      sources: input.sources,
      binder: input.binder,
      diagnostics,
    });
    let isIdField = Boolean(idAttribute);
    if (idAttribute && isListField) {
      diagnostics.push({
        code: 'PSL_LIST_ID_UNSUPPORTED',
        message: `Field "${model.name}.${field.name}" is a list and cannot be a primary key. Remove @id; a list cannot be an identity column.`,
        ...source.at(idAttribute.span),
      });
      continue;
    }
    if (idAttribute && field.optional) {
      diagnostics.push({
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        message: `Field "${model.name}.${field.name}" @id cannot be optional; primary key columns must be NOT NULL`,
        ...source.at(idAttribute.span),
      });
      isIdField = false;
    }

    resolvedFields.push({
      field,
      columnName: mappedColumnName,
      descriptor,
      nullable: field.optional,
      ...ifDefined('defaultValue', loweredDefault.defaultValue),
      ...ifDefined('executionDefaults', generatedValues),
      isId: isIdField,
      isUnique: Boolean(uniqueAttribute),
      ...ifDefined('idName', idName),
      ...ifDefined('uniqueName', uniqueName),
      ...ifDefined('many', isListField ? (true as const) : undefined),
      ...ifDefined('elementNullable', field.elementOptional ? (true as const) : undefined),
      ...ifDefined('valueObjectTypeName', valueObjectName),
      ...ifDefined('enumTypeHandle', enumHandle),
    });
  }

  return resolvedFields;
}

function mergeExecutionDefaults(
  fromAttributes: ExecutionMutationDefaultPhases | undefined,
  fromTypeAlias: ExecutionMutationDefaultPhases | undefined,
): ExecutionMutationDefaultPhases | undefined {
  if (fromAttributes === undefined || fromTypeAlias === undefined) {
    return fromTypeAlias ?? fromAttributes;
  }
  return { ...fromAttributes, ...fromTypeAlias };
}
