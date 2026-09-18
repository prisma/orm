import type {
  ContractSourceDiagnostic,
  ContractSourceDiagnostics,
} from '@internal/config/config-types';
import type { Contract } from '@internal/contract/types';
import type {
  AuthoringEntityContext,
  AuthoringEntityTypeDescriptor,
} from '@internal/framework-components/authoring';
import {
  collectScalarTypeConstructors,
  instantiateAuthoringEntityType,
} from '@internal/framework-components/authoring';
import type { CodecLookup } from '@internal/framework-components/codec';
import type {
  AssembledAuthoringContributions,
  ControlMutationDefaults,
} from '@internal/framework-components/control';
import type {
  BlockSymbol,
  FieldSymbol,
  ModelSymbol,
  PslExtensionBlock,
  PslSpan,
  ResolvedAttribute,
  ResolvedTypeConstructorCall,
} from '@internal/psl-parser';
import {
  buildSymbolTable,
  keywordPslSpan,
  nodePslSpan,
  rangeToPslSpan,
  readResolvedAttribute,
  readResolvedAttributes,
} from '@internal/psl-parser';
import type { DocumentAst, SourceFile } from '@internal/psl-parser/syntax';
import { StringLiteralExprAst } from '@internal/psl-parser/syntax';
import type { SqlNamespaceBase, SqlNamespaceInput } from '@internal/sql-contract/types';
import { deriveValueSetFromEntity } from '@internal/sql-contract/value-set-derivation-hook';
import {
  buildEntityTypesByDiscriminator,
  type ColumnDescriptor,
  resolveFieldTypeDescriptor,
} from '@internal/sql-contract-psl/resolution';
import {
  buildSqlContractFromDefinition,
  type FieldNode,
  type ModelNode,
} from '@internal/sql-contract-ts/contract-builder';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { notOk, ok, type Result } from '@internal/utils/result';
import { basename } from 'pathe';
import { givesColumnDefault, lowerPrisma7Default } from './defaults';
import { andList, ignoredFieldReferenced, prisma7Diagnostic } from './diagnostics';
import { type IndexAttribute, indexNode, parseIndexAttribute } from './indexes';
import { prisma7NativeTypeMapping, prisma7ScalarMapping } from './native-types';
import {
  lowerRelations,
  parseRelationAttribute,
  type RelationField,
  type RelationModel,
} from './relations';
import type { Prisma7TargetBinding } from './target-binding';

export interface Prisma7Document {
  readonly document: DocumentAst;
  readonly sourceFile: SourceFile;
  readonly sourceId: string;
}

export interface InterpretPrisma7DocumentsInput {
  readonly documents: readonly Prisma7Document[];
  readonly seedDiagnostics: readonly ContractSourceDiagnostic[];
  readonly binding: Prisma7TargetBinding;
  readonly controlMutationDefaults: ControlMutationDefaults;
  readonly authoringContributions: AssembledAuthoringContributions;
  readonly codecLookup: CodecLookup;
  readonly composedExtensions: readonly string[];
}

const SUMMARY = 'Prisma 7 schema interpretation failed';
const EMPTY_DESCRIPTORS: ReadonlyMap<string, ColumnDescriptor> = new Map();

interface SourceBlock {
  readonly block: BlockSymbol;
  readonly sourceId: string;
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
  readonly namespaceId: string;
  readonly tableName: string;
  readonly id: IndexAttribute | undefined;
  readonly uniqueIndexes: readonly IndexAttribute[];
  readonly indexes: readonly IndexAttribute[];
}

interface ModelBuild {
  readonly declaration: ModelDeclaration;
  readonly columns: Map<string, FieldNode>;
  readonly ignoredFields: Set<string>;
  readonly ignoredRelationFields: RelationField[];
  readonly rejectedFields: Set<string>;
  idFields: readonly string[];
  readonly uniqueIndexes: IndexAttribute[];
  readonly relationFields: RelationField[];
}

type NamespaceEntities = Map<string, Record<string, Record<string, unknown>>>;

function attributeText(attribute: ResolvedAttribute): string {
  const args = attribute.args.map((arg) =>
    arg.kind === 'named' ? `${arg.name}: ${arg.value}` : arg.value,
  );
  return args.length === 0 ? `@${attribute.name}` : `@${attribute.name}(${args.join(', ')})`;
}

function stringArgument(attribute: ResolvedAttribute): string | undefined {
  const argument =
    attribute.args.find((arg) => arg.kind === 'positional') ??
    attribute.args.find((arg) => arg.name === 'name');
  const expression = argument?.expression;
  if (expression === undefined) return undefined;
  return StringLiteralExprAst.cast(expression.syntax)?.value();
}

function scalarValue(block: PslExtensionBlock, key: string): string | undefined {
  const parameter = block.parameters[key];
  if (parameter?.kind !== 'value') return undefined;
  try {
    const parsed: unknown = JSON.parse(parameter.raw);
    return typeof parsed === 'string' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parameterSpan(block: PslExtensionBlock, key: string): PslSpan {
  const parameter = block.parameters[key];
  return parameter === undefined ? block.span : parameter.span;
}

export function interpretPrisma7Documents(
  input: InterpretPrisma7DocumentsInput,
): Result<Contract, ContractSourceDiagnostics> {
  const { binding } = input;
  const diagnostics: ContractSourceDiagnostic[] = [...input.seedDiagnostics];
  const defaultNamespaceId = binding.target.defaultNamespaceId;
  const datasources: SourceBlock[] = [];
  const enumBlocks: SourceBlock[] = [];
  const models: ModelDeclaration[] = [];
  const ignoredModels = new Set<string>();
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

  for (const { document, sourceFile, sourceId } of input.documents) {
    const { table, diagnostics: tableDiagnostics } = buildSymbolTable({
      document,
      sourceFile,
      pslBlockDescriptors: {},
    });
    for (const diagnostic of tableDiagnostics) {
      diagnostics.push({
        code: diagnostic.code,
        message: diagnostic.message,
        sourceId,
        span: rangeToPslSpan(diagnostic.range, sourceFile),
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
    for (const block of Object.values(table.topLevel.blocks)) {
      switch (block.keyword) {
        case 'datasource':
          datasources.push({ block, sourceId, sourceFile });
          break;
        case 'generator':
          break;
        case 'enum':
          if (claimName('enum', block.name, sourceId, block.span)) {
            enumBlocks.push({ block, sourceId, sourceFile });
          }
          break;
        case 'view':
          diagnostics.push(
            prisma7Diagnostic(
              'PSL.PRISMA7_VIEW_UNSUPPORTED',
              `View "${block.name}" is not supported; Prisma 8 has no views. Remove the view or replace it with a model over the underlying table.`,
              sourceId,
              keywordPslSpan(block.node.syntax, block.keyword, sourceFile),
            ),
          );
          break;
        default:
          unsupported(block.keyword, keywordPslSpan(block.node.syntax, block.keyword, sourceFile));
      }
    }
    for (const namespace of Object.values(table.topLevel.namespaces)) {
      for (const { span } of namespace.declarations) {
        unsupported('namespace', span);
      }
    }
    for (const compositeType of Object.values(table.topLevel.compositeTypes)) {
      unsupported('type', compositeType.span);
    }
    for (const namedType of Object.values(table.topLevel.namedTypes)) {
      unsupported('types', namedType.span);
    }
    for (const symbol of Object.values(table.topLevel.models)) {
      if (!claimName('model', symbol.name, sourceId, symbol.span)) continue;
      const declaration = readModelDeclaration(
        symbol,
        sourceId,
        defaultNamespaceId,
        binding.indexTypes,
        diagnostics,
      );
      if (declaration === undefined) {
        ignoredModels.add(symbol.name);
      } else {
        models.push(declaration);
      }
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

  const modelNames = new Set([...models.map((model) => model.symbol.name), ...ignoredModels]);
  const scalarColumnDescriptors = collectScalarTypeConstructors(input.authoringContributions.type);
  const composedExtensions = new Set(input.composedExtensions);
  const builds = new Map<string, ModelBuild>();
  for (const declaration of models) {
    const build: ModelBuild = {
      declaration,
      columns: new Map(),
      ignoredFields: new Set(),
      ignoredRelationFields: [],
      rejectedFields: new Set(),
      idFields: declaration.id?.fields ?? [],
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
        scalarColumnDescriptors,
        composedExtensions,
        input,
        diagnostics,
      });
      if (
        diagnostics.length > reported &&
        !build.columns.has(field.name) &&
        !build.ignoredFields.has(field.name)
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
      tableSpan:
        build.declaration.symbol.attributes.find((attribute) => attribute.name === 'map')?.span ??
        build.declaration.symbol.span,
      namespaceId: build.declaration.namespaceId,
      sourceId: build.declaration.sourceId,
      columns: build.columns,
      ignoredFields: build.ignoredFields,
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
  for (const [modelName, build] of builds) {
    const model = relationModels.get(modelName);
    if (model === undefined) continue;
    const ignoredAmong = (fieldNames: readonly string[] | undefined): readonly string[] =>
      fieldNames?.filter((name) => build.ignoredFields.has(name)) ?? [];
    const idAttribute = build.declaration.id;
    const ignoredIdFields = ignoredAmong(idAttribute?.fields);
    if (idAttribute !== undefined && ignoredIdFields.length > 0) {
      diagnostics.push(
        ignoredFieldReferenced({
          modelName,
          fieldNames: ignoredIdFields,
          usedBy: `@@id on model "${modelName}"`,
          constraint: 'primary key',
          sourceId: model.sourceId,
          span: idAttribute.span,
        }),
      );
    }
    const id = keyColumns(model, model.idFields);
    const indexes = [
      ...build.uniqueIndexes.map((attribute) => ({ attribute, unique: true })),
      ...build.declaration.indexes.map((attribute) => ({ attribute, unique: false })),
    ].flatMap(({ attribute, unique }) => {
      const ignoredIndexFields = ignoredAmong(attribute.fields);
      if (ignoredIndexFields.length > 0) {
        diagnostics.push(
          ignoredFieldReferenced({
            modelName,
            fieldNames: ignoredIndexFields,
            usedBy: `${unique ? '@@unique' : '@@index'} on model "${modelName}"`,
            constraint: unique ? 'unique index' : 'index',
            sourceId: model.sourceId,
            span: attribute.span,
          }),
        );
        return [];
      }
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
    modelNodes.push({
      modelName,
      tableName: model.tableName,
      namespaceId: model.namespaceId,
      fields: [...build.columns.values()],
      ...(id !== undefined && id.length > 0 ? { id: { columns: id } } : {}),
      ...(indexes.length > 0 ? { indexes } : {}),
      ...(foreignKeys !== undefined ? { foreignKeys } : {}),
      ...(relations !== undefined ? { relations } : {}),
    });
  }
  for (const [key, junction] of lowered.junctions) {
    const relations = lowered.relations.get(key);
    modelNodes.push(relations === undefined ? junction : { ...junction, relations });
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
      },
      input.codecLookup,
    ),
  );
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
  const block = datasource.block.block;
  const provider = scalarValue(block, 'provider');
  if (provider === undefined || !binding.providers.includes(provider)) {
    diagnostics.push(
      prisma7Diagnostic(
        'PSL.PRISMA7_PROVIDER_MISMATCH',
        provider === undefined
          ? `The datasource block declares no string \`provider\`; this contract source reads Prisma 7 schemas for provider "${namedProvider}".`
          : `The datasource provider is "${provider}"; this contract source reads Prisma 7 schemas for provider "${namedProvider}".`,
        datasource.sourceId,
        parameterSpan(block, 'provider'),
      ),
    );
  }
  const relationModeEdits = {
    relationMode: 'Removing relationMode, or setting it to "foreignKeys"',
    referentialIntegrity:
      'Removing referentialIntegrity, or replacing it with relationMode = "foreignKeys"',
  };
  for (const [property, edit] of Object.entries(relationModeEdits)) {
    if (scalarValue(block, property) !== 'prisma') continue;
    diagnostics.push(
      prisma7Diagnostic(
        'PSL.PRISMA7_RELATION_MODE_UNSUPPORTED',
        `${property} = "prisma" is not supported: the contract declares the foreign keys its relations need, and in this mode Prisma 7 creates none. ${edit}, makes Prisma 7's next migration add those foreign keys, and that migration fails if any existing row breaks one.`,
        datasource.sourceId,
        parameterSpan(block, property),
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
    const column = model.columns.get(fieldName);
    if (column === undefined) return undefined;
    columns.push(column.columnName);
  }
  return columns;
}

function readModelDeclaration(
  symbol: ModelSymbol,
  sourceId: string,
  defaultNamespaceId: string,
  indexTypes: Prisma7TargetBinding['indexTypes'],
  diagnostics: ContractSourceDiagnostic[],
): ModelDeclaration | undefined {
  if (symbol.attributes.some((attribute) => attribute.name === 'ignore')) return undefined;
  let tableName = symbol.name;
  let namespaceId = defaultNamespaceId;
  let id: IndexAttribute | undefined;
  const uniqueIndexes: IndexAttribute[] = [];
  const indexes: IndexAttribute[] = [];
  for (const attribute of symbol.attributes) {
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
  return { symbol, sourceId, namespaceId, tableName, id, uniqueIndexes, indexes };
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
  const { block, sourceId, sourceFile } = source;
  let typeName = block.name;
  let namespaceId = defaultNamespaceId;
  for (const attribute of readResolvedAttributes(block.node.attributes(), sourceFile)) {
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
  for (const entry of block.node.entries()) {
    const name = entry.key()?.name();
    if (name === undefined) continue;
    let value = name;
    const span = nodePslSpan(entry.syntax, sourceFile);
    for (const attributeNode of entry.attributes()) {
      const attribute = readResolvedAttribute(attributeNode, sourceFile);
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
    const block: PslExtensionBlock & { readonly namespaceId: string } = {
      kind: entityKind,
      keyword: entityKind,
      name: declaration.name,
      parameters: Object.fromEntries(
        declaration.members.map((member) => [
          member.name,
          { kind: 'value', raw: JSON.stringify(member.value), span: member.span },
        ]),
      ),
      blockAttributes: [],
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

interface FieldUse {
  readonly usedBy: string;
  readonly constraint: 'primary key' | 'unique index' | 'index' | 'foreign key';
}

function keysUsingField(field: FieldSymbol, model: ModelDeclaration): readonly FieldUse[] {
  const modelName = model.symbol.name;
  const uses: FieldUse[] = [];
  for (const attribute of field.attributes) {
    if (attribute.name === 'id') uses.push({ usedBy: 'its @id', constraint: 'primary key' });
    if (attribute.name === 'unique')
      uses.push({ usedBy: 'its @unique', constraint: 'unique index' });
  }
  if (model.id?.fields?.includes(field.name)) {
    uses.push({ usedBy: `@@id on model "${modelName}"`, constraint: 'primary key' });
  }
  for (const unique of model.uniqueIndexes) {
    if (unique.fields?.includes(field.name)) {
      uses.push({ usedBy: `@@unique on model "${modelName}"`, constraint: 'unique index' });
    }
  }
  for (const index of model.indexes) {
    if (index.fields?.includes(field.name)) {
      uses.push({ usedBy: `@@index on model "${modelName}"`, constraint: 'index' });
    }
  }
  for (const other of Object.values(model.symbol.fields)) {
    if (other.attributes.some((attribute) => attribute.name === 'ignore')) continue;
    const relation = other.attributes.find((attribute) => attribute.name === 'relation');
    const parsed =
      relation === undefined
        ? undefined
        : parseRelationAttribute(relation, other.name, model.sourceId, []);
    if (parsed?.fields?.includes(field.name)) {
      uses.push({
        usedBy: `relation field "${modelName}.${other.name}"`,
        constraint: 'foreign key',
      });
    }
  }
  return uses;
}

function nativeTypeMessage(input: {
  readonly label: string;
  readonly nativeType: string;
  readonly field: FieldSymbol;
  readonly model: ModelDeclaration;
  readonly defaultAttribute: ResolvedAttribute | undefined;
}): string {
  const { label, nativeType, field, model } = input;
  const uses = keysUsingField(field, model);
  if (uses.length > 0) {
    const constraints = [...new Set(uses.map((use) => `the ${use.constraint}`))];
    return `${label}: native type "@db.${nativeType}" has no Prisma 8 codec, and ${andList(uses.map((use) => use.usedBy))} ${uses.length === 1 ? 'uses' : 'use'} the field, so @ignore on the field does not help: Prisma 7 still creates ${andList(constraints)} over the column. Add @@ignore to model "${model.symbol.name}" to keep the model out of the contract: Prisma 7's next migration is empty, but the model disappears from the Prisma 7 client too, and every relation field in another model that points to it needs @ignore, which removes that field from the Prisma 7 client as well. Changing the field's type instead changes the column type on Prisma 7's next migration.`;
  }
  const cannotInsert =
    !field.optional && !field.list && !givesColumnDefault(input.defaultAttribute);
  return `${label}: native type "@db.${nativeType}" has no Prisma 8 codec. Add @ignore to the field to keep its column out of the contract: Prisma 7's next migration is empty, and the field disappears from the Prisma 7 client too${cannotInsert ? '; because the field is required and its column has no default, neither client can then insert rows' : ''}. Changing the field's type instead changes the column type on Prisma 7's next migration.`;
}

interface ReadFieldArgs {
  readonly field: FieldSymbol;
  readonly build: ModelBuild;
  readonly modelNames: ReadonlySet<string>;
  readonly ignoredModels: ReadonlySet<string>;
  readonly enums: ReadonlyMap<string, EnumDeclaration>;
  readonly namespaceEntities: NamespaceEntities;
  readonly scalarColumnDescriptors: ReadonlyMap<string, ColumnDescriptor>;
  readonly composedExtensions: ReadonlySet<string>;
  readonly input: InterpretPrisma7DocumentsInput;
  readonly diagnostics: ContractSourceDiagnostic[];
}

function readIgnoredField(field: FieldSymbol, isRelationField: boolean, args: ReadFieldArgs): void {
  const { build, diagnostics } = args;
  const model = build.declaration;
  if (isRelationField) {
    if (args.ignoredModels.has(field.typeName)) return;
    const relation = field.attributes.find((attribute) => attribute.name === 'relation');
    build.ignoredRelationFields.push({
      field,
      targetModelName: field.typeName,
      attribute:
        relation === undefined
          ? undefined
          : parseRelationAttribute(relation, field.name, model.sourceId, []),
    });
    return;
  }
  for (const attribute of field.attributes) {
    if (attribute.name !== 'id' && attribute.name !== 'unique') continue;
    if (attribute.name === 'id') build.idFields = [field.name];
    diagnostics.push(
      ignoredFieldReferenced({
        modelName: model.symbol.name,
        fieldNames: [field.name],
        usedBy: `its @${attribute.name}`,
        constraint: attribute.name === 'id' ? 'primary key' : 'unique index',
        sourceId: model.sourceId,
        span: attribute.span,
      }),
    );
  }
}

function readField(args: ReadFieldArgs): void {
  const { field, build, diagnostics, input } = args;
  const { binding } = input;
  const model = build.declaration;
  const sourceId = model.sourceId;
  const label = `Field "${model.symbol.name}.${field.name}"`;
  const isRelationField =
    args.modelNames.has(field.typeName) && field.typeConstructor === undefined;
  if (field.attributes.some((attribute) => attribute.name === 'ignore')) {
    build.ignoredFields.add(field.name);
    readIgnoredField(field, isRelationField, args);
    return;
  }

  let columnName = field.name;
  let nativeType: { readonly name: string; readonly attribute: ResolvedAttribute } | undefined;
  let relation: ResolvedAttribute | undefined;
  let defaultAttribute: ResolvedAttribute | undefined;
  let updatedAt: ResolvedAttribute | undefined;
  for (const attribute of field.attributes) {
    if (attribute.name === 'map' && !isRelationField) {
      columnName = requireStringArgument(attribute, label, sourceId, diagnostics) ?? columnName;
    } else if (attribute.name.startsWith('db.') && !isRelationField) {
      nativeType = { name: attribute.name.slice('db.'.length), attribute };
    } else if (attribute.name === 'id' && !isRelationField) {
      if (
        parseIndexAttribute(attribute, label, sourceId, binding.indexTypes, diagnostics) !==
        undefined
      ) {
        build.idFields = [field.name];
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
  if (field.typeConstructor !== undefined) {
    diagnostics.push(
      prisma7Diagnostic(
        'PSL.PRISMA7_UNSUPPORTED_TYPE',
        `${label} has type "${field.typeConstructor.path.join('.')}(...)", which has no Prisma 8 codec, so model "${model.symbol.name}" cannot use this contract source while it has the field. Prisma 7 rejects @ignore on an Unsupported field, and removing the field drops its column on Prisma 7's next migration. Adding @@ignore to model "${model.symbol.name}" keeps the model out of the contract: Prisma 7's next migration is empty, but the model disappears from the Prisma 7 client too, and every relation field in another model that points to it needs @ignore, which removes that field from the Prisma 7 client as well.`,
        sourceId,
        field.typeConstructor.span,
      ),
    );
    return;
  }
  if (args.ignoredModels.has(field.typeName)) return;
  if (isRelationField) {
    const attribute =
      relation === undefined
        ? undefined
        : parseRelationAttribute(relation, label, sourceId, diagnostics);
    if (relation !== undefined && attribute === undefined) return;
    build.relationFields.push({ field, targetModelName: field.typeName, attribute });
    return;
  }

  const enumDeclaration = args.enums.get(field.typeName);
  let call: ResolvedTypeConstructorCall;
  if (enumDeclaration !== undefined) {
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
    call = {
      path: binding.nativeEnum.typeConstructor,
      args: [{ kind: 'positional', value: enumDeclaration.name, span: field.span }],
      span: field.span,
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
    let mapping = scalar;
    let span = field.span;
    if (nativeType !== undefined) {
      const native = prisma7NativeTypeMapping(
        binding.typeMap,
        nativeType.name,
        nativeType.attribute.args.map((arg) => arg.value),
      );
      if (native === undefined) {
        diagnostics.push(
          prisma7Diagnostic(
            'PSL.PRISMA7_NATIVE_TYPE_UNSUPPORTED',
            nativeTypeMessage({
              label,
              nativeType: nativeType.name,
              field,
              model,
              defaultAttribute,
            }),
            sourceId,
            nativeType.attribute.span,
          ),
        );
        return;
      }
      mapping = native;
      span = nativeType.attribute.span;
    }
    call = {
      path: [mapping.constructorName],
      args: mapping.args.map((value) => ({ kind: 'positional', value, span })),
      span,
    };
  }

  const namespaceExtensionEntities = args.namespaceEntities.get(model.namespaceId);
  const resolved = resolveFieldTypeDescriptor({
    field: { ...field, typeConstructor: call },
    enumTypeDescriptors: EMPTY_DESCRIPTORS,
    namedTypeDescriptors: EMPTY_DESCRIPTORS,
    scalarColumnDescriptors: args.scalarColumnDescriptors,
    authoringContributions: input.authoringContributions,
    composedExtensions: args.composedExtensions,
    familyId: binding.target.familyId,
    targetId: binding.target.targetId,
    diagnostics,
    sourceId,
    entityLabel: label,
    namespaceId: model.namespaceId,
    ...ifDefined('namespaceExtensionEntities', namespaceExtensionEntities),
    codecLookup: input.codecLookup,
  });
  if (!resolved.ok) {
    if (!resolved.alreadyReported) {
      diagnostics.push(
        prisma7Diagnostic(
          'PSL.PRISMA7_UNSUPPORTED_TYPE',
          `${label} type "${field.typeName}" could not be resolved against target "${binding.target.targetId}".`,
          sourceId,
          field.span,
        ),
      );
    }
    return;
  }
  const updatedAtGeneratorId =
    updatedAt === undefined ? undefined : binding.updatedAtGeneratorId(resolved.descriptor.codecId);
  if (updatedAt !== undefined && updatedAtGeneratorId === undefined) {
    const withoutUpdatedAt =
      defaultAttribute !== undefined && givesColumnDefault(defaultAttribute)
        ? `. Its ${attributeText(defaultAttribute)} still sets the value on create, and neither client changes it on update.`
        : field.optional
          ? ', but neither client then fills the value, so it stays empty unless a client writes it, and updates leave it unchanged.'
          : ', but neither client then fills the value, so both require it on create and leave it unchanged on update.';
    diagnostics.push(
      prisma7Diagnostic(
        'PSL.PRISMA7_UPDATED_AT_TYPE_UNSUPPORTED',
        `${label}: @updatedAt is not supported on this column, because Prisma 8 has no generator for column type "${resolved.descriptor.nativeType}" yet. Remove @updatedAt: Prisma 7's next migration is empty${withoutUpdatedAt}`,
        sourceId,
        updatedAt.span,
      ),
    );
    return;
  }
  if (updatedAt !== undefined && defaultAttribute !== undefined) {
    const written = attributeText(defaultAttribute);
    diagnostics.push(
      prisma7Diagnostic(
        'PSL.PRISMA7_UPDATED_AT_WITH_DEFAULT_UNSUPPORTED',
        `${label} combines @updatedAt with ${written}, which Prisma 8 cannot express yet. Remove ${written}: @updatedAt still sets the value on create and on update, and Prisma 7's next migration removes the column default.`,
        sourceId,
        defaultAttribute.span,
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
          codecId: resolved.descriptor.codecId,
          codecLookup: input.codecLookup,
          literalForm: binding.literalDefaultForm(resolved.descriptor),
          enumMembers:
            enumDeclaration === undefined
              ? undefined
              : new Map(enumDeclaration.members.map((member) => [member.name, member.value])),
          controlMutationDefaults: input.controlMutationDefaults,
          sourceId,
          diagnostics,
        });
  if (defaultAttribute !== undefined && lowered === undefined) return;
  const updatedAtGenerator =
    updatedAtGeneratorId === undefined
      ? undefined
      : { kind: 'generator' as const, id: updatedAtGeneratorId };
  const generator = updatedAtGenerator ?? lowered?.onCreate;
  const generatingAttribute = updatedAt ?? defaultAttribute;
  if (generator !== undefined && generatingAttribute !== undefined && field.optional) {
    const written = attributeText(generatingAttribute);
    diagnostics.push(
      prisma7Diagnostic(
        'PSL.PRISMA7_OPTIONAL_GENERATED_FIELD_UNSUPPORTED',
        `${label} is optional and its value comes from ${written}, which Prisma 8 cannot express on an optional field yet. Remove ${written} and keep the "?": the database does not change, and both clients then stop filling the value.`,
        sourceId,
        generatingAttribute.span,
      ),
    );
    return;
  }
  const executionDefaults =
    updatedAtGenerator !== undefined
      ? { onCreate: updatedAtGenerator, onUpdate: updatedAtGenerator }
      : generator !== undefined
        ? { onCreate: generator }
        : undefined;
  build.columns.set(field.name, {
    fieldName: field.name,
    columnName,
    descriptor: resolved.descriptor,
    nullable: field.optional || field.list,
    // Prisma 7 creates no CHECK constraint on list columns; Prisma 8 would derive one.
    ...(field.list ? { many: true, noCheck: ['elementNotNull' as const] } : {}),
    ...ifDefined('default', lowered?.storage),
    ...ifDefined('executionDefaults', executionDefaults),
  });
}
