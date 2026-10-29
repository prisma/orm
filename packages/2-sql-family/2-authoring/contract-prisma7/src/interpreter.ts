import type {
  ContractSourceDiagnostic,
  ContractSourceDiagnostics,
} from '@internal/config/config-types';
import type { Contract, ExecutionMutationDefaultValue } from '@internal/contract/types';
import type {
  AuthoringEntityContext,
  AuthoringEntityTypeDescriptor,
  DataTypeSupport,
  WrittenValue,
} from '@internal/framework-components/authoring';
import {
  getAuthoringTypeChoice,
  getAuthoringTypeConstructor,
  instantiateAuthoringEntityType,
  instantiateAuthoringTypeConstructorFromValues,
  resolveAuthoringTypeChoice,
} from '@internal/framework-components/authoring';
import type { CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import {
  EMPTY_GENERATOR_FUNCTIONS,
  type GeneratorFunctionRegistry,
} from '@internal/framework-components/components';
import {
  type AssembledAuthoringContributions,
  assembleAuthoringContributions,
  type ControlMutationDefaults,
} from '@internal/framework-components/control';
import type {
  AttributeCtx,
  BlockSymbol,
  FieldSymbol,
  ModelSymbol,
  ParsedPslExtensionBlock,
  PslSpan,
  ResolvedAttribute,
  ResolvedAttributeArg,
  ResolvedTypeConstructorCall,
} from '@internal/psl-parser';
import {
  type BinderContext,
  buildSymbolTable,
  createBinder,
  createPslDiagnosticCollector,
  diagnosticSource,
  EMPTY_DATA_TYPES,
  keywordPslSpan,
  nodePslSpan,
  readResolvedAttribute,
} from '@internal/psl-parser';
import type {
  DocumentAst,
  KeyValuePairAst,
  MixinInclusionAst,
  PslSources,
  SourceFile,
} from '@internal/psl-parser/syntax';
import { dottedPathsIn, printSyntax, StringLiteralExprAst } from '@internal/psl-parser/syntax';
import { sqlCodecColumnLength, sqlDataTypeOfCodec } from '@internal/sql-contract/data-type';
import {
  declaredBackingObjectName,
  declaredIndexesServeForeignKey,
} from '@internal/sql-contract/foreign-key-materialization';
import { type AuthoredIndexInput, lowerAuthoredIndex } from '@internal/sql-contract/index-naming';
import { storedSqlText } from '@internal/sql-contract/sql-expression';
import type { SqlNamespaceBase, SqlNamespaceInput } from '@internal/sql-contract/types';
import { deriveValueSetFromEntity } from '@internal/sql-contract/value-set-derivation-hook';
import {
  buildEntityTypesByDiscriminator,
  instantiateFieldTypeConstructor,
  type ResolveFieldTypeResult,
} from '@internal/sql-contract-psl/resolution';
import {
  buildSqlContractFromDefinition,
  type ColumnNode,
  type FieldNode,
  type ModelNode,
  type TableNode,
  type TableProperties,
} from '@internal/sql-contract-ts/contract-builder';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError, isInternalError } from '@internal/utils/internal-error';
import { notOk, ok, type Result } from '@internal/utils/result';
import { basename } from 'pathe';
import {
  checkStatedConstraintNameLength,
  prisma7PrimaryKeyName,
  statedConstraintName,
} from './constraint-names';
import { lowerPrisma7Default } from './defaults';
import {
  prisma7Diagnostic,
  type UnmappedReason,
  unmappedFieldDiagnostics,
  unmappedFieldInPrimaryKey,
} from './diagnostics';
import { type IndexAttribute, indexNode, parseIndexAttribute } from './indexes';
import { prisma7NativeTypeMapping, prisma7ScalarMapping } from './native-types';
import {
  lowerRelations,
  parseRelationAttribute,
  type RelationField,
  type RelationModel,
} from './relations';
import type { Prisma7TargetBinding } from './target-binding';

/** The generator `now()` resolves to for a column, which `@updatedAt` writes on create and on update; `undefined` when no generator function binds `now` to its codec. */
function nowGeneratorFor(
  generatorFunctions: GeneratorFunctionRegistry,
  dataTypes: DataTypeSupport,
  column: {
    readonly codecId: string;
    readonly typeParams?: Readonly<Record<string, unknown>> | undefined;
  },
): ExecutionMutationDefaultValue | undefined {
  const resolution = generatorFunctions.resolve(
    { name: 'now', args: {} },
    {
      codecId: column.codecId,
      typeParams: column.typeParams,
      length: sqlCodecColumnLength(dataTypes, column.codecId, column.typeParams),
    },
  );
  return resolution.ok ? resolution.generator : undefined;
}

export interface Prisma7Document {
  readonly document: DocumentAst;
  readonly sources: PslSources;
  readonly sourceFile: SourceFile;
  readonly sourceId: string;
}

export interface InterpretPrisma7DocumentsInput {
  readonly documents: readonly Prisma7Document[];
  readonly seedDiagnostics: readonly ContractSourceDiagnostic[];
  readonly binding: Prisma7TargetBinding;
  readonly controlMutationDefaults: ControlMutationDefaults;
  readonly generatorFunctions: GeneratorFunctionRegistry;
  readonly authoringContributions: AssembledAuthoringContributions;
  readonly codecLookup: CodecLookupWithDescriptors;
  readonly dataTypes: DataTypeSupport;
  readonly composedExtensions: readonly string[];
  readonly defaultNamespaceId: string;
}

const SUMMARY = 'Prisma 7 schema interpretation failed';

interface SourceBlock {
  readonly block: BlockSymbol;
  readonly sourceId: string;
  readonly sources: PslSources;
  readonly sourceFile: SourceFile;
}

interface EnumDeclaration {
  readonly name: string;
  readonly typeName: string;
  readonly namespaceId: string;
  readonly members: readonly {
    readonly name: string;
    readonly value: string;
    readonly span: PslSpan;
  }[];
  readonly span: PslSpan;
  readonly sourceId: string;
}

interface ModelDeclaration {
  readonly symbol: ModelSymbol;
  readonly sourceId: string;
  readonly sources: PslSources;
  readonly namespaceId: string;
  readonly tableName: string;
  /** The model is `@@ignore`: its table is kept, and the model stays out of the domain. */
  readonly ignored: boolean;
  readonly id: IndexAttribute | undefined;
  readonly uniqueIndexes: readonly IndexAttribute[];
  readonly indexes: readonly IndexAttribute[];
  /** The context a default function's arguments are parsed in, built for the model's document when first asked for. */
  readonly argumentContext: () => AttributeCtx;
}

/**
 * The binder context of a Prisma 7 document's argument context. A default function's arguments are literals, so the binder needs no Prisma 8 attribute specs, functions or data types.
 */
const ARGUMENT_BINDER_CONTEXT: BinderContext = {
  authoringContributions: assembleAuthoringContributions([]),
  controlMutationDefaults: { defaultFunctionRegistry: new Map() },
  generatorFunctions: EMPTY_GENERATOR_FUNCTIONS,
  dataTypes: EMPTY_DATA_TYPES,
};

interface ModelBuild {
  readonly declaration: ModelDeclaration;
  readonly columns: Map<string, FieldNode>;
  /** The columns the table keeps and no field of the model maps: those of `@ignore` and `Unsupported(...)` fields, or every column of an `@@ignore` model. */
  readonly unmappedColumns: Map<string, ColumnNode>;
  /** The fields a primary key or a relation join may not use, because the model has no Prisma 8 field for them, and why: `@ignore` fields, relation fields to an `@@ignore` model, and `Unsupported(...)` fields. An `Unsupported` field of an `@@ignore` model is left out, because that model keeps its primary key. */
  readonly unmappedFields: Map<string, UnmappedReason>;
  readonly ignoredRelationFields: RelationField[];
  readonly rejectedFields: Set<string>;
  idFields: readonly string[];
  /** The `map` name of the model's `@id` or `@@id`. */
  idMap: string | undefined;
  readonly uniqueIndexes: IndexAttribute[];
  readonly relationFields: RelationField[];
}

type NamespaceEntities = Map<string, Record<string, Record<string, unknown>>>;

function stringArgument(attribute: ResolvedAttribute): string | undefined {
  const argument =
    attribute.args.find((arg) => arg.kind === 'positional') ??
    attribute.args.find((arg) => arg.name === 'name');
  const expression = argument?.expression;
  if (expression === undefined) return undefined;
  return StringLiteralExprAst.cast(expression.syntax)?.value();
}

function blockEntry(source: SourceBlock, key: string): KeyValuePairAst | undefined {
  for (const entry of source.block.entries) {
    if (entry.key()?.name() === key) return entry;
  }
  return undefined;
}

function scalarValue(source: SourceBlock, key: string): string | undefined {
  const value = blockEntry(source, key)?.value();
  if (value === undefined) return undefined;
  return StringLiteralExprAst.cast(value.syntax)?.value();
}

function parameterSpan(source: SourceBlock, key: string): PslSpan {
  const entry = blockEntry(source, key);
  return entry === undefined ? source.block.span : nodePslSpan(entry.syntax, source.sources);
}

/** Prisma 7 accepts no dotted path in a datasource or generator block, though the parser reads one as a value. */
function reportDottedBlockValues(
  block: BlockSymbol,
  sourceId: string,
  sources: PslSources,
  diagnostics: ContractSourceDiagnostic[],
): void {
  for (const entry of block.entries) {
    const value = entry.value();
    if (value === undefined) continue;
    for (const path of dottedPathsIn(value)) {
      diagnostics.push({
        code: 'PSL_INVALID_EXTENSION_BLOCK_MEMBER',
        message: `${block.keyword} "${block.name}": the value of "${entry.key()?.name() ?? ''}" holds the dotted path ${path.path().join('.')}, which Prisma 7 does not accept in a ${block.keyword} block.`,
        sourceId,
        span: nodePslSpan(path.syntax, sources),
      });
    }
  }
}

function reportDuplicateBlockEntries(
  source: SourceBlock,
  diagnostics: ContractSourceDiagnostic[],
): void {
  const seen = new Set<string>();
  for (const entry of source.block.entries) {
    const key = entry.key()?.name();
    if (key === undefined) continue;
    if (seen.has(key)) {
      diagnostics.push({
        code: 'PSL_EXTENSION_DUPLICATE_PARAMETER',
        message: `Duplicate parameter "${key}" in "${source.block.keyword}" block "${source.block.name}"; first occurrence wins`,
        sourceId: source.sourceId,
        span: nodePslSpan(entry.syntax, source.sources),
      });
      continue;
    }
    seen.add(key);
  }
}

interface InclusionHolderAst {
  inclusions(): Iterable<MixinInclusionAst>;
}

export function interpretPrisma7Documents(
  input: InterpretPrisma7DocumentsInput,
): Result<Contract, ContractSourceDiagnostics> {
  const { binding } = input;
  const diagnostics: ContractSourceDiagnostic[] = [...input.seedDiagnostics];
  const { defaultNamespaceId } = input;
  const datasources: SourceBlock[] = [];
  const enumBlocks: SourceBlock[] = [];
  const models: ModelDeclaration[] = [];
  // The symbol table catches duplicates within one file; a name declared
  // again in a later file is caught here with the later file's id.
  const declaredNames = new Map<string, string>();
  const claimName = (kind: string, name: string, sourceId: string, span: PslSpan): boolean => {
    const previous = declaredNames.get(name);
    if (previous === undefined) {
      declaredNames.set(name, sourceId);
      return true;
    }
    diagnostics.push({
      code: 'PSL_DUPLICATE_DECLARATION',
      message: `Duplicate declaration of ${kind} "${name}"; first declared in ${basename(previous)}.`,
      sourceId,
      span,
    });
    return false;
  };

  for (const { document, sources, sourceFile, sourceId } of input.documents) {
    const { symbolTable, diagnostics: tableDiagnostics } = buildSymbolTable({
      documents: [document],
      sources,
      defaultNamespaceId,
    });
    for (const diagnostic of tableDiagnostics) {
      diagnostics.push({
        code: diagnostic.code,
        message: diagnostic.message,
        sourceId,
        span: sourceFile.rangeToPslSpan(diagnostic.range),
      });
    }
    const unsupported = (keyword: string, span: PslSpan): void => {
      diagnostics.push({
        code: 'PSL_UNSUPPORTED_TOP_LEVEL_BLOCK',
        message: `Unsupported top-level block "${keyword}"`,
        sourceId,
        span,
      });
    };
    const unsupportedInclusions = (
      code: string,
      holders: Readonly<Record<string, { readonly node: InclusionHolderAst }>>,
    ): void => {
      for (const holder of Object.values(holders)) {
        for (const inclusion of holder.node.inclusions()) {
          diagnostics.push({
            code,
            message: `Unsupported mixin inclusion "${printSyntax(inclusion.syntax).trim()}"`,
            sourceId,
            span: nodePslSpan(inclusion.syntax, sources),
          });
        }
      }
    };
    for (const block of Object.values(symbolTable.defaultNamespace.blocks)) {
      switch (block.keyword) {
        case 'datasource':
          datasources.push({ block, sourceId, sources, sourceFile });
          reportDottedBlockValues(block, sourceId, sources, diagnostics);
          break;
        case 'generator':
          reportDottedBlockValues(block, sourceId, sources, diagnostics);
          break;
        case 'enum':
          if (claimName('enum', block.name, sourceId, block.span)) {
            enumBlocks.push({ block, sourceId, sources, sourceFile });
          }
          break;
        case 'view':
          diagnostics.push(
            prisma7Diagnostic(
              'PSL.PRISMA7_VIEW_UNSUPPORTED',
              `View "${block.name}" is not supported; Prisma 8 has no views. Remove the view or replace it with a model over the underlying table.`,
              sourceId,
              keywordPslSpan(block.node.syntax, block.keyword, sources),
            ),
          );
          break;
        default:
          unsupported(block.keyword, keywordPslSpan(block.node.syntax, block.keyword, sources));
      }
    }
    for (const namespace of Object.values(symbolTable.namespaces)) {
      for (const { span } of namespace.declarations) {
        unsupported('namespace', span);
      }
    }
    for (const compositeType of Object.values(symbolTable.defaultNamespace.compositeTypes)) {
      unsupported('type', compositeType.span);
    }
    for (const namedType of Object.values(symbolTable.namedTypes)) {
      unsupported('types', namedType.span);
    }
    for (const mixin of Object.values(symbolTable.defaultNamespace.mixins)) {
      unsupported(`${mixin.keyword} mixin`, mixin.span);
    }
    unsupportedInclusions('PSL_INVALID_MODEL_MEMBER', symbolTable.defaultNamespace.models);
    unsupportedInclusions(
      'PSL_INVALID_EXTENSION_BLOCK_MEMBER',
      symbolTable.defaultNamespace.blocks,
    );
    let argumentContext: AttributeCtx | undefined;
    const argumentContextOf = (): AttributeCtx => {
      argumentContext ??= {
        sources,
        symbols: symbolTable,
        binder: createBinder({ sources, symbolTable, context: ARGUMENT_BINDER_CONTEXT }).binder,
      };
      return argumentContext;
    };
    for (const symbol of Object.values(symbolTable.defaultNamespace.models)) {
      if (!claimName('model', symbol.name, sourceId, symbol.span)) continue;
      models.push(
        readModelDeclaration(
          symbol,
          sourceId,
          sources,
          defaultNamespaceId,
          binding,
          diagnostics,
          argumentContextOf,
        ),
      );
    }
  }

  checkDatasource(
    datasources,
    input.documents[0]?.sourceId ?? 'schema.prisma',
    binding,
    diagnostics,
  );
  reportTableCollisions(models, diagnostics);

  const enums = new Map<string, EnumDeclaration>();
  for (const source of enumBlocks) {
    const declaration = readEnumDeclaration(source, defaultNamespaceId, diagnostics);
    if (declaration !== undefined) enums.set(declaration.name, declaration);
  }
  const namespaceEntities = lowerNativeEnums(enums, input, diagnostics);

  const modelNames = new Set(models.map((model) => model.symbol.name));
  const ignoredModels = new Set(
    models.filter((model) => model.ignored).map((model) => model.symbol.name),
  );
  const composedExtensions = new Set(input.composedExtensions);
  const builds = new Map<string, ModelBuild>();
  for (const declaration of models) {
    const build: ModelBuild = {
      declaration,
      columns: new Map(),
      unmappedColumns: new Map(),
      unmappedFields: new Map(),
      ignoredRelationFields: [],
      rejectedFields: new Set(),
      idFields: declaration.id?.fields ?? [],
      idMap: declaration.id?.map,
      uniqueIndexes: [...declaration.uniqueIndexes],
      relationFields: [],
    };
    for (const field of Object.values(declaration.symbol.fields)) {
      const reported = diagnostics.length;
      readField({
        field,
        build,
        modelNames,
        ignoredModels,
        enums,
        namespaceEntities,
        composedExtensions,
        input,
        diagnostics,
      });
      if (
        diagnostics.length > reported &&
        !build.columns.has(field.name) &&
        !build.unmappedColumns.has(field.name)
      ) {
        build.rejectedFields.add(field.name);
      }
    }
    builds.set(declaration.symbol.name, build);
  }

  const relationModels = new Map<string, RelationModel>();
  for (const [modelName, build] of builds) {
    relationModels.set(modelName, {
      modelName,
      tableName: build.declaration.tableName,
      ignored: build.declaration.ignored,
      tableSpan:
        build.declaration.symbol.attributes.find((attribute) => attribute.name === 'map')?.span ??
        build.declaration.symbol.span,
      namespaceId: build.declaration.namespaceId,
      sourceId: build.declaration.sourceId,
      sources: build.declaration.sources,
      columns: build.columns,
      unmappedColumns: build.unmappedColumns,
      unmappedFields: build.unmappedFields,
      ignoredRelationFields: build.ignoredRelationFields,
      rejectedFields: build.rejectedFields,
      idFields: build.idFields,
      uniqueFieldSets: build.uniqueIndexes.flatMap((index) =>
        index.fields === undefined ? [] : [index.fields],
      ),
      relationFields: build.relationFields,
    });
  }
  const lowered = lowerRelations(relationModels, binding, diagnostics);

  const modelNodes: ModelNode[] = [];
  const tables: TableNode[] = [];
  for (const [modelName, build] of builds) {
    const model = relationModels.get(modelName);
    if (model === undefined) continue;
    const idAttribute = build.declaration.id;
    if (idAttribute?.fields !== undefined) {
      diagnostics.push(
        ...unmappedFieldDiagnostics(
          idAttribute.fields,
          build.unmappedFields,
          (fieldNames, reason) =>
            unmappedFieldInPrimaryKey({
              modelName,
              fieldNames,
              reason,
              usedBy: `@@id on model "${modelName}"`,
              sourceId: model.sourceId,
              span: idAttribute.span,
            }),
        ),
      );
    }
    const id = keyColumns(model, model.idFields);
    const indexes = [
      ...build.uniqueIndexes.map((attribute) => ({ attribute, unique: true })),
      ...build.declaration.indexes.map((attribute) => ({ attribute, unique: false })),
    ].flatMap(({ attribute, unique }) => {
      if (attribute.fields?.some((name) => build.rejectedFields.has(name))) return [];
      const columns =
        attribute.fields === undefined ? undefined : keyColumns(model, attribute.fields);
      if (columns === undefined) {
        diagnostics.push(
          prisma7Diagnostic(
            'PSL.PRISMA7_INDEX_ARGUMENT_UNSUPPORTED',
            `Model "${modelName}": an index names a field that is not a scalar column of the model.`,
            model.sourceId,
            attribute.span,
          ),
        );
        return [];
      }
      return [indexNode(model.tableName, columns, attribute, unique, binding.identifierMaxBytes)];
    });
    const foreignKeys = lowered.foreignKeys.get(modelName);
    const relations = lowered.relations.get(modelName);
    const primaryKeyName = statedConstraintName(
      prisma7PrimaryKeyName(model.tableName, build.idMap, binding.identifierMaxBytes),
      binding.defaultConstraintNames.primaryKey(model.tableName),
    );
    const tableProperties = stateServedBackingIndexes({
      tableName: model.tableName,
      ...(id !== undefined && id.length > 0
        ? { id: { columns: id, ...ifDefined('name', primaryKeyName) } }
        : {}),
      ...(indexes.length > 0 ? { indexes } : {}),
      ...(foreignKeys !== undefined ? { foreignKeys } : {}),
    });
    const unmappedColumns = [...build.unmappedColumns.values()];
    if (model.ignored) {
      tables.push({ ...tableProperties, namespaceId: model.namespaceId, columns: unmappedColumns });
      continue;
    }
    modelNodes.push({
      ...tableProperties,
      modelName,
      namespaceId: model.namespaceId,
      fields: [...build.columns.values()],
      ...(relations !== undefined ? { relations } : {}),
    });
    if (unmappedColumns.length > 0) {
      tables.push({
        namespaceId: model.namespaceId,
        tableName: model.tableName,
        columns: unmappedColumns,
      });
    }
  }
  tables.push(...[...lowered.ignoredJunctions.values()].map(stateServedBackingIndexes));
  for (const [key, junction] of lowered.junctions) {
    const relations = lowered.relations.get(key);
    modelNodes.push(
      stateServedBackingIndexes(relations === undefined ? junction : { ...junction, relations }),
    );
  }

  if (diagnostics.length > 0) {
    return notOk({ summary: SUMMARY, diagnostics });
  }

  const createNamespace = (namespace: SqlNamespaceInput): SqlNamespaceBase => {
    const entities = namespaceEntities.get(namespace.id);
    if (entities === undefined) return binding.createNamespace(namespace);
    const valueSet = { ...namespace.entries['valueSet'], ...entities['valueSet'] };
    return binding.createNamespace({
      ...namespace,
      entries: {
        ...namespace.entries,
        ...entities,
        ...(Object.keys(valueSet).length > 0 ? { valueSet } : {}),
      },
    });
  };

  return ok(
    buildSqlContractFromDefinition(
      {
        target: binding.target,
        warnings: undefined,
        createNamespace,
        ...(namespaceEntities.size > 0 ? { namespaces: [...namespaceEntities.keys()] } : {}),
        models: modelNodes,
        ...(tables.length > 0 ? { tables } : {}),
      },
      input.codecLookup,
      input.dataTypes.lookup,
    ),
  );
}

/**
 * Prisma 7 never derives a backing index for a foreign key, so its relations say `index: false`. Where the model's own indexes or keys already serve a foreign key, the relation takes the default instead, so the build drops the derived index again, or names the named key or plain index whose first columns are the foreign key's. Either way the stored foreign key states what backs it, and no index is added.
 */
function stateServedBackingIndexes<Node extends TableProperties & { readonly tableName: string }>(
  node: Node,
): Node {
  if (node.foreignKeys === undefined) return node;
  const table = {
    indexes: (node.indexes ?? []).map((index) =>
      lowerAuthoredIndex(
        node.tableName,
        blindCast<AuthoredIndexInput, 'a Prisma 7 index node carries the authored index union'>(
          index,
        ),
        [],
      ),
    ),
    uniques: node.uniques ?? [],
    primaryKey: node.id,
  };
  return {
    ...node,
    foreignKeys: node.foreignKeys.map((foreignKey) => {
      if (foreignKey.index !== false) return foreignKey;
      if (declaredIndexesServeForeignKey(foreignKey.columns, table)) {
        return { ...foreignKey, index: true };
      }
      const name = declaredBackingObjectName(foreignKey.columns, table);
      return name === undefined ? foreignKey : { ...foreignKey, index: name };
    }),
  };
}

function checkDatasource(
  datasources: readonly SourceBlock[],
  fallbackSourceId: string,
  binding: Prisma7TargetBinding,
  diagnostics: ContractSourceDiagnostic[],
): void {
  const [datasource] = datasources;
  const [namedProvider] = binding.providers;
  if (datasource === undefined) {
    diagnostics.push(
      prisma7Diagnostic(
        'PSL.PRISMA7_PROVIDER_MISMATCH',
        `No datasource block found; add \`datasource db { provider = "${namedProvider}" }\`.`,
        fallbackSourceId,
        undefined,
      ),
    );
    return;
  }
  reportDuplicateBlockEntries(datasource, diagnostics);
  const provider = scalarValue(datasource, 'provider');
  if (provider === undefined || !binding.providers.includes(provider)) {
    diagnostics.push(
      prisma7Diagnostic(
        'PSL.PRISMA7_PROVIDER_MISMATCH',
        provider === undefined
          ? `The datasource block declares no string \`provider\`; this contract source reads Prisma 7 schemas for provider "${namedProvider}".`
          : `The datasource provider is "${provider}"; this contract source reads Prisma 7 schemas for provider "${namedProvider}".`,
        datasource.sourceId,
        parameterSpan(datasource, 'provider'),
      ),
    );
  }
  const relationModeEdits = {
    relationMode: 'Removing relationMode, or setting it to "foreignKeys"',
    referentialIntegrity:
      'Removing referentialIntegrity, or replacing it with relationMode = "foreignKeys"',
  };
  for (const [property, edit] of Object.entries(relationModeEdits)) {
    if (scalarValue(datasource, property) !== 'prisma') continue;
    diagnostics.push(
      prisma7Diagnostic(
        'PSL.PRISMA7_RELATION_MODE_UNSUPPORTED',
        `${property} = "prisma" is not supported: the contract declares the foreign keys its relations need, and in this mode Prisma 7 creates none. ${edit}, makes Prisma 7's next migration add those foreign keys, and that migration fails if any existing row breaks one.`,
        datasource.sourceId,
        parameterSpan(datasource, property),
      ),
    );
  }
}

function reportTableCollisions(
  models: readonly ModelDeclaration[],
  diagnostics: ContractSourceDiagnostic[],
): void {
  const byTable = new Map<string, ModelDeclaration[]>();
  for (const model of models) {
    const key = `${model.namespaceId}.${model.tableName}`;
    const group = byTable.get(key) ?? [];
    byTable.set(key, group);
    group.push(model);
  }
  for (const group of byTable.values()) {
    if (group.length < 2) continue;
    const names = group.map((model) => `"${model.symbol.name}"`).join(', ');
    for (const model of group) {
      const mapAttribute = model.symbol.attributes.find((attribute) => attribute.name === 'map');
      diagnostics.push(
        prisma7Diagnostic(
          'PSL.PRISMA7_TABLE_COLLISION',
          `Models ${names} all map to table "${model.namespaceId}"."${model.tableName}"; each model needs its own table.`,
          model.sourceId,
          mapAttribute?.span ?? model.symbol.span,
        ),
      );
    }
  }
}

function keyColumns(
  model: RelationModel,
  fieldNames: readonly string[],
): readonly string[] | undefined {
  const columns: string[] = [];
  for (const fieldName of fieldNames) {
    const column = model.columns.get(fieldName) ?? model.unmappedColumns.get(fieldName);
    if (column === undefined) return undefined;
    columns.push(column.columnName);
  }
  return columns;
}

function readModelDeclaration(
  symbol: ModelSymbol,
  sourceId: string,
  sources: PslSources,
  defaultNamespaceId: string,
  binding: Pick<Prisma7TargetBinding, 'indexTypes' | 'identifierMaxBytes'>,
  diagnostics: ContractSourceDiagnostic[],
  argumentContext: () => AttributeCtx,
): ModelDeclaration {
  const { indexTypes } = binding;
  let ignored = false;
  let tableName = symbol.name;
  let namespaceId = defaultNamespaceId;
  let id: IndexAttribute | undefined;
  const uniqueIndexes: IndexAttribute[] = [];
  const indexes: IndexAttribute[] = [];
  for (const attribute of symbol.attributes) {
    if (['id', 'unique', 'index'].includes(attribute.name)) {
      checkStatedConstraintNameLength({
        attribute,
        owner: `Model "${symbol.name}"`,
        maxBytes: binding.identifierMaxBytes,
        sourceId,
        diagnostics,
      });
    }
    switch (attribute.name) {
      case 'map':
        tableName =
          requireStringArgument(attribute, symbol.name, sourceId, diagnostics) ?? tableName;
        break;
      case 'schema':
        namespaceId =
          requireStringArgument(attribute, symbol.name, sourceId, diagnostics) ?? namespaceId;
        break;
      case 'id': {
        const parsed = parseIndexAttribute(
          attribute,
          symbol.name,
          sourceId,
          indexTypes,
          diagnostics,
        );
        if (parsed?.fields !== undefined) id = parsed;
        break;
      }
      case 'unique': {
        const parsed = parseIndexAttribute(
          attribute,
          symbol.name,
          sourceId,
          indexTypes,
          diagnostics,
        );
        if (parsed?.fields !== undefined) uniqueIndexes.push(parsed);
        break;
      }
      case 'index': {
        const parsed = parseIndexAttribute(
          attribute,
          symbol.name,
          sourceId,
          indexTypes,
          diagnostics,
        );
        if (parsed?.fields !== undefined) indexes.push(parsed);
        break;
      }
      case 'ignore':
        ignored = true;
        break;
      default:
        diagnostics.push(
          prisma7Diagnostic(
            'PSL.PRISMA7_UNKNOWN_ATTRIBUTE',
            `Model "${symbol.name}": attribute "@@${attribute.name}" is not supported yet by the Prisma 7 contract source.`,
            sourceId,
            attribute.span,
          ),
        );
    }
  }
  return {
    symbol,
    sourceId,
    sources,
    namespaceId,
    tableName,
    ignored,
    id,
    uniqueIndexes,
    indexes,
    argumentContext,
  };
}

function requireStringArgument(
  attribute: ResolvedAttribute,
  owner: string,
  sourceId: string,
  diagnostics: ContractSourceDiagnostic[],
): string | undefined {
  const value = stringArgument(attribute);
  if (value === undefined) {
    diagnostics.push({
      code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
      message: `"${owner}": attribute "${attribute.name}" expects one string argument.`,
      sourceId,
      span: attribute.span,
    });
  }
  return value;
}

function readEnumDeclaration(
  source: SourceBlock,
  defaultNamespaceId: string,
  diagnostics: ContractSourceDiagnostic[],
): EnumDeclaration | undefined {
  const { block, sourceId, sources } = source;
  let typeName = block.name;
  let namespaceId = defaultNamespaceId;
  for (const attribute of block.attributes) {
    switch (attribute.name) {
      case 'map':
        typeName = requireStringArgument(attribute, block.name, sourceId, diagnostics) ?? typeName;
        break;
      case 'schema':
        namespaceId =
          requireStringArgument(attribute, block.name, sourceId, diagnostics) ?? namespaceId;
        break;
      default:
        diagnostics.push(
          prisma7Diagnostic(
            'PSL.PRISMA7_UNKNOWN_ATTRIBUTE',
            `Enum "${block.name}": attribute "@@${attribute.name}" is not supported by the Prisma 7 contract source.`,
            sourceId,
            attribute.span,
          ),
        );
    }
  }
  const members: EnumDeclaration['members'][number][] = [];
  const seenMemberNames = new Set<string>();
  for (const entry of block.entries) {
    const name = entry.key()?.name();
    if (name === undefined) continue;
    if (seenMemberNames.has(name)) {
      diagnostics.push({
        code: 'PSL_EXTENSION_DUPLICATE_PARAMETER',
        message: `Duplicate parameter "${name}" in "${block.keyword}" block "${block.name}"; first occurrence wins`,
        sourceId,
        span: nodePslSpan(entry.syntax, sources),
      });
      continue;
    }
    seenMemberNames.add(name);
    let value = name;
    const span = nodePslSpan(entry.syntax, sources);
    for (const attributeNode of entry.attributes()) {
      const attribute = readResolvedAttribute(attributeNode, sources);
      if (attribute.name === 'map') {
        value =
          requireStringArgument(attribute, `${block.name}.${name}`, sourceId, diagnostics) ?? value;
      } else {
        diagnostics.push(
          prisma7Diagnostic(
            'PSL.PRISMA7_UNKNOWN_ATTRIBUTE',
            `Enum member "${block.name}.${name}": attribute "@${attribute.name}" is not supported by the Prisma 7 contract source.`,
            sourceId,
            attribute.span,
          ),
        );
      }
    }
    members.push({ name, value, span });
  }
  return { name: block.name, typeName, namespaceId, members, span: block.span, sourceId };
}

function lowerNativeEnums(
  enums: ReadonlyMap<string, EnumDeclaration>,
  input: InterpretPrisma7DocumentsInput,
  diagnostics: ContractSourceDiagnostic[],
): NamespaceEntities {
  const result: NamespaceEntities = new Map();
  if (enums.size === 0) return result;
  const { entityKind } = input.binding.nativeEnum;
  const descriptor: AuthoringEntityTypeDescriptor | undefined = buildEntityTypesByDiscriminator(
    input.authoringContributions,
  ).get(entityKind);
  for (const declaration of enums.values()) {
    if (descriptor === undefined) {
      diagnostics.push(
        prisma7Diagnostic(
          'PSL.PRISMA7_UNSUPPORTED_TYPE',
          `Enum "${declaration.name}" cannot be lowered: target "${input.binding.target.targetId}" registers no "${entityKind}" entity kind.`,
          declaration.sourceId,
          declaration.span,
        ),
      );
      continue;
    }
    const context: AuthoringEntityContext = {
      family: input.binding.target.familyId,
      target: input.binding.target.targetId,
      codecLookup: input.codecLookup,
      dataTypes: input.dataTypes,
      sourceId: declaration.sourceId,
      diagnostics: {
        push: (diagnostic) => {
          diagnostics.push(
            blindCast<ContractSourceDiagnostic, 'entity factory diagnostics are span-compatible'>(
              diagnostic,
            ),
          );
        },
      },
    };
    const values: Record<string, string> = Object.create(null);
    const writtenValues: Record<string, WrittenValue> = Object.create(null);
    const parameterSpans: Record<string, PslSpan> = Object.create(null);
    for (const member of declaration.members) {
      values[member.name] = member.value;
      writtenValues[member.name] = { kind: 'string', text: member.value };
      parameterSpans[member.name] = member.span;
    }
    const block: ParsedPslExtensionBlock<Record<string, string>> & {
      readonly namespaceId: string;
    } = {
      kind: entityKind,
      keyword: entityKind,
      name: declaration.name,
      values,
      writtenValues,
      parameterSpans,
      attributes: { map: { args: { name: declaration.typeName }, span: declaration.span } },
      span: declaration.span,
      namespaceId: declaration.namespaceId,
    };
    const entity: unknown = instantiateAuthoringEntityType(
      entityKind,
      descriptor,
      [block],
      context,
    );
    if (entity === undefined) continue;
    const entities = result.get(declaration.namespaceId) ?? {};
    result.set(declaration.namespaceId, entities);
    entities[entityKind] = { ...entities[entityKind], [declaration.name]: entity };
    const valueSet = deriveValueSetFromEntity(descriptor.output, entity);
    if (valueSet !== undefined) {
      entities['valueSet'] = { ...entities['valueSet'], [declaration.name]: valueSet };
    }
  }
  return result;
}

/** The SQL family's type constructor for a column of a type no data type claims (ADR 273). */
const RAW_TYPE_CONSTRUCTOR: readonly string[] = ['Raw'];

/** The constructor the values a binding maps a Prisma 7 type to choose from the type choice it names; a refusal is the binding's mistake. */
function chooseBindingType(
  label: string,
  path: readonly string[],
  typeChoice: NonNullable<ReturnType<typeof getAuthoringTypeChoice>>,
  values: readonly unknown[],
): ReturnType<typeof resolveAuthoringTypeChoice> {
  try {
    return resolveAuthoringTypeChoice({
      helperPath: path.join('.'),
      descriptor: typeChoice.descriptor,
      args: values,
      constructorNamed: typeChoice.constructorNamed,
    });
  } catch (error) {
    if (isInternalError(error) || !(error instanceof Error)) throw error;
    throw new InternalError(
      `The Prisma 7 target binding maps ${label} to type choice "${path.join('.')}" with values it refuses: ${error.message}`,
    );
  }
}

/** Prisma 7's `Unsupported("...")`, which this source reads as ``Raw(sql`...`)``. */
function isUnsupportedType(call: ResolvedTypeConstructorCall | undefined): boolean {
  return call?.path.length === 1 && call.path[0] === 'Unsupported';
}

/** The one double-quoted string `Unsupported(...)` takes, as written and with its escapes undone. */
function unsupportedTypeArgument(
  call: ResolvedTypeConstructorCall,
): { readonly written: ResolvedAttributeArg; readonly text: string } | undefined {
  const [written, ...rest] = call.args;
  if (written === undefined || rest.length > 0 || written.kind !== 'positional') return undefined;
  const literal =
    written.expression === undefined
      ? undefined
      : StringLiteralExprAst.cast(written.expression.syntax);
  const text = literal?.quote() === '"' ? literal.value() : undefined;
  return text === undefined ? undefined : { written, text };
}

/**
 * How the reader gives a field its Prisma 8 type: a call it reads as a schema's call is read, from the arguments as written, or a constructor and the values of its arguments, which the reader already holds.
 */
type Prisma7FieldType =
  | { readonly kind: 'written'; readonly call: ResolvedTypeConstructorCall }
  | {
      readonly kind: 'values';
      readonly path: readonly string[];
      readonly values: readonly unknown[];
    };

function nativeTypeMessage(label: string, nativeType: string): string {
  return `${label}: native type "@db.${nativeType}" has no Prisma 8 codec yet, and Prisma 8 cannot read this schema until it supports the column type. @ignore on the field or @@ignore on the model does not help: Prisma 8 keeps the columns of ignored fields and models in the contract. Changing the field's type to one Prisma 8 supports changes the column type on Prisma 7's next migration.`;
}

interface ReadFieldArgs {
  readonly field: FieldSymbol;
  readonly build: ModelBuild;
  readonly modelNames: ReadonlySet<string>;
  readonly ignoredModels: ReadonlySet<string>;
  readonly enums: ReadonlyMap<string, EnumDeclaration>;
  readonly namespaceEntities: NamespaceEntities;
  readonly composedExtensions: ReadonlySet<string>;
  readonly input: InterpretPrisma7DocumentsInput;
  readonly diagnostics: ContractSourceDiagnostic[];
}

function readField(args: ReadFieldArgs): void {
  const { field, build, diagnostics, input } = args;
  const { binding } = input;
  const model = build.declaration;
  const sourceId = model.sourceId;
  const label = `Field "${model.symbol.name}.${field.name}"`;
  const isRelationField =
    args.modelNames.has(field.typeName) && field.typeConstructor === undefined;
  const fieldIgnored =
    field.attributes.some((attribute) => attribute.name === 'ignore') ||
    (isRelationField && args.ignoredModels.has(field.typeName));
  const unsupported = isUnsupportedType(field.typeConstructor);
  const unmappedReason: UnmappedReason | undefined =
    unsupported && !model.ignored ? 'unsupported' : fieldIgnored ? 'ignored' : undefined;
  if (unmappedReason !== undefined) build.unmappedFields.set(field.name, unmappedReason);
  const ignored = fieldIgnored || model.ignored || unsupported;

  let columnName = field.name;
  let nativeType: { readonly name: string; readonly attribute: ResolvedAttribute } | undefined;
  let relation: ResolvedAttribute | undefined;
  let defaultAttribute: ResolvedAttribute | undefined;
  let updatedAt: ResolvedAttribute | undefined;
  for (const attribute of field.attributes) {
    if (
      isRelationField ? attribute.name === 'relation' : ['id', 'unique'].includes(attribute.name)
    ) {
      checkStatedConstraintNameLength({
        attribute,
        owner: label,
        maxBytes: binding.identifierMaxBytes,
        sourceId,
        diagnostics,
      });
    }
    if (attribute.name === 'map' && !isRelationField) {
      columnName = requireStringArgument(attribute, label, sourceId, diagnostics) ?? columnName;
    } else if (attribute.name.startsWith('db.') && !isRelationField) {
      nativeType = { name: attribute.name.slice('db.'.length), attribute };
    } else if (attribute.name === 'id' && !isRelationField) {
      const parsed = parseIndexAttribute(
        attribute,
        label,
        sourceId,
        binding.indexTypes,
        diagnostics,
      );
      if (parsed !== undefined) {
        build.idFields = [field.name];
        build.idMap = parsed.map;
      }
      if (unmappedReason !== undefined) {
        diagnostics.push(
          unmappedFieldInPrimaryKey({
            modelName: model.symbol.name,
            fieldNames: [field.name],
            reason: unmappedReason,
            usedBy: 'its @id',
            sourceId,
            span: attribute.span,
          }),
        );
      }
    } else if (attribute.name === 'unique' && !isRelationField) {
      const parsed = parseIndexAttribute(
        attribute,
        label,
        sourceId,
        binding.indexTypes,
        diagnostics,
      );
      if (parsed !== undefined) build.uniqueIndexes.push({ ...parsed, fields: [field.name] });
    } else if (attribute.name === 'default' && !isRelationField) {
      defaultAttribute = attribute;
    } else if (attribute.name === 'updatedAt' && !isRelationField) {
      updatedAt = attribute;
    } else if (attribute.name === 'relation' && isRelationField) {
      relation = attribute;
    } else if (attribute.name === 'ignore') {
    } else {
      diagnostics.push(
        prisma7Diagnostic(
          'PSL.PRISMA7_UNKNOWN_ATTRIBUTE',
          `${label}: attribute "@${attribute.name}" is not supported yet by the Prisma 7 contract source.`,
          sourceId,
          attribute.span,
        ),
      );
    }
  }

  if (field.malformedType) return;
  if (field.typeConstructor !== undefined && !unsupported) {
    diagnostics.push(
      prisma7Diagnostic(
        'PSL.PRISMA7_UNSUPPORTED_TYPE',
        `${label} has type "${field.typeConstructor.path.join('.')}(...)", which is not a Prisma 7 type. Prisma 7 refuses this schema too.`,
        sourceId,
        field.typeConstructor.span,
      ),
    );
    return;
  }
  if (unsupported && nativeType !== undefined) {
    diagnostics.push(
      prisma7Diagnostic(
        'PSL.PRISMA7_UNKNOWN_ATTRIBUTE',
        `${label} has type Unsupported(...), which takes no native type, but has attribute "@db.${nativeType.name}". Prisma 7 refuses this schema too: "Attribute not known". Remove "@db.${nativeType.name}".`,
        sourceId,
        nativeType.attribute.span,
      ),
    );
    return;
  }
  const unsupportedArgument =
    field.typeConstructor === undefined
      ? undefined
      : unsupportedTypeArgument(field.typeConstructor);
  if (field.typeConstructor !== undefined && unsupportedArgument === undefined) {
    diagnostics.push(
      prisma7Diagnostic(
        'PSL.PRISMA7_UNSUPPORTED_TYPE',
        `${label}: Unsupported(...) takes one string, the column's type as the database prints it, such as Unsupported("tsvector").`,
        sourceId,
        field.typeConstructor.span,
      ),
    );
    return;
  }
  if (isRelationField) {
    const attribute =
      relation === undefined
        ? undefined
        : parseRelationAttribute(relation, label, sourceId, diagnostics);
    if (relation !== undefined && attribute === undefined) return;
    (ignored ? build.ignoredRelationFields : build.relationFields).push({
      field,
      targetModelName: field.typeName,
      attribute,
    });
    return;
  }

  if (updatedAt !== undefined && field.typeName !== 'DateTime') {
    diagnostics.push(
      prisma7Diagnostic(
        'PSL.PRISMA7_UPDATED_AT_FIELD_INVALID',
        `${label} has type "${field.typeName}", but @updatedAt is only allowed on a DateTime field. Prisma 7 refuses this schema too: "Fields that are marked with @updatedAt must be of type DateTime." Remove @updatedAt, or change the field's type to DateTime.`,
        sourceId,
        updatedAt.span,
      ),
    );
    return;
  }
  if (updatedAt !== undefined && field.list) {
    diagnostics.push(
      prisma7Diagnostic(
        'PSL.PRISMA7_UPDATED_AT_FIELD_INVALID',
        `${label} is a list, but @updatedAt is not allowed on a list field. Prisma 7 refuses this schema too: "Fields that are marked with @updatedAt cannot be lists." Remove @updatedAt, or make the field a single DateTime.`,
        sourceId,
        updatedAt.span,
      ),
    );
    return;
  }

  const enumDeclaration = unsupported ? undefined : args.enums.get(field.typeName);
  let fieldType: Prisma7FieldType;
  if (unsupportedArgument !== undefined) {
    const sqlText = storedSqlText(unsupportedArgument.text);
    if (sqlText === undefined) {
      diagnostics.push(
        prisma7Diagnostic(
          'PSL.PRISMA7_UNSUPPORTED_TYPE',
          `${label}: Unsupported(${unsupportedArgument.written.value}) is not one type name: a sql literal cannot hold it, because it has a NUL character or is too large.`,
          sourceId,
          unsupportedArgument.written.span,
        ),
      );
      return;
    }
    fieldType = { kind: 'values', path: RAW_TYPE_CONSTRUCTOR, values: [sqlText] };
  } else if (enumDeclaration !== undefined) {
    if (enumDeclaration.namespaceId !== model.namespaceId) {
      diagnostics.push(
        prisma7Diagnostic(
          'PSL.PRISMA7_ENUM_NAMESPACE_MISMATCH',
          `${label} uses enum "${enumDeclaration.name}" from schema "${enumDeclaration.namespaceId}", but the model is in schema "${model.namespaceId}". Prisma 8 columns reference the enum type of their own schema; declare the enum in "${model.namespaceId}" or move the model.`,
          sourceId,
          field.span,
        ),
      );
      return;
    }
    fieldType = {
      kind: 'written',
      call: {
        path: binding.nativeEnum.typeConstructor,
        args: [{ kind: 'positional', value: enumDeclaration.name, span: field.span }],
        span: field.span,
      },
    };
  } else {
    const scalar = prisma7ScalarMapping(binding.typeMap, field.typeName);
    if (scalar === undefined) {
      diagnostics.push(
        prisma7Diagnostic(
          'PSL.PRISMA7_UNSUPPORTED_TYPE',
          `${label} has unknown type "${field.typeName}".`,
          sourceId,
          field.span,
        ),
      );
      return;
    }
    const native =
      nativeType === undefined
        ? undefined
        : prisma7NativeTypeMapping(binding.typeMap, nativeType.name);
    if (nativeType !== undefined && native === undefined) {
      diagnostics.push(
        prisma7Diagnostic(
          'PSL.PRISMA7_NATIVE_TYPE_UNSUPPORTED',
          nativeTypeMessage(label, nativeType.name),
          sourceId,
          nativeType.attribute.span,
        ),
      );
      return;
    }
    const mapping = native ?? scalar;
    fieldType =
      nativeType === undefined || nativeType.attribute.args.length === 0
        ? { kind: 'values', path: [mapping.constructorName], values: mapping.args }
        : {
            kind: 'written',
            call: {
              path: [mapping.constructorName],
              args: nativeType.attribute.args,
              span: nativeType.attribute.span,
            },
          };
  }

  const constructorPath = fieldType.kind === 'written' ? fieldType.call.path : fieldType.path;
  const typeChoice =
    fieldType.kind === 'values'
      ? getAuthoringTypeChoice(input.authoringContributions, constructorPath)
      : undefined;
  const chosen =
    typeChoice === undefined || fieldType.kind !== 'values'
      ? undefined
      : chooseBindingType(label, constructorPath, typeChoice, fieldType.values);
  const typeConstructor =
    chosen?.descriptor ??
    getAuthoringTypeConstructor(input.authoringContributions, constructorPath);
  const typeValues = chosen?.args ?? (fieldType.kind === 'values' ? fieldType.values : []);
  if (typeConstructor === undefined) {
    diagnostics.push(
      prisma7Diagnostic(
        'PSL.PRISMA7_UNSUPPORTED_TYPE',
        `${label} type "${field.typeName}" could not be resolved against target "${binding.target.targetId}".`,
        sourceId,
        field.span,
      ),
    );
    return;
  }
  let resolved: ResolveFieldTypeResult;
  if (fieldType.kind === 'written') {
    const typeDiagnostics = createPslDiagnosticCollector(model.sources);
    resolved = instantiateFieldTypeConstructor({
      call: fieldType.call,
      descriptor: typeConstructor,
      diagnostics: typeDiagnostics,
      source: diagnosticSource(model.sources, field.node.syntax),
      entityLabel: label,
      namespaceId: model.namespaceId,
      namespaceExtensionEntities: args.namespaceEntities,
      codecLookup: input.codecLookup,
      dataTypes: input.dataTypes,
    });
    diagnostics.push(...typeDiagnostics.toExternal());
  } else {
    const instantiated = instantiateAuthoringTypeConstructorFromValues(
      typeConstructor,
      typeValues,
      input.codecLookup.descriptorFor(typeConstructor.output.codecId)?.paramsSchema,
    );
    if (!instantiated.ok && unsupportedArgument !== undefined) {
      diagnostics.push(
        prisma7Diagnostic(
          'PSL.PRISMA7_UNSUPPORTED_TYPE',
          `${label}: Unsupported(${unsupportedArgument.written.value}) is not one type name: ${instantiated.failure.message}`,
          sourceId,
          unsupportedArgument.written.span,
        ),
      );
      return;
    }
    if (!instantiated.ok) {
      throw new InternalError(
        `The Prisma 7 target binding maps ${label} to constructor "${fieldType.path.join('.')}" with arguments its codec refuses: ${instantiated.failure.message}`,
      );
    }
    resolved = { ok: true, descriptor: instantiated.value };
  }
  if (!resolved.ok) {
    return;
  }
  const typeLookups = { codecLookup: input.codecLookup, dataTypeLookup: input.dataTypes.lookup };
  const updatedAtGenerator =
    updatedAt === undefined || ignored
      ? undefined
      : nowGeneratorFor(input.generatorFunctions, input.dataTypes, resolved.descriptor);
  if (updatedAt !== undefined && !ignored && updatedAtGenerator === undefined) {
    if (nativeType === undefined) {
      throw new InternalError(
        `The Prisma 7 target binding has no "now" generator for codec "${resolved.descriptor.codecId}", which the DateTime scalar maps to.`,
      );
    }
    diagnostics.push(
      prisma7Diagnostic(
        'PSL.PRISMA7_UPDATED_AT_FIELD_INVALID',
        `${label} has @updatedAt, but "@db.${nativeType.name}" makes it a column that is not a date or time, so @updatedAt cannot set it. Prisma 7 refuses this schema too: "Native type ${nativeType.name} is not compatible with declared field type DateTime". Remove @updatedAt, or use a date or time native type such as @db.Timestamp.`,
        sourceId,
        nativeType.attribute.span,
      ),
    );
    return;
  }
  const lowered =
    defaultAttribute === undefined
      ? undefined
      : lowerPrisma7Default({
          attribute: defaultAttribute,
          field,
          modelName: model.symbol.name,
          onlyDbgenerated: unsupported,
          codecId: resolved.descriptor.codecId,
          typeParams: resolved.descriptor.typeParams,
          nativeTypeName: nativeType?.name,
          codecLookup: input.codecLookup,
          dataTypes: input.dataTypes,
          literalForm: binding.literalDefaultForm({
            codecId: resolved.descriptor.codecId,
            dataType: sqlDataTypeOfCodec(resolved.descriptor.codecId, typeLookups).id,
            typeParams: resolved.descriptor.typeParams,
          }),
          literalDefaultExpression: (stored) =>
            binding.literalDefaultExpression(stored, {
              codecId: resolved.descriptor.codecId,
              dataType: sqlDataTypeOfCodec(resolved.descriptor.codecId, typeLookups).id,
              typeParams: resolved.descriptor.typeParams,
            }),
          enumMembers:
            enumDeclaration === undefined
              ? undefined
              : new Map(enumDeclaration.members.map((member) => [member.name, member.value])),
          controlMutationDefaults: input.controlMutationDefaults,
          argumentContext: model.argumentContext,
          generatorFunctions: input.generatorFunctions,
          sourceId,
          diagnostics,
        });
  if (defaultAttribute !== undefined && lowered === undefined) return;
  const column: ColumnNode = {
    columnName,
    descriptor: resolved.descriptor,
    nullable: field.optional || field.list,
    many: field.list,
    ...(field.list ? { elementNullable: true } : {}),
    ...ifDefined('default', lowered?.storage),
  };
  if (ignored) {
    build.unmappedColumns.set(field.name, column);
    return;
  }
  const executionDefaults =
    updatedAtGenerator !== undefined
      ? { onCreate: updatedAtGenerator, onUpdate: updatedAtGenerator }
      : lowered?.onCreate !== undefined
        ? { onCreate: lowered.onCreate }
        : undefined;
  build.columns.set(field.name, {
    fieldName: field.name,
    ...column,
    ...ifDefined('executionDefaults', executionDefaults),
  });
}
