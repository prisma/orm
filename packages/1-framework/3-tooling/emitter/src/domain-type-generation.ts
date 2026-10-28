import type {
  Contract,
  ContractField,
  ContractManyToManyRelation,
  ContractModelBase,
  ContractValueObject,
  ContractValueObjectField,
  ContractWithDomain,
  CrossReference,
  JsonValue,
  StorageBase,
  ValueObjectReference,
} from '@internal/contract/types';
import { valueObjectsWithCoordinates } from '@internal/contract/types';
import type { CodecLookup } from '@internal/framework-components/codec';
import {
  type ImportSpecifierResolver,
  keepInternalSpecifiers,
  type TypesImportSpec,
} from '@internal/framework-components/emission';
import { entityAt } from '@internal/framework-components/ir';
import { type ImportRequirement, renderImports, tsStringLiteral } from '@internal/ts-render';
import { blindCast } from '@internal/utils/casts';
import { emitterError } from './emitter-errors';
import { isSafeTypeExpression } from './type-expression-safety';

export function serializeValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return 'undefined';
  }
  if (typeof value === 'string') {
    return tsStringLiteral(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'bigint') {
    return `${value}n`;
  }
  if (Array.isArray(value)) {
    const items = value.map((v) => serializeValue(v)).join(', ');
    return `readonly [${items}]`;
  }
  if (typeof value === 'object') {
    // Key order carries no meaning in a literal type, and the same contract
    // reaches here in authoring order from the source and in canonical order
    // from contract.json. Sorting makes both render the same text.
    const entries = Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([k, v]) => `readonly ${serializeObjectKey(k)}: ${serializeValue(v)}`);
    return `{ ${entries.join('; ')} }`;
  }
  return 'unknown';
}

export function serializeObjectKey(key: string): string {
  if (/^[$A-Z_a-z][$\w]*$/.test(key)) {
    return key;
  }
  return serializeValue(key);
}

export function serializeNamespaceId(value: string): string {
  return `${serializeValue(value)} & NamespaceId`;
}

export function serializeCrossReference(ref: CrossReference): string {
  const namespace = serializeNamespaceId(String(ref.namespace));
  const model = serializeValue(ref.model);
  const space = ref.space !== undefined ? `; readonly space: ${serializeValue(ref.space)}` : '';
  return `{ readonly namespace: ${namespace}; readonly model: ${model}${space} }`;
}

export function generateRootsType(roots: Record<string, CrossReference> | undefined): string {
  if (!roots || Object.keys(roots).length === 0) {
    return 'Record<string, never>';
  }
  const entries = Object.entries(roots)
    .map(([key, value]) => `readonly ${serializeObjectKey(key)}: ${serializeCrossReference(value)}`)
    .join('; ');
  return `{ ${entries} }`;
}

function valueObjectFieldTypeText(type: ValueObjectReference): string {
  return `{ readonly kind: "valueObject"; readonly plane: "storage"; readonly namespaceId: ${serializeValue(type.namespaceId)}; readonly entityKind: "valueObject"; readonly entityName: ${serializeValue(type.entityName)} }`;
}

function contractFieldModifierSuffix(field: ContractField): string {
  const many = field.many
    ? `; readonly many: { readonly elementNullable: ${field.many.elementNullable} }`
    : '';
  const dict = field.dict === true ? '; readonly dict: true' : '';
  return many + dict;
}

export function generateModelFieldEntry(fieldName: string, field: ContractField): string {
  const mods = contractFieldModifierSuffix(field);
  const { nullable, type } = field;
  if (type.kind === 'scalar') {
    const typeParamsSpec =
      type.typeParams && Object.keys(type.typeParams).length > 0
        ? `; readonly typeParams: ${serializeValue(type.typeParams)}`
        : '';
    return `readonly ${serializeObjectKey(fieldName)}: { readonly nullable: ${nullable}; readonly type: { readonly kind: "scalar"; readonly codecId: ${serializeValue(type.codecId)}${typeParamsSpec} }${mods} }`;
  }
  if (type.kind === 'valueObject') {
    return `readonly ${serializeObjectKey(fieldName)}: { readonly nullable: ${nullable}; readonly type: ${valueObjectFieldTypeText(type)}${mods} }`;
  }
  return `readonly ${serializeObjectKey(fieldName)}: { readonly nullable: ${nullable}; readonly type: ${serializeValue(type)}${mods} }`;
}

// An empty field map is `{}` in a descriptor, since `keyof Record<string, never>` is `string`.
function objectTypeOpenWhenEmpty(entries: readonly string[]): string {
  return entries.length > 0 ? `{ ${entries.join('; ')} }` : '{}';
}

export function generateModelFieldsType(fields: Record<string, ContractField>): string {
  const fieldEntries: string[] = [];
  for (const [fieldName, field] of Object.entries(fields)) {
    fieldEntries.push(generateModelFieldEntry(fieldName, field));
  }
  return objectTypeOpenWhenEmpty(fieldEntries);
}

export function generateModelRelationsType(relations: Record<string, unknown>): string {
  const relationEntries: string[] = [];

  for (const [relName, rel] of Object.entries(relations)) {
    if (typeof rel !== 'object' || rel === null) continue;
    const relObj = blindCast<
      Record<string, unknown>,
      'relation narrowed to a non-null object above'
    >(rel);

    // Option B: cross-space relations are declared but non-navigable.
    // A relation whose `to.space` is set lives in a foreign contract space;
    // emitting `never` for its entry makes `include` of it a compile error
    // while the relation is still present in the contract JSON for introspection.
    const toRef = relObj['to'];
    // Option B: cross-space relations are declared but non-navigable.
    // When the relation's `to` ref carries a `space` field the target lives
    // in a foreign contract space; emit `never` so `include` of it is a
    // compile error while the relation stays in the contract JSON.
    if (
      toRef !== null &&
      typeof toRef === 'object' &&
      'space' in toRef &&
      toRef.space !== undefined
    ) {
      relationEntries.push(`readonly ${serializeObjectKey(relName)}: never`);
      continue;
    }

    const parts: string[] = [];

    if (toRef)
      parts.push(
        `readonly to: ${serializeCrossReference(blindCast<CrossReference, 'contract JSON schema-validated before serialization; truthy check above confirms presence'>(toRef))}`,
      );
    if (relObj['cardinality'])
      parts.push(`readonly cardinality: ${serializeValue(relObj['cardinality'])}`);
    if (typeof relObj['nullable'] === 'boolean')
      parts.push(`readonly nullable: ${relObj['nullable']}`);

    const on = blindCast<
      { localFields?: string[]; targetFields?: string[] } | undefined,
      'contract relation on block is validated before type generation'
    >(relObj['on']);
    if (on && (!on.localFields || !on.targetFields)) {
      throw emitterError(
        'CONTRACT.RELATION_INVALID',
        `Relation "${relName}" has an "on" block but is missing localFields or targetFields`,
        { meta: { relation: relName } },
      );
    }
    if (on?.localFields && on.targetFields) {
      const localFields = on.localFields.map((f) => serializeValue(f)).join(', ');
      const targetFields = on.targetFields.map((f) => serializeValue(f)).join(', ');
      parts.push(
        `readonly on: { readonly localFields: readonly [${localFields}]; readonly targetFields: readonly [${targetFields}] }`,
      );
    }

    if (relObj['cardinality'] === 'N:M') {
      const { through } = blindCast<
        ContractManyToManyRelation,
        'contract JSON schema-validated before serialization; cardinality N:M check above confirms the junction variant carries through'
      >(relObj);
      const table = serializeValue(through.table);
      const namespaceId = serializeValue(through.namespaceId);
      const parentColumns = through.parentColumns.map((c) => serializeValue(c)).join(', ');
      const childColumns = through.childColumns.map((c) => serializeValue(c)).join(', ');
      const targetColumns = through.targetColumns.map((c) => serializeValue(c)).join(', ');
      parts.push(
        `readonly through: { readonly table: ${table}; readonly namespaceId: ${namespaceId}; readonly parentColumns: readonly [${parentColumns}]; readonly childColumns: readonly [${childColumns}]; readonly targetColumns: readonly [${targetColumns}] }`,
      );
    }

    if (parts.length > 0) {
      relationEntries.push(`readonly ${serializeObjectKey(relName)}: { ${parts.join('; ')} }`);
    }
  }

  if (relationEntries.length === 0) {
    return 'Record<string, never>';
  }

  return `{ ${relationEntries.join('; ')} }`;
}

export function generateModelsType(
  models: Record<string, ContractModelBase>,
  generateModelStorage: (modelName: string, model: ContractModelBase) => string,
): string {
  if (!models || Object.keys(models).length === 0) {
    return 'Record<string, never>';
  }

  const modelTypes: string[] = [];
  for (const [modelName, model] of Object.entries(models).sort(([a], [b]) => a.localeCompare(b))) {
    const fieldsType = generateModelFieldsType(model.fields);
    const relationsType = generateModelRelationsType(model.relations);
    const storageType = generateModelStorage(modelName, model);

    const modelParts: string[] = [
      `readonly fields: ${fieldsType}`,
      `readonly relations: ${relationsType}`,
      `readonly storage: ${storageType}`,
    ];

    if (model.owner) {
      modelParts.push(`readonly owner: ${serializeValue(model.owner)}`);
    }
    if (model.discriminator) {
      modelParts.push(`readonly discriminator: ${serializeValue(model.discriminator)}`);
    }
    if (model.variants) {
      const variantEntries = Object.entries(model.variants)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(
          ([value, ref]) =>
            `readonly ${serializeObjectKey(value)}: ${serializeCrossReference(ref)}`,
        );
      modelParts.push(`readonly variants: { ${variantEntries.join('; ')} }`);
    }
    if (model.base) {
      modelParts.push(`readonly base: ${serializeCrossReference(model.base)}`);
    }

    modelTypes.push(`readonly ${serializeObjectKey(modelName)}: { ${modelParts.join('; ')} }`);
  }

  return `{ ${modelTypes.join('; ')} }`;
}

export function deduplicateImports(imports: TypesImportSpec[]): TypesImportSpec[] {
  const seenKeys = new Set<string>();
  const result: TypesImportSpec[] = [];
  for (const imp of imports) {
    const key = `${imp.package}::${imp.named}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      result.push(imp);
    }
  }
  return result;
}

export function generateImportLines(
  imports: TypesImportSpec[],
  resolveImportSpecifier: ImportSpecifierResolver = keepInternalSpecifiers,
): string[] {
  const requirements: ImportRequirement[] = imports.map((imp) => ({
    moduleSpecifier: resolveImportSpecifier(imp.package),
    symbol: imp.named,
    alias: imp.alias,
    typeOnly: true,
  }));
  const rendered = renderImports(requirements);
  return rendered === '' ? [] : rendered.split('\n');
}

export function generateCodecTypeIntersection(
  imports: ReadonlyArray<TypesImportSpec>,
  named: string,
): string {
  const aliases = imports.filter((imp) => imp.named === named).map((imp) => imp.alias);
  return aliases.join(' & ') || 'Record<string, never>';
}

export function serializeExecutionType(execution: Record<string, unknown>): string {
  const parts: string[] = ['readonly executionHash: ExecutionHash'];
  for (const [key, value] of Object.entries(execution)) {
    if (key === 'executionHash') continue;
    parts.push(`readonly ${serializeObjectKey(key)}: ${serializeValue(value)}`);
  }
  return `{ ${parts.join('; ')} }`;
}

export function generateHashTypeAliases(hashes: {
  readonly storageHash: string;
  readonly executionHash?: string;
  readonly profileHash: string;
}): string {
  const executionHashType = hashes.executionHash
    ? `ExecutionHashBase<${serializeValue(hashes.executionHash)}>`
    : 'ExecutionHashBase<string>';

  return [
    `export type StorageHash = StorageHashBase<${serializeValue(hashes.storageHash)}>;`,
    `export type ExecutionHash = ${executionHashType};`,
    `export type ProfileHash = ProfileHashBase<${serializeValue(hashes.profileHash)}>;`,
  ].join('\n');
}

/**
 * A field's permitted values (codec-encoded) plus the codec that types them: read from the domain enum the field names, or supplied for other model fields by the family's {@link EmissionSpi.resolveStorageValueSet}. The framework renders these into a TS literal union through the codec seam ({@link renderValueSetType}).
 */
export type ResolvedFieldValueSet = {
  readonly encodedValues: readonly JsonValue[];
  readonly codecId: string;
};

export type StorageValueSetResolver = (
  modelName: string,
  fieldName: string,
  model: ContractModelBase,
) => ResolvedFieldValueSet | undefined;

/**
 * Renders a value set (a field/column's permitted values, codec-encoded) into a TS literal union by
 * routing **each** value through the codec's `renderValueLiteral` — the seam owned by the codec, not
 * a generic serializer. `side`: `output` = read type, `input` = create/update type.
 *
 * Returns `undefined` — signalling the caller to fall back to the codec's full output type — when
 * the lookup is absent, has no `renderValueLiteralFor`, the value set is empty, or **any** value
 * isn't literal-expressible, which every value of a codec that declares `keepsWrittenForm` is. A
 * caller that needs column and field types to agree shares this so both compute the union
 * identically.
 */
export function renderValueSetType(
  values: readonly JsonValue[],
  codecId: string,
  side: 'output' | 'input',
  codecLookup: CodecLookup | undefined,
): string | undefined {
  if (values.length === 0) return undefined;
  const literals: string[] = [];
  for (const value of values) {
    const lit = renderValueLiteralType(value, codecId, side, codecLookup);
    if (lit === undefined) return undefined;
    literals.push(lit);
  }
  return literals.join(' | ');
}

/** The TS literal type the codec renders for one stored value, or `undefined` when it renders none or what it renders is not a safe type expression. */
export function renderValueLiteralType(
  value: JsonValue,
  codecId: string,
  side: 'output' | 'input',
  codecLookup: CodecLookup | undefined,
): string | undefined {
  const lit = codecLookup?.renderValueLiteralFor?.(codecId, value, side);
  return lit === undefined || !isSafeTypeExpression(lit) ? undefined : lit;
}

/** The local alias for the union of the stack's parameterized output type functions. */
export const PARAMETERIZED_OUTPUT_TYPE_FUNCTIONS = 'ParameterizedOutputTypeFunctions';

/** The declaration of {@link PARAMETERIZED_OUTPUT_TYPE_FUNCTIONS} for the type functions the stack's components declare. */
export function parameterizedOutputTypeFunctionsAlias(
  typeFunctions: ReadonlyArray<TypesImportSpec>,
): string {
  const aliases = [...new Set(typeFunctions.map((typeFunction) => typeFunction.alias))];
  return `type ${PARAMETERIZED_OUTPUT_TYPE_FUNCTIONS} = ${aliases.length > 0 ? aliases.join(' | ') : 'never'};`;
}

/** `FieldOutputTypes` (`side` `'output'`) or `FieldInputTypes` (`'input'`): the shared generic applied to the emitted contract's domain, with `FieldTypeOverrides`, and to its storage namespaces. */
export function fieldTypesMapExpression(side: 'output' | 'input'): string {
  return `FieldTypesFromDomain<ContractBase['domain']['namespaces'], CodecTypes, ${PARAMETERIZED_OUTPUT_TYPE_FUNCTIONS}, FieldTypeOverrides, ${serializeValue(side)}, ContractBase['storage']['namespaces']>`;
}

export function generateContractFieldDescriptor(fieldName: string, field: ContractField): string {
  const modStr = contractFieldModifierSuffix(field);
  const { type } = field;
  if (type.kind === 'scalar') {
    const typeParamsSpec =
      type.typeParams && Object.keys(type.typeParams).length > 0
        ? `; readonly typeParams: ${serializeValue(type.typeParams)}`
        : '';
    return `readonly ${serializeObjectKey(fieldName)}: { readonly nullable: ${field.nullable}; readonly type: { readonly kind: "scalar"; readonly codecId: ${serializeValue(type.codecId)}${typeParamsSpec} }${modStr} }`;
  }
  if (type.kind === 'valueObject') {
    return `readonly ${serializeObjectKey(fieldName)}: { readonly nullable: ${field.nullable}; readonly type: ${valueObjectFieldTypeText(type)}${modStr} }`;
  }
  return `readonly ${serializeObjectKey(fieldName)}: { readonly nullable: ${field.nullable}; readonly type: ${serializeValue(type)}${modStr} }`;
}

export function generateValueObjectsDescriptorType(
  valueObjects: Record<string, ContractValueObject> | undefined,
): string {
  if (!valueObjects || Object.keys(valueObjects).length === 0) {
    return 'Record<string, never>';
  }

  const voEntries: string[] = [];
  for (const [voName, vo] of Object.entries(valueObjects)) {
    const fieldEntries: string[] = [];
    for (const [fieldName, field] of Object.entries(vo.fields)) {
      fieldEntries.push(generateContractFieldDescriptor(fieldName, field));
    }
    const fieldsType =
      fieldEntries.length > 0 ? `{ ${fieldEntries.join('; ')} }` : 'Record<string, never>';
    voEntries.push(`readonly ${serializeObjectKey(voName)}: { readonly fields: ${fieldsType} }`);
  }

  return `{ ${voEntries.join('; ')} }`;
}

/**
 * `<Name>Output` and `<Name>Input` for each value object, read from the shared generic's value object types at the storage namespace that holds it.
 */
export function generateValueObjectTypeAliases(
  valueObjectNamespaces: ReadonlyArray<readonly [name: string, namespaceId: string]>,
): string {
  if (valueObjectNamespaces.length === 0) {
    return '';
  }
  const generic = (side: 'output' | 'input') =>
    `ValueObjectTypesFromStorage<ContractBase['storage']['namespaces'], CodecTypes, ${PARAMETERIZED_OUTPUT_TYPE_FUNCTIONS}, FieldTypeOverrides, ${serializeValue(side)}>`;
  const aliases = [
    `type ValueObjectOutputTypes = ${generic('output')};`,
    `type ValueObjectInputTypes = ${generic('input')};`,
  ];
  for (const [name, namespaceId] of valueObjectNamespaces) {
    const path = `[${serializeValue(namespaceId)}][${serializeValue(name)}]`;
    aliases.push(`export type ${name}Output = ValueObjectOutputTypes${path};`);
    aliases.push(`export type ${name}Input = ValueObjectInputTypes${path};`);
  }
  return aliases.join('\n');
}

/** A field's or column's type on each side where its codec does not give it, as type text. */
export type TypeOverride = { readonly output?: string; readonly input?: string };

/**
 * The type of a scalar field that its codec does not give, which the shared field type generic takes as an override: the literal union of the value set it holds, or the text its codec renders for its type parameters. `undefined` when the codec gives both sides, and for a value object or union field, which the generic types itself.
 */
export function resolveFieldTypeOverride(
  field: Pick<ContractField, 'type'>,
  codecLookup: CodecLookup | undefined,
  resolvedValueSet: ResolvedFieldValueSet | undefined,
): TypeOverride | undefined {
  const { type } = field;
  if (type.kind !== 'scalar') return undefined;
  if (resolvedValueSet) {
    const override = renderValueSetOverride(
      resolvedValueSet.encodedValues,
      resolvedValueSet.codecId,
      codecLookup,
    );
    if (override !== undefined) return override;
  }
  const typeParams =
    type.typeParams && Object.keys(type.typeParams).length > 0 ? type.typeParams : undefined;
  return renderCodecTypeOverride(type.codecId, typeParams, codecLookup);
}

/** The literal union of a value set on each side whose values all have literal types, or `undefined` when neither side has. */
export function renderValueSetOverride(
  values: readonly JsonValue[],
  codecId: string,
  codecLookup: CodecLookup | undefined,
): TypeOverride | undefined {
  const output = renderValueSetType(values, codecId, 'output', codecLookup);
  const input = renderValueSetType(values, codecId, 'input', codecLookup);
  const override = {
    ...(output !== undefined ? { output } : {}),
    ...(input !== undefined ? { input } : {}),
  };
  return Object.keys(override).length > 0 ? override : undefined;
}

/** The type text a codec renders for these type parameters, on the sides it renders one. */
export function renderCodecTypeOverride(
  codecId: string,
  typeParams: Record<string, unknown> | undefined,
  codecLookup: CodecLookup | undefined,
): TypeOverride | undefined {
  if (codecLookup === undefined || typeParams === undefined) return undefined;
  const output = codecLookup.renderOutputTypeFor(codecId, typeParams);
  const input = codecLookup.renderInputTypeFor?.(codecId, typeParams);
  const override = {
    ...(output && isSafeTypeExpression(output) ? { output } : {}),
    ...(input && isSafeTypeExpression(input) ? { input } : {}),
  };
  return Object.keys(override).length > 0 ? override : undefined;
}

export function renderTypeOverride(override: TypeOverride): string {
  const sides = (['output', 'input'] as const).flatMap((side) => {
    const type = override[side];
    return type === undefined ? [] : [`readonly ${side}: ${type}`];
  });
  return `{ ${sides.join('; ')} }`;
}

type OverrideTree = Map<string, OverrideTree | TypeOverride>;

/** A nested map of type overrides, one level per path segment, ordered by name at every level, leaving out every branch with no entry. */
export function renderTypeOverridesMap(
  entries: ReadonlyArray<readonly [path: readonly string[], type: TypeOverride | undefined]>,
): string {
  const root: OverrideTree = new Map();
  for (const [path, type] of entries) {
    if (type === undefined) continue;
    let node = root;
    for (const segment of path.slice(0, -1)) {
      const child = node.get(segment);
      const next: OverrideTree = child instanceof Map ? child : new Map();
      node.set(segment, next);
      node = next;
    }
    const leaf = path.at(-1);
    if (leaf !== undefined) node.set(leaf, type);
  }
  return renderOverrideTree(root);
}

function renderOverrideTree(tree: OverrideTree): string {
  const parts = [...tree]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([key, value]) =>
        `readonly ${serializeObjectKey(key)}: ${value instanceof Map ? renderOverrideTree(value) : renderTypeOverride(value)}`,
    );
  return `{ ${parts.join('; ')} }`;
}

/**
 * The values a model field's value set holds, with the field's codec. A reference to a domain enum is read from the contract's domain. Any other model field goes to the family's `resolveStorageValueSet`, which reads its storage.
 */
function resolveFieldValueSet(
  field: ContractField,
  contract: Pick<Contract, 'domain'>,
  resolveStorageValueSet: () => ResolvedFieldValueSet | undefined,
): ResolvedFieldValueSet | undefined {
  if (field.valueSet?.plane === 'domain') return resolveDomainValueSet(field, contract);
  return resolveStorageValueSet();
}

function resolveDomainValueSet(
  field: ContractField,
  contract: Pick<Contract, 'domain'>,
): ResolvedFieldValueSet | undefined {
  const ref = field.valueSet;
  if (ref === undefined || field.type.kind !== 'scalar' || ref.entityKind !== 'enum') {
    return undefined;
  }
  const domainEnum = contract.domain.namespaces[ref.namespaceId]?.enum?.[ref.entityName];
  if (domainEnum === undefined) return undefined;
  return {
    encodedValues: domainEnum.members.map((member) => member.value),
    codecId: field.type.codecId,
  };
}

/** The values of the storage value set a value object field names, with the field's codec. */
function resolveValueObjectFieldValueSet(
  field: ContractValueObjectField,
  storage: Pick<StorageBase, 'namespaces'>,
): ResolvedFieldValueSet | undefined {
  if (field.valueSet === undefined || field.type.kind !== 'scalar') return undefined;
  const valueSet = entityAt<{ readonly values: readonly JsonValue[] }>(storage, field.valueSet);
  if (valueSet === undefined) return undefined;
  return { encodedValues: valueSet.values, codecId: field.type.codecId };
}

/** `FieldTypeOverrides`: per namespace, `models` (domain namespace) or `valueObjects` (storage namespace), owner and field, the type of each field its codec does not give. */
export function generateFieldTypeOverridesMap(
  contract: ContractWithDomain,
  codecLookup: CodecLookup | undefined,
  resolveStorageValueSet: StorageValueSetResolver | undefined,
): string {
  const modelFields = Object.entries(contract.domain.namespaces).flatMap(([nsId, ns]) =>
    Object.entries(ns.models).flatMap(([modelName, model]) =>
      Object.entries(model.fields).map(
        ([fieldName, field]) =>
          [
            [nsId, 'models', modelName, fieldName],
            resolveFieldTypeOverride(
              field,
              codecLookup,
              resolveFieldValueSet(field, contract, () =>
                resolveStorageValueSet?.(modelName, fieldName, model),
              ),
            ),
          ] as const,
      ),
    ),
  );
  const valueObjectFields = valueObjectsWithCoordinates(contract.storage).flatMap(
    ({ coordinate: { namespaceId: nsId, entityName: valueObjectName }, valueObject }) =>
      Object.entries(valueObject.fields).map(
        ([fieldName, field]) =>
          [
            [nsId, 'valueObjects', valueObjectName, fieldName],
            resolveFieldTypeOverride(
              field,
              codecLookup,
              resolveValueObjectFieldValueSet(field, contract.storage),
            ),
          ] as const,
      ),
  );
  return renderTypeOverridesMap([...modelFields, ...valueObjectFields]);
}
