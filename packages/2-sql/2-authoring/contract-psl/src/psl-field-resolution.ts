import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import type {
  ColumnDefault,
  ColumnDefaultLiteralInputValue,
  ExecutionMutationDefaultPhases,
} from '@internal/contract/types';
import type { AuthoringContributions } from '@internal/framework-components/authoring';
import type { CodecLookup } from '@internal/framework-components/codec';
import type { CapabilityMatrix } from '@internal/framework-components/components';
import type {
  ControlMutationDefaultRegistry,
  MutationDefaultGeneratorDescriptor,
} from '@internal/framework-components/control';
import type {
  FieldSymbol,
  ModelSymbol,
  ResolvedAttribute,
  SymbolTable,
} from '@internal/psl-parser';
import type { SourceFile } from '@internal/psl-parser/syntax';
import type { EnumTypeHandle } from '@internal/sql-contract-ts/contract-builder';
import { invariant } from '@internal/utils/assertions';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import {
  formatDbAttributeMigrationMessage,
  getAttribute,
  lowerFirst,
} from './psl-attribute-parsing';
import type { ColumnDescriptor, FieldPresetContributions } from './psl-column-resolution';
import {
  checkUncomposedNamespace,
  lowerDefaultForField,
  reportUncomposedNamespace,
  resolveFieldTypeDescriptor,
} from './psl-column-resolution';
import {
  fieldSpecContext,
  findFieldAttributeNode,
  findModelAttributeNode,
  interpretFieldAttribute,
  interpretModelAttribute,
  sqlAttributeSpecs,
} from './sql-attribute-specs';

type LoweredFieldDefault = {
  readonly defaultValue?: ColumnDefault;
  readonly executionDefaults?: ExecutionMutationDefaultPhases;
};

function lowerEnumDefaultForField(input: {
  readonly modelName: string;
  readonly fieldName: string;
  readonly field: FieldSymbol;
  readonly model: ModelSymbol;
  readonly symbolTable: SymbolTable;
  readonly sourceFile: SourceFile;
  readonly enumHandle: EnumTypeHandle;
  readonly sourceId: string;
  readonly defaultFunctionRegistry: ControlMutationDefaultRegistry;
  readonly diagnostics: ContractSourceDiagnostic[];
}): LoweredFieldDefault {
  const { field, model, sourceFile, enumHandle, sourceId, diagnostics } = input;
  const node = findFieldAttributeNode(field, 'default');
  if (node === undefined) return {};
  if (enumHandle.enumMembers.length === 0) return {};
  const spec = sqlAttributeSpecs.field.default(
    fieldSpecContext({
      symbols: input.symbolTable,
      model,
      field,
      controlMutationDefaults: input.defaultFunctionRegistry,
    }),
  );
  const interpreted = interpretFieldAttribute({
    node,
    spec,
    model,
    field,
    sourceFile,
    sourceId,
    diagnostics,
  });
  if (interpreted === undefined) return {};
  const member = interpreted.value;
  invariant(
    typeof member === 'string',
    'the enum @default grammar admits only member identifiers, so the parsed value is a string',
  );
  const match = enumHandle.enumMembers.find((m) => m.name === member);
  if (!match) return {};

  return {
    defaultValue: {
      kind: 'literal',
      value: blindCast<
        ColumnDefaultLiteralInputValue,
        'enum member values are codec-validated JsonValue-compatible scalars'
      >(match.value),
    },
  };
}

export type ResolvedField = {
  readonly field: FieldSymbol;
  readonly columnName: string;
  readonly descriptor: ColumnDescriptor;
  readonly nullable: boolean;
  readonly defaultValue?: ColumnDefault;
  readonly executionDefaults?: ExecutionMutationDefaultPhases;
  readonly isId: boolean;
  readonly isUnique: boolean;
  readonly idName?: string;
  readonly uniqueName?: string;
  readonly many?: true;
  /** Concrete generated-check kinds waived via `@noCheck`, resolved from the column's shape. */
  // Spelled literally because this package does not depend on
  // @internal/sql-schema-ir; the canonical alias is `CheckKind` there.
  readonly noCheck?: readonly ('membership' | 'elementNotNull')[];
  readonly valueObjectTypeName?: string;
  readonly scalarCodecId?: string;
};

export type ModelNameMapping = {
  readonly model: ModelSymbol;
  readonly tableName: string;
  readonly fieldColumns: Map<string, string>;
};

/**
 * A PSL model paired with its resolved namespace coordinate (undefined when
 * the target leaves the model late-bound). Two models may share a bare name
 * across namespaces, so structures that must distinguish them are keyed by
 * the `(namespaceId, modelName)` coordinate produced by
 * {@link modelCoordinateKey} rather than the bare model name.
 */
export type ModelNamespaceEntry = {
  readonly model: ModelSymbol;
  readonly namespaceId: string | undefined;
};

const MODEL_COORDINATE_SEPARATOR = '\u0000';

export function modelCoordinateKey(namespaceId: string, modelName: string): string {
  return `${namespaceId}${MODEL_COORDINATE_SEPARATOR}${modelName}`;
}

export interface CollectResolvedFieldsInput {
  readonly model: ModelSymbol;
  readonly symbolTable: SymbolTable;
  readonly mapping: ModelNameMapping;
  readonly enumTypeDescriptors: Map<string, ColumnDescriptor>;
  readonly namedTypeDescriptors: Map<string, ColumnDescriptor>;
  readonly modelNames: Set<string>;
  readonly compositeTypeNames: ReadonlySet<string>;
  readonly composedExtensions: Set<string>;
  readonly authoringContributions: AuthoringContributions | undefined;
  readonly familyId: string;
  readonly targetId: string;
  readonly defaultFunctionRegistry: ControlMutationDefaultRegistry;
  readonly generatorDescriptorById: ReadonlyMap<string, MutationDefaultGeneratorDescriptor>;
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly sourceId: string;
  readonly sourceFile: SourceFile;
  readonly scalarColumnDescriptors: ReadonlyMap<string, ColumnDescriptor>;
  readonly enumHandles?: ReadonlyMap<string, EnumTypeHandle>;
  readonly capabilities: CapabilityMatrix;
  /** The model's resolved namespace id — forwarded to `resolveFieldTypeDescriptor` for entity-ref value-set scoping. */
  readonly namespaceId?: string;
  /** Extension entities already lowered for this namespace — forwarded to `resolveFieldTypeDescriptor` for entity-ref type-constructor resolution (e.g. `pg.enum(Ref)`). */
  readonly namespaceExtensionEntities?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /** Codec-id-keyed descriptor lookup — forwarded to `resolveFieldTypeDescriptor` for entity-ref type-constructor resolution (e.g. `pg.enum(Ref)`). */
  readonly codecLookup?: CodecLookup;
}

/**
 * Per-attribute migration rule for attributes that have been removed
 * from PSL in favor of the field-preset surface. The `hint` text is
 * appended to the `PSL_UNSUPPORTED_FIELD_ATTRIBUTE` message so users
 * porting Prisma 6 schemas see "use this preset instead" inline; the
 * `suppressWhen` predicate skips the hint when the user has already
 * migrated (so they don't get told to do what they just did).
 *
 * Pairing the suppression predicate with the hint makes each entry
 * self-contained: a future entry for, say, `@id` ↔ `id.uuidv7String()` cannot
 * silently inherit the wrong predicate when added.
 */
interface RemovedAttributeRule {
  readonly hint: string;
  readonly suppressWhen: (field: FieldSymbol) => boolean;
}

const REMOVED_ATTRIBUTE_RULES: ReadonlyMap<string, RemovedAttributeRule> = new Map([
  [
    'updatedAt',
    {
      hint: 'Use `temporal.updatedAt()` as a field-preset call instead.',
      suppressWhen: (field) => field.typeConstructor?.path[0] === 'temporal',
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

function validateFieldAttributes(input: {
  readonly model: ModelSymbol;
  readonly field: FieldSymbol;
  readonly composedExtensions: ReadonlySet<string>;
  readonly authoringContributions: AuthoringContributions | undefined;
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly sourceId: string;
  readonly familyId: string;
  readonly targetId: string;
}): void {
  for (const attribute of input.field.attributes) {
    if (Object.hasOwn(sqlAttributeSpecs.field, attribute.name)) {
      continue;
    }

    if (attribute.name.startsWith('db.')) {
      input.diagnostics.push({
        code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
        message: formatDbAttributeMigrationMessage(attribute),
        sourceId: input.sourceId,
        span: attribute.span,
      });
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
        sourceId: input.sourceId,
        span: attribute.span,
        diagnostics: input.diagnostics,
      });
      continue;
    }

    const baseMessage = `Field "${input.model.name}.${input.field.name}" uses unsupported attribute "@${attribute.name}"`;
    const removedRule = REMOVED_ATTRIBUTE_RULES.get(attribute.name);
    const message =
      removedRule && !removedRule.suppressWhen(input.field)
        ? `${baseMessage}. ${removedRule.hint}`
        : baseMessage;

    input.diagnostics.push({
      code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
      message,
      sourceId: input.sourceId,
      span: attribute.span,
    });
  }
}

function extractFieldConstraintNames(input: {
  readonly model: ModelSymbol;
  readonly field: FieldSymbol;
  readonly sourceFile: SourceFile;
  readonly sourceId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
}): {
  readonly idAttribute: ResolvedAttribute | undefined;
  readonly uniqueAttribute: ResolvedAttribute | undefined;
  readonly idName: string | undefined;
  readonly uniqueName: string | undefined;
} {
  const idAttribute = getAttribute(input.field.attributes, 'id');
  const uniqueAttribute = getAttribute(input.field.attributes, 'unique');
  const idNode = findFieldAttributeNode(input.field, 'id');
  const idName =
    idNode === undefined
      ? undefined
      : interpretFieldAttribute({
          node: idNode,
          spec: sqlAttributeSpecs.field.id(),
          model: input.model,
          field: input.field,
          sourceFile: input.sourceFile,
          sourceId: input.sourceId,
          diagnostics: input.diagnostics,
        })?.map;
  const uniqueNode = findFieldAttributeNode(input.field, 'unique');
  const uniqueName =
    uniqueNode === undefined
      ? undefined
      : interpretFieldAttribute({
          node: uniqueNode,
          spec: sqlAttributeSpecs.field.unique(),
          model: input.model,
          field: input.field,
          sourceFile: input.sourceFile,
          sourceId: input.sourceId,
          diagnostics: input.diagnostics,
        })?.map;
  return { idAttribute, uniqueAttribute, idName, uniqueName };
}

// Spelled literally because this package does not depend on
// @internal/sql-schema-ir; the canonical alias is `CheckKind` there.
type NoCheckKind = 'membership' | 'elementNotNull';

/**
 * Interprets a field's `@noCheck` attribute and resolves it against the
 * column's shape: the bare form becomes every kind the shape derives, and a
 * named kind that can never apply is a spec-validation diagnostic on the
 * attribute node. Returns the concrete kinds in canonical ascending order —
 * the only form the definition tree carries.
 */
function lowerNoCheckForField(input: {
  readonly model: ModelSymbol;
  readonly field: FieldSymbol;
  readonly sourceFile: SourceFile;
  readonly sourceId: string;
  readonly isListField: boolean;
  readonly isDomainEnum: boolean;
  readonly diagnostics: ContractSourceDiagnostic[];
}): readonly NoCheckKind[] | undefined {
  const node = findFieldAttributeNode(input.field, 'noCheck');
  if (node === undefined) return undefined;
  const interpreted = interpretFieldAttribute({
    node,
    spec: sqlAttributeSpecs.field.noCheck(),
    model: input.model,
    field: input.field,
    sourceFile: input.sourceFile,
    sourceId: input.sourceId,
    diagnostics: input.diagnostics,
  });
  if (interpreted === undefined) return undefined;

  const span = getAttribute(input.field.attributes, 'noCheck')?.span ?? input.field.span;
  const subject = `Field "${input.model.name}.${input.field.name}"`;
  const derivable: NoCheckKind[] = [];
  if (input.isListField) derivable.push('elementNotNull');
  if (input.isDomainEnum) derivable.push('membership');

  const authored = [interpreted.first, interpreted.second].filter(
    (kind): kind is NoCheckKind => kind === 'membership' || kind === 'elementNotNull',
  );
  if (authored.length === 0) {
    if (derivable.length === 0) {
      input.diagnostics.push({
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        message: `${subject} @noCheck waives nothing — this column's shape derives no generated checks`,
        sourceId: input.sourceId,
        span,
      });
      return undefined;
    }
    return derivable;
  }
  for (const kind of authored) {
    if (!derivable.includes(kind)) {
      const explanation =
        kind === 'membership'
          ? 'membership checks are derived only from enum value sets'
          : 'element-non-null checks are derived only for list columns';
      input.diagnostics.push({
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        message: `${subject} @noCheck(${kind}) does not apply — ${explanation}`,
        sourceId: input.sourceId,
        span,
      });
      return undefined;
    }
  }
  return [...authored].sort();
}

export function collectResolvedFields(input: CollectResolvedFieldsInput): ResolvedField[] {
  const {
    model,
    symbolTable,
    mapping,
    enumTypeDescriptors,
    namedTypeDescriptors,
    modelNames,
    compositeTypeNames,
    composedExtensions,
    authoringContributions,
    familyId,
    targetId,
    defaultFunctionRegistry,
    generatorDescriptorById,
    diagnostics,
    sourceId,
    scalarColumnDescriptors,
    enumHandles,
    capabilities,
    namespaceId,
    namespaceExtensionEntities,
    codecLookup,
  } = input;
  const resolvedFields: ResolvedField[] = [];
  const valueObjectStorageTypeName = authoringContributions?.valueObjectStorageType;

  // Mirrors the TS build's tolerance for non-managed tables
  // (build-contract.ts, resolveNoCheckKinds call site): a table whose
  // source-declared policy is not `managed` derives no checks, so `@noCheck`
  // there is a no-op — neither shape-validated nor carried into the
  // definition tree. Only the model's own `@@control` matters here: on the
  // PSL path a contract-level default policy is a specifier concern, applied
  // after the build (`applySqlSpecifierControlPolicy`), where the same drop
  // semantics hold via the strip pass. The raw attribute argument is read
  // without interpreting the spec so a malformed `@@control` is diagnosed
  // once, by the interpreter's own model-attribute pass.
  const declaredControlPolicy = getAttribute(model.attributes, 'control')
    ?.args.find((arg) => arg.kind === 'positional')
    ?.value.trim();
  const modelDerivesChecks =
    declaredControlPolicy === undefined || declaredControlPolicy === 'managed';

  for (const field of Object.values(model.fields)) {
    const isModelField = modelNames.has(field.typeName);

    if (field.list && isModelField) {
      continue;
    }

    validateFieldAttributes({
      model,
      field,
      composedExtensions,
      authoringContributions,
      diagnostics,
      sourceId,
      familyId,
      targetId,
    });

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

    const isValueObjectField = compositeTypeNames.has(field.typeName);
    const isListField = field.list;

    let descriptor: ColumnDescriptor | undefined;
    let scalarCodecId: string | undefined;
    let presetContributions: FieldPresetContributions | undefined;
    const resolveInput = {
      field,
      enumTypeDescriptors,
      namedTypeDescriptors,
      scalarColumnDescriptors,
      authoringContributions,
      composedExtensions,
      familyId,
      targetId,
      diagnostics,
      sourceId,
      entityLabel: `Field "${model.name}.${field.name}"`,
      ...ifDefined('namespaceId', namespaceId),
      ...ifDefined('namespaceExtensionEntities', namespaceExtensionEntities),
      ...ifDefined('codecLookup', codecLookup),
    };

    if (isValueObjectField) {
      // A stack that declares no valueObjectStorageType has no value-object
      // storage — the field is skipped.
      descriptor =
        valueObjectStorageTypeName !== undefined
          ? scalarColumnDescriptors.get(valueObjectStorageTypeName)
          : undefined;
    } else if (isListField) {
      if (capabilities['sql']?.['scalarList'] !== true) {
        diagnostics.push({
          code: 'PSL_SCALAR_LIST_UNSUPPORTED_TARGET',
          message: `Field "${model.name}.${field.name}" is a scalar list, but target "${targetId}" does not support scalar lists (the adapter does not report the "scalarList" capability). Remove the list or author it against a target that supports scalar lists.`,
          sourceId,
          span: field.span,
        });
        continue;
      }
      const resolved = resolveFieldTypeDescriptor(resolveInput);
      if (!resolved.ok) {
        if (!resolved.alreadyReported) {
          diagnostics.push({
            code: 'PSL_UNSUPPORTED_FIELD_TYPE',
            message: `Field "${model.name}.${field.name}" type "${field.typeName}" is not supported in SQL PSL provider v1`,
            sourceId,
            span: field.span,
          });
        }
        continue;
      }
      // Field presets are complete declarations — they carry their own codec
      // and do not compose with `[]` list-of semantics. Reject early.
      if (resolved.presetContributions) {
        diagnostics.push({
          code: 'PSL_PRESET_NOT_LIST',
          message: `Field "${model.name}.${field.name}" uses a field-preset call as a list element type. Presets cannot be list elements; remove "[]" or use a scalar type.`,
          sourceId,
          span: field.span,
        });
        continue;
      }
      scalarCodecId = resolved.descriptor.codecId;
      descriptor = resolved.descriptor;
    } else {
      const resolved = resolveFieldTypeDescriptor(resolveInput);
      if (!resolved.ok) {
        if (!resolved.alreadyReported) {
          diagnostics.push({
            code: 'PSL_UNSUPPORTED_FIELD_TYPE',
            message: `Field "${model.name}.${field.name}" type "${field.typeName}" is not supported in SQL PSL provider v1`,
            sourceId,
            span: field.span,
          });
        }
        continue;
      }
      descriptor = resolved.descriptor;
      presetContributions = resolved.presetContributions;
    }

    if (!descriptor) {
      continue;
    }

    // Field presets are complete declarations: the preset names its own codec
    // and contributes any combination of default / executionDefaults / id /
    // unique. Optional and `@default(...)` modifiers contradict that, so they
    // are hard errors per spec FR7.
    if (presetContributions && field.optional) {
      diagnostics.push({
        code: 'PSL_PRESET_NOT_OPTIONAL',
        message: `Field "${model.name}.${field.name}" uses a field-preset call and cannot be optional. Remove "?" or use a different field type.`,
        sourceId,
        span: field.span,
      });
      continue;
    }

    const defaultAttribute = getAttribute(field.attributes, 'default');
    if (presetContributions && defaultAttribute) {
      diagnostics.push({
        code: 'PSL_PRESET_AND_DEFAULT_CONFLICT',
        message: `Field "${model.name}.${field.name}" uses a field-preset call and cannot also declare @default(...). The preset already specifies the default value.`,
        sourceId,
        span: defaultAttribute.span,
      });
      continue;
    }
    const enumHandle = enumHandles?.get(field.typeName);
    const loweredDefault: LoweredFieldDefault = defaultAttribute
      ? enumHandle
        ? lowerEnumDefaultForField({
            modelName: model.name,
            fieldName: field.name,
            field,
            model,
            symbolTable,
            sourceFile: input.sourceFile,
            enumHandle,
            sourceId,
            defaultFunctionRegistry,
            diagnostics,
          })
        : lowerDefaultForField({
            modelName: model.name,
            fieldName: field.name,
            field,
            model,
            symbolTable,
            sourceFile: input.sourceFile,
            columnDescriptor: descriptor,
            generatorDescriptorById,
            sourceId,
            defaultFunctionRegistry,
            diagnostics,
          })
      : {};
    const loweredOnCreate = loweredDefault.executionDefaults?.onCreate;
    const loweredFunctionDefault = loweredDefault.defaultValue?.kind === 'function';
    if (isListField && (loweredOnCreate || loweredFunctionDefault)) {
      const defaultExpression =
        defaultAttribute?.args.find((arg) => arg.kind === 'positional')?.value.trim() ??
        'this function';
      diagnostics.push({
        code: 'PSL_LIST_EXECUTION_DEFAULT_UNSUPPORTED',
        message: `Field "${model.name}.${field.name}" is a list and cannot use an execution default ("${defaultExpression}"). Lists have no per-element execution-default semantics; use a literal list @default or remove the default.`,
        sourceId,
        span: defaultAttribute?.span ?? field.span,
      });
      continue;
    }
    if (field.optional && loweredOnCreate) {
      const generatorDescription =
        loweredOnCreate.kind === 'generator' ? `"${loweredOnCreate.id}"` : 'for this field';
      diagnostics.push({
        code: 'PSL_INVALID_DEFAULT_FUNCTION_ARGUMENT',
        message: `Field "${model.name}.${field.name}" cannot be optional when using execution default ${generatorDescription}. Remove "?" or use a storage default.`,
        sourceId,
        span: defaultAttribute?.span ?? field.span,
      });
      continue;
    }
    const mappedColumnName = mapping.fieldColumns.get(field.name) ?? field.name;
    const { idAttribute, uniqueAttribute, idName, uniqueName } = extractFieldConstraintNames({
      model,
      field,
      sourceFile: input.sourceFile,
      sourceId,
      diagnostics,
    });
    let isIdField = Boolean(idAttribute);
    if (idAttribute && isListField) {
      diagnostics.push({
        code: 'PSL_LIST_ID_UNSUPPORTED',
        message: `Field "${model.name}.${field.name}" is a list and cannot be a primary key. Remove @id; a list cannot be an identity column.`,
        sourceId,
        span: idAttribute.span,
      });
      continue;
    }
    if (idAttribute && field.optional) {
      diagnostics.push({
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        message: `Field "${model.name}.${field.name}" @id cannot be optional; primary key columns must be NOT NULL`,
        sourceId,
        span: idAttribute.span,
      });
      isIdField = false;
    }

    // Field presets contribute their own default / executionDefaults / id /
    // unique. They take precedence over attribute-derived contributions for
    // this field, since a preset *is* the field declaration. Conflicts with
    // `@default` and optional are already rejected above; explicit `@id`
    // would be redundant noise on the resolved field, so we surface it as
    // a hard error here for symmetry.
    if (presetContributions && idAttribute && !presetContributions.id) {
      diagnostics.push({
        code: 'PSL_PRESET_AND_ID_CONFLICT',
        message: `Field "${model.name}.${field.name}" uses a field-preset call and cannot also declare @id. Use a preset that contributes id semantics, or drop @id.`,
        sourceId,
        span: idAttribute.span,
      });
      continue;
    }

    // Field-preset contributions take precedence over attribute-derived
    // sources when present.
    const fieldExecutionDefaults =
      presetContributions?.executionDefaults ?? loweredDefault.executionDefaults;
    const fieldDefaultValue = presetContributions?.default ?? loweredDefault.defaultValue;
    const noCheckKinds = modelDerivesChecks
      ? lowerNoCheckForField({
          model,
          field,
          sourceFile: input.sourceFile,
          sourceId,
          // The storage shape decides, not the PSL shape: a value-object list
          // lands in one JSONB column, which derives no generated checks, so
          // any waiver on it waives nothing and must be rejected here rather
          // than persisted as an inert flag.
          isListField: isListField && !isValueObjectField,
          isDomainEnum: enumHandle !== undefined,
          diagnostics,
        })
      : undefined;
    resolvedFields.push({
      field,
      columnName: mappedColumnName,
      descriptor,
      nullable: presetContributions?.nullable ?? field.optional,
      ...ifDefined('defaultValue', fieldDefaultValue),
      ...ifDefined('executionDefaults', fieldExecutionDefaults),
      isId: isIdField || Boolean(presetContributions?.id),
      isUnique: Boolean(uniqueAttribute) || Boolean(presetContributions?.unique),
      ...ifDefined('idName', idName),
      ...ifDefined('uniqueName', uniqueName),
      ...ifDefined('many', isListField ? (true as const) : undefined),
      ...ifDefined('noCheck', noCheckKinds),
      ...ifDefined('valueObjectTypeName', isValueObjectField ? field.typeName : undefined),
      ...ifDefined('scalarCodecId', scalarCodecId),
    });
  }

  return resolvedFields;
}

export function buildModelMappings(
  modelEntries: readonly ModelNamespaceEntry[],
  defaultNamespaceId: string,
  diagnostics: ContractSourceDiagnostic[],
  sourceId: string,
  sourceFile: SourceFile,
): Map<string, ModelNameMapping> {
  const result = new Map<string, ModelNameMapping>();
  for (const { model, namespaceId } of modelEntries) {
    const mapNode = findModelAttributeNode(model, 'map');
    const tableName =
      mapNode === undefined
        ? lowerFirst(model.name)
        : (interpretModelAttribute({
            node: mapNode,
            spec: sqlAttributeSpecs.model.map(),
            model,
            sourceFile,
            sourceId,
            diagnostics,
          })?.name ?? lowerFirst(model.name));
    const fieldColumns = new Map<string, string>();
    for (const field of Object.values(model.fields)) {
      const fieldMapNode = findFieldAttributeNode(field, 'map');
      const columnName =
        fieldMapNode === undefined
          ? field.name
          : (interpretFieldAttribute({
              node: fieldMapNode,
              spec: sqlAttributeSpecs.field.map(),
              model,
              field,
              sourceFile,
              sourceId,
              diagnostics,
            })?.name ?? field.name);
      fieldColumns.set(field.name, columnName);
    }
    result.set(modelCoordinateKey(namespaceId ?? defaultNamespaceId, model.name), {
      model,
      tableName,
      fieldColumns,
    });
  }
  return result;
}
