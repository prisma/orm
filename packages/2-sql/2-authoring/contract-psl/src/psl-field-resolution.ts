import type {
  ColumnDefaultLiteralInputValue,
  ExecutionMutationDefaultPhases,
} from '@internal/contract/types';
import type {
  AuthoringContributions,
  DataTypeSupport,
} from '@internal/framework-components/authoring';
import type { CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import type { CapabilityMatrix } from '@internal/framework-components/components';
import type {
  ControlMutationDefaultRegistry,
  MutationDefaultGeneratorDescriptor,
} from '@internal/framework-components/control';
import type {
  Binder,
  BlockSymbol,
  DescribeUnsupportedAttribute,
  FieldAttributeSpecContext,
  FieldSymbol,
  ModelSymbol,
  NamedTypeSymbol,
  ResolvedAttribute,
  SymbolTable,
} from '@internal/psl-parser';
import {
  diagnosticSource,
  type PslDiagnosticCollector,
  typeReferenceNode,
} from '@internal/psl-parser';
import type { PslSources } from '@internal/psl-parser/syntax';
import {
  type AuthoredColumnDefault,
  type EnumTypeHandle,
  storedAsListColumn,
} from '@internal/sql-contract-ts/contract-builder';
import { invariant } from '@internal/utils/assertions';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import {
  formatDbAttributeMigrationMessage,
  getAttribute,
  storageName,
} from './psl-attribute-parsing';
import type { ColumnDescriptor, FieldPresetContributions } from './psl-column-resolution';
import {
  lowerDefaultForField,
  rejectStrictListNullDefault,
  resolveFieldTypeDescriptor,
} from './psl-column-resolution';
import {
  fieldSpecContext,
  interpretFieldAttribute,
  sqlAttributeSpecs,
} from './sql-attribute-specs';
import type { ValueObjectTypes } from './value-object-default';

type LoweredFieldDefault = {
  readonly defaultValue?: AuthoredColumnDefault;
  readonly executionDefaults?: ExecutionMutationDefaultPhases;
};

function lowerEnumDefaultForField(input: {
  readonly modelName: string;
  readonly fieldName: string;
  readonly field: FieldSymbol;
  readonly model: ModelSymbol;
  readonly symbolTable: SymbolTable;
  readonly sources: PslSources;
  readonly binder: Binder;
  readonly enumHandle: EnumTypeHandle;
  readonly defaultFunctionRegistry: ControlMutationDefaultRegistry;
  readonly dataTypes: DataTypeSupport;
  readonly diagnostics: PslDiagnosticCollector;
}): LoweredFieldDefault {
  const { field, model, enumHandle, diagnostics } = input;
  const node = getAttribute(field.attributes, 'default')?.node;
  if (node === undefined) return {};
  if (enumHandle.enumMembers.length === 0) return {};
  const spec = sqlAttributeSpecs.field.default(
    fieldSpecContext({
      symbols: input.symbolTable,
      model,
      field,
      binder: input.binder,
      defaultFunctionRegistry: input.defaultFunctionRegistry,
      dataTypes: input.dataTypes,
    }),
  );
  const interpreted = interpretFieldAttribute({
    node,
    spec,
    symbols: input.symbolTable,
    model,
    field,
    sources: input.sources,
    binder: input.binder,
    diagnostics,
  });
  if (interpreted === undefined) return {};
  const member = interpreted.value;
  if (member.kind === 'member-list') {
    if (
      rejectStrictListNullDefault({
        ...input,
        elements: member.elements,
        source: diagnosticSource(input.sources, node.syntax),
      })
    )
      return {};
    const values = member.elements.map((entry) =>
      entry.kind === 'null'
        ? null
        : enumHandle.enumMembers.find((candidate) => candidate.name === entry.name)?.value,
    );
    return {
      defaultValue: {
        kind: 'literal',
        value: blindCast<
          ColumnDefaultLiteralInputValue,
          'enum member values are codec-validated JsonValue-compatible scalars'
        >(values),
      },
    };
  }
  invariant(member.kind === 'member', 'the enum @default grammar admits only member identifiers');
  const match = enumHandle.enumMembers.find((m) => m.name === member.name);
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
  readonly defaultValue?: AuthoredColumnDefault;
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
  readonly elementNullable?: true;
  readonly valueObjectTypeName?: string;
  readonly enumTypeHandle?: EnumTypeHandle;
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
  readonly physicalNames: ReadonlyMap<ModelSymbol | FieldSymbol, string>;
  readonly symbolTable: SymbolTable;
  readonly enumTypeDescriptors: ReadonlyMap<BlockSymbol, ColumnDescriptor>;
  readonly namedTypeDescriptors: ReadonlyMap<NamedTypeSymbol, ColumnDescriptor>;
  /** The value objects the composite types declare, by name. */
  readonly valueObjectTypes: ValueObjectTypes;
  readonly authoringContributions: AuthoringContributions | undefined;
  readonly targetId: string;
  readonly defaultFunctionRegistry: ControlMutationDefaultRegistry;
  readonly dataTypes: DataTypeSupport;
  readonly generatorDescriptorById: ReadonlyMap<string, MutationDefaultGeneratorDescriptor>;
  readonly diagnostics: PslDiagnosticCollector;
  readonly sources: PslSources;
  readonly binder: Binder;
  readonly scalarColumnDescriptors: ReadonlyMap<string, ColumnDescriptor>;
  readonly enumHandles: ReadonlyMap<BlockSymbol, EnumTypeHandle>;
  readonly capabilities: CapabilityMatrix;
  /** The model's resolved namespace id — forwarded to `resolveFieldTypeDescriptor` for entity-ref value-set scoping. */
  readonly namespaceId?: string;
  /** Extension entities already lowered for this namespace — forwarded to `resolveFieldTypeDescriptor` for entity-ref type-constructor resolution (e.g. `pg.enum(Ref)`). */
  readonly namespaceExtensionEntities?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /** Codec-id-keyed descriptor lookup — forwarded to `resolveFieldTypeDescriptor` for entity-ref type-constructor resolution (e.g. `pg.enum(Ref)`). */
  readonly codecLookup?: CodecLookupWithDescriptors;
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

export function describeUnsupportedSqlAttribute(sources: PslSources): DescribeUnsupportedAttribute {
  return ({ attribute, level, owner, field }) => {
    // A composite type takes no attributes at all; `buildValueObjectNodes` refuses each one once.
    if (owner.kind === 'compositeType') return undefined;
    if (level === 'model') {
      const source = diagnosticSource(sources, owner.node.syntax);
      return {
        code: 'PSL_UNSUPPORTED_MODEL_ATTRIBUTE',
        message: `Model "${owner.name}" uses unsupported attribute "@@${attribute.name}"`,
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
  readonly symbolTable: SymbolTable;
  readonly model: ModelSymbol;
  readonly field: FieldSymbol;
  readonly specContext: FieldAttributeSpecContext;
  readonly sources: PslSources;
  readonly binder: Binder;
  readonly isListColumn: boolean;
  readonly elementNullable: boolean;
  readonly isDomainEnum: boolean;
  readonly diagnostics: PslDiagnosticCollector;
}): readonly NoCheckKind[] | undefined {
  const node = getAttribute(input.field.attributes, 'noCheck')?.node;
  if (node === undefined) return undefined;
  const interpreted = interpretFieldAttribute({
    node,
    spec: sqlAttributeSpecs.field.noCheck(input.specContext),
    symbols: input.symbolTable,
    model: input.model,
    field: input.field,
    sources: input.sources,
    binder: input.binder,
    diagnostics: input.diagnostics,
  });
  if (interpreted === undefined) return undefined;

  const span = getAttribute(input.field.attributes, 'noCheck')?.span ?? input.field.span;
  const subject = `Field "${input.model.name}.${input.field.name}"`;
  const derivable: NoCheckKind[] = [];
  if (input.isListColumn && !input.elementNullable) derivable.push('elementNotNull');
  if (input.isDomainEnum) derivable.push('membership');

  const authored = [interpreted.first, interpreted.second].filter(
    (kind): kind is NoCheckKind => kind === 'membership' || kind === 'elementNotNull',
  );
  if (authored.length === 0) {
    if (derivable.length === 0) {
      input.diagnostics.push({
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        message: `${subject} @noCheck waives nothing — this column's shape derives no generated checks`,
        ...diagnosticSource(input.sources, input.field.node.syntax).at(span),
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
          : 'element-non-null checks are derived only for lists whose elements are semantically non-null';
      input.diagnostics.push({
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        message: `${subject} @noCheck(${kind}) does not apply — ${explanation}`,
        ...diagnosticSource(input.sources, input.field.node.syntax).at(span),
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
    enumTypeDescriptors,
    namedTypeDescriptors,
    valueObjectTypes,
    authoringContributions,
    binder,
    targetId,
    defaultFunctionRegistry,
    dataTypes,
    generatorDescriptorById,
    diagnostics,
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
    let presetContributions: FieldPresetContributions | undefined;
    const resolveInput = {
      field,
      resolution: fieldTypeResolution,
      enumTypeDescriptors,
      namedTypeDescriptors,
      diagnostics,
      sources,
      entityLabel: `Field "${model.name}.${field.name}"`,
      ...ifDefined('namespaceId', namespaceId),
      ...ifDefined('namespaceExtensionEntities', namespaceExtensionEntities),
      ...ifDefined('codecLookup', codecLookup),
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
        continue;
      }
      // Field presets are complete declarations — they carry their own codec
      // and do not compose with `[]` list-of semantics. Reject early.
      if (resolved.presetContributions) {
        diagnostics.push({
          code: 'PSL_PRESET_NOT_LIST',
          message: `Field "${model.name}.${field.name}" uses a field-preset call as a list element type. Presets cannot be list elements; remove "[]" or use a scalar type.`,
          ...source.at(field.span),
        });
        continue;
      }
      descriptor = resolved.descriptor;
    } else {
      const resolved = resolveFieldTypeDescriptor(resolveInput);
      if (!resolved.ok) {
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
        ...source.at(field.span),
      });
      continue;
    }

    const defaultAttribute = getAttribute(field.attributes, 'default');
    if (presetContributions && defaultAttribute) {
      diagnostics.push({
        code: 'PSL_PRESET_AND_DEFAULT_CONFLICT',
        message: `Field "${model.name}.${field.name}" uses a field-preset call and cannot also declare @default(...). The preset already specifies the default value.`,
        ...source.at(defaultAttribute.span),
      });
      continue;
    }
    const enumHandle =
      fieldTypeResolution?.kind === 'block'
        ? enumHandles.get(fieldTypeResolution.symbol)
        : undefined;
    const loweredDefault: LoweredFieldDefault = defaultAttribute
      ? enumHandle
        ? lowerEnumDefaultForField({
            modelName: model.name,
            fieldName: field.name,
            field,
            model,
            symbolTable,
            sources: input.sources,
            binder: input.binder,
            enumHandle,
            defaultFunctionRegistry,
            dataTypes,
            diagnostics,
          })
        : lowerDefaultForField({
            modelName: model.name,
            fieldName: field.name,
            field,
            model,
            symbolTable,
            sources: input.sources,
            binder: input.binder,
            columnDescriptor: descriptor,
            isListColumn,
            valueObjectDefault:
              valueObjectName === undefined
                ? undefined
                : { valueObjectName, types: valueObjectTypes },
            generatorDescriptorById,
            defaultFunctionRegistry,
            dataTypes,
            codecLookup,
            diagnostics,
          })
      : {};
    const loweredOnCreate = loweredDefault.executionDefaults?.onCreate;
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
    if (isListField && loweredOnCreate) {
      const defaultExpression =
        defaultAttribute?.args.find((arg) => arg.kind === 'positional')?.value.trim() ??
        'this function';
      diagnostics.push({
        code: 'PSL_LIST_EXECUTION_DEFAULT_UNSUPPORTED',
        message: `Field "${model.name}.${field.name}" is a list and cannot use an execution default ("${defaultExpression}"). Lists have no per-element execution-default semantics; use a literal list @default or remove the default.`,
        ...source.at(defaultAttribute?.span ?? field.span),
      });
      continue;
    }
    if (field.optional && loweredOnCreate) {
      const generatorDescription =
        loweredOnCreate.kind === 'generator' ? `"${loweredOnCreate.id}"` : 'for this field';
      diagnostics.push({
        code: 'PSL_INVALID_DEFAULT_FUNCTION_ARGUMENT',
        message: `Field "${model.name}.${field.name}" cannot be optional when using execution default ${generatorDescription}. Remove "?" or use a storage default.`,
        ...source.at(defaultAttribute?.span ?? field.span),
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
        ...source.at(idAttribute.span),
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
          symbolTable: input.symbolTable,
          model,
          field,
          specContext,
          sources: input.sources,
          binder: input.binder,
          isListColumn,
          elementNullable: field.elementOptional,
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
      ...ifDefined('elementNullable', field.elementOptional ? (true as const) : undefined),
      ...ifDefined('valueObjectTypeName', valueObjectName),
      ...ifDefined('enumTypeHandle', enumHandle),
    });
  }

  return resolvedFields;
}
