import type {
  ContractField,
  ContractManyToManyRelation,
  ContractModelBase,
  ContractValueObject,
  CrossReference,
  JsonValue,
} from '@internal/contract/types';
import type { CodecLookup } from '@internal/framework-components/codec';
import {
  type ImportSpecifierResolver,
  keepInternalSpecifiers,
  type TypesImportSpec,
} from '@internal/framework-components/emission';
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

function contractFieldModifierSuffix(field: ContractField): string {
  const many = field.many === true ? '; readonly many: true' : '';
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
    return `readonly ${serializeObjectKey(fieldName)}: { readonly nullable: ${nullable}; readonly type: { readonly kind: "valueObject"; readonly name: ${serializeValue(type.name)} }${mods} }`;
  }
  return `readonly ${serializeObjectKey(fieldName)}: { readonly nullable: ${nullable}; readonly type: ${serializeValue(type)}${mods} }`;
}

export function generateModelFieldsType(fields: Record<string, ContractField>): string {
  const fieldEntries: string[] = [];
  for (const [fieldName, field] of Object.entries(fields)) {
    fieldEntries.push(generateModelFieldEntry(fieldName, field));
  }
  return fieldEntries.length > 0 ? `{ ${fieldEntries.join('; ')} }` : 'Record<string, never>';
}

export function generateModelRelationsType(relations: Record<string, unknown>): string {
  const relationEntries: string[] = [];

  for (const [relName, rel] of Object.entries(relations)) {
    if (typeof rel !== 'object' || rel === null) continue;
    const relObj = rel as Record<string, unknown>;

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

    const on = relObj['on'] as { localFields?: string[]; targetFields?: string[] } | undefined;
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
      modelParts.push(`readonly variants: ${serializeValue(model.variants)}`);
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

export type ResolvedFieldType = { readonly input: string; readonly output: string };

function applyModifiers(base: string, field: ContractField): string {
  let result = base;
  if (field.many === true) result = `ReadonlyArray<${result}>`;
  if (field.dict === true) result = `Readonly<Record<string, ${result}>>`;
  if (field.nullable) result = `${result} | null`;
  return result;
}

export type FieldTypeParamsResolver = (
  modelName: string,
  fieldName: string,
  model: ContractModelBase,
) => Record<string, unknown> | undefined;

/**
 * A field's permitted values (codec-encoded) plus the codec that types them, as supplied by the
 * family-specific {@link EmissionSpi.resolveFieldValueSet}. The framework renders these into a TS
 * literal union through the codec seam ({@link renderValueSetType}).
 */
export type ResolvedFieldValueSet = {
  readonly encodedValues: readonly JsonValue[];
  readonly codecId: string;
};

export type FieldValueSetResolver = (
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
 * isn't literal-expressible. A caller that needs column and field types to agree shares this so both
 * compute the union identically.
 */
export function renderValueSetType(
  values: readonly JsonValue[],
  codecId: string,
  side: 'output' | 'input',
  codecLookup: CodecLookup | undefined,
): string | undefined {
  if (values.length === 0 || codecLookup?.renderValueLiteralFor === undefined) return undefined;
  const literals: string[] = [];
  for (const value of values) {
    const lit = codecLookup.renderValueLiteralFor(codecId, value, side);
    if (lit === undefined || !isSafeTypeExpression(lit)) return undefined;
    literals.push(lit);
  }
  return literals.join(' | ');
}

export function resolveFieldType(
  field: ContractField,
  codecLookup?: CodecLookup,
  resolvedTypeParams?: Record<string, unknown>,
  resolvedValueSet?: ResolvedFieldValueSet,
): ResolvedFieldType {
  const { type } = field;

  switch (type.kind) {
    case 'scalar': {
      if (resolvedValueSet) {
        const output = renderValueSetType(
          resolvedValueSet.encodedValues,
          resolvedValueSet.codecId,
          'output',
          codecLookup,
        );
        const input = renderValueSetType(
          resolvedValueSet.encodedValues,
          resolvedValueSet.codecId,
          'input',
          codecLookup,
        );
        if (output !== undefined && input !== undefined) {
          return {
            output: applyModifiers(output, field),
            input: applyModifiers(input, field),
          };
        }
      }
      let outputResolved: string | undefined;
      let inputResolved: string | undefined;
      const inlineTypeParams =
        type.typeParams && Object.keys(type.typeParams).length > 0 ? type.typeParams : undefined;
      const effectiveTypeParams = inlineTypeParams ?? resolvedTypeParams;
      if (codecLookup && effectiveTypeParams && Object.keys(effectiveTypeParams).length > 0) {
        const rendered = codecLookup.renderOutputTypeFor(type.codecId, effectiveTypeParams);
        if (rendered && isSafeTypeExpression(rendered)) {
          outputResolved = rendered;
        }
        const renderedInput = codecLookup.renderInputTypeFor?.(type.codecId, effectiveTypeParams);
        if (renderedInput && isSafeTypeExpression(renderedInput)) {
          inputResolved = renderedInput;
        }
      }
      const codecAccessor = `CodecTypes[${serializeValue(type.codecId)}]`;
      return {
        output: applyModifiers(outputResolved ?? `${codecAccessor}["output"]`, field),
        input: applyModifiers(inputResolved ?? `${codecAccessor}["input"]`, field),
      };
    }
    case 'valueObject':
      return {
        output: applyModifiers(`${type.name}Output`, field),
        input: applyModifiers(`${type.name}Input`, field),
      };
    case 'union': {
      const outputMembers = type.members.map((m) =>
        m.kind === 'scalar'
          ? `CodecTypes[${serializeValue(m.codecId)}]["output"]`
          : `${m.name}Output`,
      );
      const inputMembers = type.members.map((m) =>
        m.kind === 'scalar'
          ? `CodecTypes[${serializeValue(m.codecId)}]["input"]`
          : `${m.name}Input`,
      );
      return {
        output: applyModifiers(outputMembers.join(' | '), field),
        input: applyModifiers(inputMembers.join(' | '), field),
      };
    }
    default:
      return {
        output: applyModifiers('unknown', field),
        input: applyModifiers('unknown', field),
      };
  }
}

export function generateFieldResolvedType(
  field: ContractField,
  codecLookup?: CodecLookup,
  side: 'input' | 'output' = 'output',
): string {
  return resolveFieldType(field, codecLookup)[side];
}

export type ModelFieldTypeResolvers = {
  readonly codecLookup: CodecLookup | undefined;
  readonly resolveFieldTypeParams: FieldTypeParamsResolver | undefined;
  readonly resolveFieldValueSet: FieldValueSetResolver | undefined;
};

/**
 * Resolves one model field's input and output types the way `FieldOutputTypes` /
 * `FieldInputTypes` do: inline type params win over the family resolver, and a family-resolved
 * value set renders as a literal union.
 */
export function resolveModelFieldType(
  modelName: string,
  fieldName: string,
  field: ContractField,
  model: ContractModelBase,
  resolvers: ModelFieldTypeResolvers,
): ResolvedFieldType {
  const inlineTypeParams =
    field.type.kind === 'scalar' &&
    field.type.typeParams &&
    Object.keys(field.type.typeParams).length > 0
      ? field.type.typeParams
      : undefined;
  const resolvedTypeParams =
    inlineTypeParams ?? resolvers.resolveFieldTypeParams?.(modelName, fieldName, model);
  const resolvedValueSet = resolvers.resolveFieldValueSet?.(modelName, fieldName, model);
  return resolveFieldType(field, resolvers.codecLookup, resolvedTypeParams, resolvedValueSet);
}

export function generateBothFieldTypesMaps(
  models: Record<string, ContractModelBase> | undefined,
  codecLookup?: CodecLookup,
  resolveFieldTypeParams?: FieldTypeParamsResolver,
  resolveFieldValueSet?: FieldValueSetResolver,
): ResolvedFieldType {
  if (!models || Object.keys(models).length === 0) {
    return { output: 'Record<string, never>', input: 'Record<string, never>' };
  }

  const resolvers: ModelFieldTypeResolvers = {
    codecLookup,
    resolveFieldTypeParams,
    resolveFieldValueSet,
  };
  const outputModelEntries: string[] = [];
  const inputModelEntries: string[] = [];
  for (const [modelName, model] of Object.entries(models).sort(([a], [b]) => a.localeCompare(b))) {
    if (!model) continue;
    const outputFieldEntries: string[] = [];
    const inputFieldEntries: string[] = [];
    for (const [fieldName, field] of Object.entries(model.fields)) {
      const resolved = resolveModelFieldType(modelName, fieldName, field, model, resolvers);
      const key = `readonly ${serializeObjectKey(fieldName)}`;
      outputFieldEntries.push(`${key}: ${resolved.output}`);
      inputFieldEntries.push(`${key}: ${resolved.input}`);
    }
    const outputFields =
      outputFieldEntries.length > 0
        ? `{ ${outputFieldEntries.join('; ')} }`
        : 'Record<string, never>';
    const inputFields =
      inputFieldEntries.length > 0
        ? `{ ${inputFieldEntries.join('; ')} }`
        : 'Record<string, never>';
    const modelKey = `readonly ${serializeObjectKey(modelName)}`;
    outputModelEntries.push(`${modelKey}: ${outputFields}`);
    inputModelEntries.push(`${modelKey}: ${inputFields}`);
  }

  return {
    output: `{ ${outputModelEntries.join('; ')} }`,
    input: `{ ${inputModelEntries.join('; ')} }`,
  };
}

export function generateFieldTypesMapsByNamespace(
  namespaceModels: ReadonlyArray<readonly [string, Record<string, ContractModelBase>]>,
  codecLookup?: CodecLookup,
  resolveFieldTypeParams?: FieldTypeParamsResolver,
  resolveFieldValueSet?: FieldValueSetResolver,
): ResolvedFieldType {
  if (namespaceModels.length === 0) {
    return { output: 'Record<string, never>', input: 'Record<string, never>' };
  }

  const outputNamespaceEntries: string[] = [];
  const inputNamespaceEntries: string[] = [];
  for (const [nsId, models] of namespaceModels) {
    const inner = generateBothFieldTypesMaps(
      models,
      codecLookup,
      resolveFieldTypeParams,
      resolveFieldValueSet,
    );
    const nsKey = `readonly ${serializeObjectKey(nsId)}`;
    outputNamespaceEntries.push(`${nsKey}: ${inner.output}`);
    inputNamespaceEntries.push(`${nsKey}: ${inner.input}`);
  }

  return {
    output: `{ ${outputNamespaceEntries.join('; ')} }`,
    input: `{ ${inputNamespaceEntries.join('; ')} }`,
  };
}

export function generateFieldOutputTypesMap(
  models: Record<string, ContractModelBase> | undefined,
  codecLookup?: CodecLookup,
  resolveFieldTypeParams?: FieldTypeParamsResolver,
): string {
  return generateBothFieldTypesMaps(models, codecLookup, resolveFieldTypeParams).output;
}

export function generateFieldInputTypesMap(
  models: Record<string, ContractModelBase> | undefined,
  codecLookup?: CodecLookup,
  resolveFieldTypeParams?: FieldTypeParamsResolver,
): string {
  return generateBothFieldTypesMaps(models, codecLookup, resolveFieldTypeParams).input;
}

export function generateValueObjectType(
  _voName: string,
  vo: ContractValueObject,
  _valueObjects: Record<string, ContractValueObject>,
  side: 'input' | 'output' = 'output',
  codecLookup?: CodecLookup,
): string {
  return resolveValueObjectType(_voName, vo, _valueObjects, codecLookup)[side];
}

export function resolveValueObjectType(
  _voName: string,
  vo: ContractValueObject,
  _valueObjects: Record<string, ContractValueObject>,
  codecLookup?: CodecLookup,
): ResolvedFieldType {
  const outputEntries: string[] = [];
  const inputEntries: string[] = [];
  for (const [fieldName, field] of Object.entries(vo.fields)) {
    const resolved = resolveFieldType(field, codecLookup);
    const key = `readonly ${serializeObjectKey(fieldName)}`;
    outputEntries.push(`${key}: ${resolved.output}`);
    inputEntries.push(`${key}: ${resolved.input}`);
  }
  const empty = 'Record<string, never>';
  return {
    output: outputEntries.length > 0 ? `{ ${outputEntries.join('; ')} }` : empty,
    input: inputEntries.length > 0 ? `{ ${inputEntries.join('; ')} }` : empty,
  };
}

export function generateContractFieldDescriptor(fieldName: string, field: ContractField): string {
  const mods: string[] = [];
  if (field.many === true) mods.push('; readonly many: true');
  if (field.dict === true) mods.push('; readonly dict: true');
  const modStr = mods.join('');

  const { type } = field;
  if (type.kind === 'scalar') {
    const typeParamsSpec =
      type.typeParams && Object.keys(type.typeParams).length > 0
        ? `; readonly typeParams: ${serializeValue(type.typeParams)}`
        : '';
    return `readonly ${serializeObjectKey(fieldName)}: { readonly nullable: ${field.nullable}; readonly type: { readonly kind: "scalar"; readonly codecId: ${serializeValue(type.codecId)}${typeParamsSpec} }${modStr} }`;
  }
  if (type.kind === 'valueObject') {
    return `readonly ${serializeObjectKey(fieldName)}: { readonly nullable: ${field.nullable}; readonly type: { readonly kind: "valueObject"; readonly name: ${serializeValue(type.name)} }${modStr} }`;
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

export function generateValueObjectTypeAliases(
  valueObjects: Record<string, ContractValueObject> | undefined,
  codecLookup?: CodecLookup,
): string {
  if (!valueObjects || Object.keys(valueObjects).length === 0) {
    return '';
  }

  const aliases: string[] = [];
  for (const [voName, vo] of Object.entries(valueObjects)) {
    const resolved = resolveValueObjectType(voName, vo, valueObjects, codecLookup);
    aliases.push(`export type ${voName}Output = ${resolved.output};`);
    aliases.push(`export type ${voName}Input = ${resolved.input};`);
  }
  return aliases.join('\n');
}
