/**
 * Every part of a contract `contract print` cannot write as Prisma 8 PSL that reads back the same,
 * one function per case in the `CONTRACT.PRINT_UNSUPPORTED` list of
 * `docs/reference/error-reference.md`, in the same order. A `refuse…` function that returns `void`
 * checks its input and throws when the case applies; one that returns `never` is called where the
 * printer found the case.
 */

import type {
  Contract,
  ContractField,
  ExecutionMutationDefault,
  ScalarFieldType,
  ValueObjectFieldType,
} from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { canonicalizeJson } from '@internal/framework-components/utils';
import { isPslIdentifier } from '@internal/psl-parser';
import {
  type ForeignKey,
  type Index,
  type SqlModelStorage,
  type SqlStorage,
  StorageColumn,
} from '@internal/sql-contract/types';
import { escapePslString } from '@internal/sql-relational-core/ast';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { PG_ENUM_CODEC_ID } from '../codec-ids';
import { postgresError } from '../errors';
import { DEFAULT_NAMESPACE_ID } from '../namespace-ids';
import type { PostgresNativeEnum } from '../postgres-native-enum';
import type { PostgresRlsPolicy } from '../postgres-rls-policy';
import { NAME_THE_PSL_SOURCE_LOSES } from '../psl-ast/name-the-psl-source-loses';
import {
  isVariantLinkForeignKey,
  type ModelWithTable,
  type VariantInfo,
  variantLinkColumns,
} from './contract-model-index';
import type { DerivedCheck } from './model-attributes';

const KEEP_SOURCE = 'Keep authoring this contract in its current source.';

function unsupported(message: string, why: string, fix: string, meta: Record<string, unknown>) {
  return postgresError('CONTRACT.PRINT_UNSUPPORTED', `contract print: ${message}`, {
    why,
    fix,
    meta,
  });
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

function sameValues(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

// Column types and defaults

export function refuseColumnWithoutPslType(column: StorageColumn, coordinate: string): never {
  throw unsupported(
    `column ${coordinate} has native type "${column.nativeType}" with codec "${column.codecId}", and no PSL type in the configured stack produces that pair.`,
    'A column is written as a PSL type that reads back with its codec and native type, and none of the types the target, adapter and extensions contribute does.',
    'Add the extension that contributes this type to the config, or keep authoring this contract in its current source.',
    { coordinate, nativeType: column.nativeType, codecId: column.codecId },
  );
}

/**
 * Refuses a string type argument the PSL source would read back differently: it reads a string
 * argument between its quotes as written, with no escapes.
 */
export function refuseUnwritableTypeArgument(value: string, coordinate: string): void {
  if (escapePslString(value) === value) return;
  throw unsupported(
    `column ${coordinate} takes the type argument ${JSON.stringify(value)}, which a PSL type argument cannot carry.`,
    'The PSL source reads a string type argument as written between its quotes, with no escapes, so a quote, backslash or line break in it would read back differently.',
    KEEP_SOURCE,
    { coordinate, argument: value },
  );
}

export function refuseDefaultOutsideEnum(input: {
  readonly coordinate: string;
  readonly value: unknown;
  readonly pslTypeName: string;
}): never {
  throw unsupported(
    `column ${input.coordinate} defaults to ${JSON.stringify(input.value)}, which is not a member of enum ${input.pslTypeName}.`,
    'A default on a domain enum column is written as the member name, and no member carries this value.',
    'Give the column a default that is one of the enum members, or drop it.',
    { coordinate: input.coordinate, pslTypeName: input.pslTypeName },
  );
}

export function refuseUnwritableLiteralDefault(input: {
  readonly coordinate: string;
  readonly written: string;
  readonly pslTypeName: string;
}): never {
  throw unsupported(
    `column ${input.coordinate} has a default that cannot be written in Prisma 8 PSL: no data type the ${input.pslTypeName} type takes writes ${input.written}.`,
    'Writing the value in any other form would parse, but the PSL source would read it back as a different value.',
    'Replace the default with a database expression default, or drop the default before printing.',
    { coordinate: input.coordinate, pslTypeName: input.pslTypeName },
  );
}

// Generated values

interface GeneratorPhases {
  readonly coordinate: string;
  readonly onCreate: string | undefined;
  readonly onUpdate: string | undefined;
}

export function refuseNowGeneratorPairedWithAnother(
  phases: GeneratorPhases & { readonly other: string | undefined },
): never {
  throw unsupported(
    `column ${phases.coordinate} takes the wall-clock-now generator in one phase and "${phases.other}" in the other, which cannot be written in Prisma 8 PSL.`,
    'The temporal preset a now generator is authored through writes each phase as `now`, so the other generator would be dropped from the written file.',
    KEEP_SOURCE,
    { coordinate: phases.coordinate, onCreate: phases.onCreate, onUpdate: phases.onUpdate },
  );
}

export function refuseGeneratorOnUpdate(phases: GeneratorPhases): never {
  throw unsupported(
    `column ${phases.coordinate} generates a value on update ("${phases.onUpdate}"), which cannot be written in Prisma 8 PSL.`,
    '`@default(…)` writes a generator for create only; a generator on update is written only through a temporal preset, which takes the wall-clock-now generator.',
    KEEP_SOURCE,
    { coordinate: phases.coordinate, onCreate: phases.onCreate, onUpdate: phases.onUpdate },
  );
}

export function refuseGeneratorWithoutPslFunction(phases: GeneratorPhases): never {
  throw unsupported(
    `column ${phases.coordinate} is generated by "${phases.onCreate}", and the printer knows no PSL default function that produces it.`,
    'The printer writes each generator as the PSL default function of the Postgres adapter that produces it, and no such function produces this generator.',
    KEEP_SOURCE,
    { coordinate: phases.coordinate, onCreate: phases.onCreate, onUpdate: phases.onUpdate },
  );
}

export function refuseGeneratorWithDatabaseDefault(input: {
  readonly coordinate: string;
  readonly onCreate: string | undefined;
}): never {
  throw unsupported(
    `column ${input.coordinate} has both a generated value ("${input.onCreate}") and a database default, which cannot be written in Prisma 8 PSL.`,
    '`@default(…)` writes either the generator or the database default, so the other would be lost.',
    'Drop one of the two, or keep authoring this contract in its current source.',
    { coordinate: input.coordinate, onCreate: input.onCreate },
  );
}

/** Refuses a generated value the printer did not write with the field of its column. */
export function refuseUnwrittenExecutionDefaults(
  contract: Contract<SqlStorage>,
  written: ReadonlySet<ExecutionMutationDefault>,
): void {
  for (const entry of contract.execution?.mutations.defaults ?? []) {
    if (written.has(entry)) continue;
    const coordinate = `"${entry.ref.namespace}"."${entry.ref.table}"."${entry.ref.column}"`;
    throw unsupported(
      `a generated value names column ${coordinate}, which no field is stored in, so it cannot be written in Prisma 8 PSL.`,
      'PSL writes a generated value on the field stored in its column.',
      KEEP_SOURCE,
      { coordinate },
    );
  }
}

// Fields and columns

/**
 * The value-set references the PSL source gives a field typed by a domain enum and its column: the
 * column names the enum's value set, and a field that is not a list names the enum, both in the
 * default namespace. A field with no domain enum has neither.
 */
function derivedValueSetRefs(enumName: string | undefined, list: boolean) {
  if (enumName === undefined) return { field: undefined, column: undefined };
  const common = { namespaceId: DEFAULT_NAMESPACE_ID, entityName: enumName };
  return {
    field: list ? undefined : { plane: 'domain', entityKind: 'enum', ...common },
    column: { plane: 'storage', entityKind: 'valueSet', ...common },
  };
}

/**
 * Refuses a field whose column the PSL source would not derive from it: PSL writes the field once,
 * and the PSL source derives the column's nullability, list marker, codec and type parameters from
 * what is written.
 */
export function refuseFieldColumnMismatch(input: {
  readonly field: ContractField;
  readonly column: StorageColumn;
  readonly coordinate: string;
  readonly modelName: string;
  readonly singleTableVariant: boolean;
  readonly domainEnumNames: ReadonlySet<string>;
}): void {
  const { field, column, coordinate } = input;
  const fix =
    'Make the field and its column agree, or keep authoring this contract in its current source.';
  if (input.singleTableVariant && !column.nullable) {
    throw unsupported(
      `column ${coordinate} of single-table variant "${input.modelName}" is not nullable, which cannot be written in Prisma 8 PSL.`,
      "The PSL source makes every column of a single-table variant nullable, because the base's other rows leave it empty.",
      fix,
      { coordinate },
    );
  }
  if (!input.singleTableVariant && field.nullable !== column.nullable) {
    throw unsupported(
      `field ${coordinate} is ${field.nullable ? 'optional' : 'required'} but its column is ${column.nullable ? 'nullable' : 'not nullable'}, which cannot be written in Prisma 8 PSL.`,
      'PSL writes `?` once, and the PSL source derives the column from the field.',
      fix,
      { coordinate },
    );
  }
  const fieldListInColumn = field.type.kind === 'scalar' && field.many === true;
  if (fieldListInColumn !== (column.many === true)) {
    throw unsupported(
      `field ${coordinate} is ${field.many === true ? 'a list' : 'not a list'} but its column is ${column.many === true ? 'a list' : 'not a list'}, which cannot be written in Prisma 8 PSL.`,
      'PSL writes `[]` once: the PSL source stores a list of scalars in a list column, and a list of value objects in one JSON column.',
      fix,
      { coordinate },
    );
  }
  if (
    field.type.kind === 'scalar' &&
    (field.type.codecId !== column.codecId || !sameJson(field.type.typeParams, column.typeParams))
  ) {
    throw unsupported(
      `field ${coordinate} has a different codec or type parameters from its column, which cannot be written in Prisma 8 PSL.`,
      "The PSL source derives a scalar field's codec and type parameters from its column.",
      fix,
      { coordinate },
    );
  }
  if (field.type.kind !== 'scalar' || column.codecId === PG_ENUM_CODEC_ID) return;
  const enumName = column.valueSet?.entityName;
  const derived = derivedValueSetRefs(enumName, field.many === true);
  if (
    !sameJson(field.valueSet, derived.field) ||
    !sameJson(column.valueSet, derived.column) ||
    (enumName !== undefined && !input.domainEnumNames.has(enumName))
  ) {
    throw unsupported(
      `field ${coordinate} and its column do not name the enum of the default namespace and its value set that the PSL source derives for a field typed by an enum, which cannot be written in Prisma 8 PSL.`,
      'PSL types the field by the enum name, and the PSL source then points the column at the value set of that enum in the default namespace, and a field that is not a list at the enum.',
      fix,
      { coordinate },
    );
  }
}

/**
 * Refuses a field PSL has no form for: one whose type is a union of types, or one that is a
 * dictionary. Runs for model fields and value-object fields alike.
 */
export function refuseUnwritableFieldShape(
  field: ContractField,
  coordinate: string,
): asserts field is ContractField & { readonly type: ScalarFieldType | ValueObjectFieldType } {
  if (field.type.kind === 'union') {
    throw unsupported(
      `field ${coordinate} has a ${field.type.kind} type, which cannot be written in Prisma 8 PSL.`,
      'A PSL field names one scalar, enum, or value-object type; a union of types has no PSL form.',
      'Give the field a single type, or keep authoring this contract in its current source.',
      { coordinate, kind: field.type.kind },
    );
  }
  if (field.dict !== true) return;
  throw unsupported(
    `field ${coordinate} is a dictionary, which cannot be written in Prisma 8 PSL.`,
    'PSL writes a field as one value or a list; it has no form for a keyed dictionary.',
    KEEP_SOURCE,
    { coordinate },
  );
}

/**
 * Refuses a value-object field with type parameters or a value set: the PSL source keeps only the
 * codec of a value-object field's type, so either would be lost.
 */
export function refuseValueObjectFieldPartsTheSourceDrops(
  field: ContractField & { readonly type: ScalarFieldType },
  coordinate: string,
): void {
  if (Object.keys(field.type.typeParams ?? {}).length === 0 && field.valueSet === undefined) return;
  throw unsupported(
    `value-object field ${coordinate} carries type parameters or a value set, which cannot be written in Prisma 8 PSL.`,
    "The PSL source keeps only the codec of a value-object field's type, so its type parameters and value set would be lost.",
    KEEP_SOURCE,
    { coordinate },
  );
}

export function refuseValueObjectFieldCodecWithoutNativeType(
  codecId: string,
  coordinate: string,
): never {
  throw unsupported(
    `field ${coordinate} uses codec "${codecId}", which no Postgres codec in the configured stack names a native type for.`,
    'A value-object field has no storage column, so its PSL type is derived from the native type its codec names.',
    KEEP_SOURCE,
    { coordinate, codecId },
  );
}

export function refuseValueObjectFieldCodecNeedingTypeParameters(
  codecId: string,
  coordinate: string,
): never {
  throw unsupported(
    `field ${coordinate} uses codec "${codecId}", which names a native type only from type parameters, and the PSL source keeps none on a value-object field.`,
    "The PSL source keeps only the codec of a value-object field's type, so a codec that needs type parameters cannot be written there.",
    KEEP_SOURCE,
    { coordinate, codecId },
  );
}

/** Refuses a model field its storage does not store in a column. */
export function refuseFieldsWithoutColumn(entry: ModelWithTable): void {
  const storedFieldNames = new Set(Object.keys(entry.storage.fields));
  for (const fieldName of Object.keys(entry.model.fields)) {
    if (storedFieldNames.has(fieldName)) continue;
    throw unsupported(
      `field "${entry.namespaceId}.${entry.name}.${fieldName}" is stored in no column, so it cannot be written in Prisma 8 PSL.`,
      'PSL declares a scalar or value-object field together with the column it is stored in.',
      'The contract source produced a field without storage. Fix the field if the source is a TypeScript contract; otherwise report the bug to the source that produced it.',
      { namespaceId: entry.namespaceId, modelName: entry.name, field: fieldName },
    );
  }
}

export function refuseStorageWithoutFieldOrColumn(input: {
  readonly entry: ModelWithTable;
  readonly fieldName: string;
  readonly coordinate: string;
}): never {
  const { entry, fieldName } = input;
  throw unsupported(
    `model "${entry.namespaceId}.${entry.name}" stores "${fieldName}" in column ${input.coordinate}, but the model has no such field or the table has no such column.`,
    'PSL declares a field together with the column it is stored in, so both must exist.',
    'The contract source produced storage for a field or column it does not declare. Fix it if the source is a TypeScript contract; otherwise report the bug to the source that produced it.',
    { namespaceId: entry.namespaceId, modelName: entry.name, field: fieldName },
  );
}

export function refuseColumnControl(column: StorageColumn, coordinate: string): void {
  if (column.control === undefined) return;
  throw unsupported(
    `column ${coordinate} carries its own control policy "${column.control}", which cannot be written in Prisma 8 PSL.`,
    'PSL declares a control policy per model with `@@control`; a field has no control attribute.',
    'Move the policy to the model, or keep authoring this contract in its current source.',
    { coordinate, control: column.control },
  );
}

/** Refuses a storage table no model is stored in, and a column no field or variant link stores. */
export function refuseUnmodelledTablesAndColumns(
  contract: Contract<SqlStorage>,
  models: readonly ModelWithTable[],
  variants: ReadonlyMap<ModelWithTable, VariantInfo | undefined>,
): void {
  const tableKey = (namespaceId: string, tableName: string) =>
    JSON.stringify([namespaceId, tableName]);
  const coveredColumns = new Map<string, Set<string>>();
  for (const entry of models) {
    const key = tableKey(entry.namespaceId, entry.tableName);
    const columns = coveredColumns.get(key) ?? new Set<string>();
    for (const column of entry.ownColumns) columns.add(column);
    for (const column of variantLinkColumns(entry, variants.get(entry))) columns.add(column);
    coveredColumns.set(key, columns);
  }
  for (const [namespaceId, namespace] of Object.entries(contract.storage.namespaces)) {
    for (const [tableName, table] of Object.entries(namespace.entries.table ?? {})) {
      const covered = coveredColumns.get(tableKey(namespaceId, tableName));
      if (covered === undefined) {
        throw unsupported(
          `table "${namespaceId}"."${tableName}" has no model stored in it, so it cannot be written in Prisma 8 PSL.`,
          'PSL declares a table through the model stored in it.',
          'Declare a model for the table, or keep authoring this contract in its current source.',
          { namespaceId, table: tableName },
        );
      }
      for (const column of Object.keys(table.columns)) {
        if (covered.has(column)) continue;
        throw unsupported(
          `column "${namespaceId}"."${tableName}"."${column}" is not stored by any field, so it cannot be written in Prisma 8 PSL.`,
          'PSL declares a column through the field stored in it; the only columns the PSL source adds are the primary key columns that link a multi-table variant to its base.',
          'Add a field for the column, or keep authoring this contract in its current source.',
          { namespaceId, table: tableName, column },
        );
      }
    }
  }
}

// Models

/** Refuses a model whose domain namespace is not the namespace of its table. */
export function refuseModelsOutsideTableNamespace(contract: Contract<SqlStorage>): void {
  for (const [namespaceId, domainNamespace] of Object.entries(contract.domain.namespaces)) {
    for (const [name, model] of Object.entries(domainNamespace.models)) {
      const storage = blindCast<SqlModelStorage, 'SQL contract model storage'>(model.storage);
      if (storage.namespaceId === namespaceId) continue;
      throw unsupported(
        `model "${namespaceId}.${name}" is stored in namespace "${storage.namespaceId}", which cannot be written in Prisma 8 PSL.`,
        'A model written in a namespace block belongs to that namespace in both the domain and the storage.',
        'The contract source produced a model outside the namespace of its table. Fix the model if the source is a TypeScript contract; otherwise report the bug to the source that produced it.',
        { namespaceId, modelName: name, tableNamespaceId: storage.namespaceId },
      );
    }
  }
}

export function refuseModelOwner(entry: ModelWithTable): void {
  if (entry.model.owner === undefined) return;
  throw unsupported(
    `model "${entry.namespaceId}.${entry.name}" is owned by "${entry.model.owner}", which cannot be written in Prisma 8 PSL.`,
    '`owner` names the model this model is embedded in, and SQL PSL has no syntax for an owned model.',
    KEEP_SOURCE,
    { namespaceId: entry.namespaceId, modelName: entry.name, owner: entry.model.owner },
  );
}

/**
 * Refuses a multi-table variant whose link to its base differs from the one the PSL source derives:
 * the base's primary key columns copied into the variant's table as its unnamed primary key, and
 * the link foreign key.
 */
export function refuseUnderivedVariantLink(entry: ModelWithTable, variant: VariantInfo): void {
  const baseKey = variant.base.table.primaryKey?.columns ?? [];
  const derivedKey = baseKey.length === 0 ? undefined : { columns: baseKey };
  const linkColumnsMatch = variantLinkColumns(entry, variant).every((column) => {
    const base = variant.base.table.columns[column];
    const expected =
      base === undefined
        ? undefined
        : new StorageColumn({
            nativeType: base.nativeType,
            codecId: base.codecId,
            nullable: false,
            ...ifDefined('typeParams', base.typeParams),
            ...ifDefined('typeRef', base.typeRef),
          });
    return sameJson(entry.table.columns[column], expected);
  });
  const linkForeignKeys = entry.table.foreignKeys.filter((fk) =>
    isVariantLinkForeignKey(fk, variant),
  );
  if (
    linkColumnsMatch &&
    sameJson(entry.table.primaryKey, derivedKey) &&
    linkForeignKeys.length === (baseKey.length === 0 ? 0 : 1)
  ) {
    return;
  }
  throw unsupported(
    `multi-table variant "${entry.namespaceId}.${entry.name}" is linked to its base "${variant.base.name}" differently from the link the PSL source derives, so it cannot be written in Prisma 8 PSL.`,
    "The PSL source links a multi-table variant to its base itself: it copies the base's primary key columns into the variant's table as its unnamed primary key, and adds an unnamed foreign key over them to the base that cascades on delete.",
    KEEP_SOURCE,
    { namespaceId: entry.namespaceId, modelName: entry.name },
  );
}

/**
 * The PSL source groups relations by bare model name, so two models with the same name in
 * different namespaces would get each other's relations.
 */
export function refuseDuplicateModelNames(models: readonly ModelWithTable[]): void {
  const namespacesByName = new Map<string, string[]>();
  for (const entry of models) {
    const namespaces = namespacesByName.get(entry.name) ?? [];
    namespaces.push(entry.namespaceId);
    namespacesByName.set(entry.name, namespaces);
  }
  for (const [name, namespaces] of namespacesByName) {
    if (namespaces.length <= 1) continue;
    throw unsupported(
      `model "${name}" is declared in more than one namespace (${namespaces.join(', ')}), which Prisma 8 PSL cannot carry: the PSL source groups relations by bare model name.`,
      "The PSL source groups relations by bare model name, so when the file is read back the two models would get each other's relations.",
      'Rename one of the models, then print again.',
      { modelName: name, namespaces },
    );
  }
}

/**
 * A PSL `enum` block is declared at the top level and lands in the default namespace, so only the
 * default namespace's domain enums have a PSL form.
 */
export function refuseEnumsOutsideDefaultNamespace(contract: Contract<SqlStorage>): void {
  for (const [namespaceId, domainNamespace] of Object.entries(contract.domain.namespaces)) {
    const names = Object.keys(domainNamespace.enum ?? {});
    if (namespaceId === DEFAULT_NAMESPACE_ID || names.length === 0) continue;
    throw unsupported(
      `namespace "${namespaceId}" declares the enum${names.length === 1 ? '' : 's'} ${names.join(', ')}, which cannot be written in Prisma 8 PSL: an enum block is declared at the top level and belongs to the default namespace.`,
      'The PSL source refuses an enum block inside a namespace block, so an enum outside the default namespace has no PSL form.',
      'Move the enum to the default namespace, or keep authoring this contract in its current source.',
      { namespaceId, names },
    );
  }
}

/** The PSL source reads every `type` block into the default namespace. */
export function refuseValueObjectsOutsideDefaultNamespace(
  contract: Contract<SqlStorage>,
  namespaceId: string,
): void {
  const names = Object.keys(contract.domain.namespaces[namespaceId]?.valueObjects ?? {});
  if (namespaceId === DEFAULT_NAMESPACE_ID || names.length === 0) return;
  throw unsupported(
    `namespace "${namespaceId}" declares the value object${names.length === 1 ? '' : 's'} ${names.join(', ')}, which cannot be written in Prisma 8 PSL: the PSL source reads every value object into the default namespace.`,
    'A `type` block written in any namespace reads back into the default namespace, so the value object would move.',
    'Move the value object to the default namespace, or keep authoring this contract in its current source.',
    { namespaceId, names },
  );
}

// Keys, checks and indexes

/**
 * Refuses a check or index whose name is neither its prefix followed by the hash of its content,
 * which `name:` derives, nor free of a prefix, which `map:` needs.
 */
export function refuseUnwritableObjectName(input: {
  readonly kind: 'check' | 'index';
  readonly entry: ModelWithTable;
  readonly name: string;
  readonly prefix: string;
}): never {
  const { kind, entry, name, prefix } = input;
  throw unsupported(
    `${kind} "${name}" on "${entry.namespaceId}"."${entry.tableName}" has the prefix "${prefix}", but its name is not that prefix followed by the hash of its ${kind === 'check' ? 'expression' : 'content'}, so it cannot be written in Prisma 8 PSL.`,
    `\`name:\` makes the PSL source derive the name from the prefix and that hash, and \`map:\` writes an exact name with no prefix, so neither reads back as this ${kind}.`,
    KEEP_SOURCE,
    { namespaceId: entry.namespaceId, table: entry.tableName, name, prefix },
  );
}

/**
 * Refuses a table whose checks differ from the derived ones where they overlap: a derived check the
 * table lacks, or a check with a derived check's name but not its prefix and expression. The PSL
 * source adds the derived checks itself, so they are never written.
 */
export function refuseUnderivedChecks(
  entry: ModelWithTable,
  derived: ReadonlyMap<string, DerivedCheck>,
): void {
  const checks = new Map((entry.table.checks ?? []).map((check) => [check.name, check]));
  for (const [name, expected] of derived) {
    const check = checks.get(name);
    if (check?.prefix === expected.prefix && check.expression === expected.expression) continue;
    throw unsupported(
      `table "${entry.namespaceId}"."${entry.tableName}" ${check === undefined ? 'lacks' : 'changes'} the check "${name}" the PSL source derives, so it cannot be written in Prisma 8 PSL.`,
      'The PSL source derives a membership check for each column of a managed table typed by an enum, and an element-not-null check for each list column, unless the column waives it with `@noCheck`.',
      KEEP_SOURCE,
      { namespaceId: entry.namespaceId, table: entry.tableName, name },
    );
  }
}

/**
 * Refuses index options PSL cannot write: `options:` takes string values under identifier keys,
 * and requires a `type`.
 */
export function refuseUnwritableIndexOptions(entry: ModelWithTable, index: Index): void {
  const meta = { namespaceId: entry.namespaceId, table: entry.tableName, index: index.name };
  if (index.options !== undefined && index.type === undefined) {
    throw unsupported(
      `index "${index.name}" on "${entry.namespaceId}"."${entry.tableName}" has options but no type, which cannot be written in Prisma 8 PSL.`,
      'The PSL source reads `options:` on an index only together with `type:`.',
      'Give the index a type, or keep authoring this contract in its current source.',
      meta,
    );
  }
  for (const [key, value] of Object.entries(index.options ?? {})) {
    refuseUnwritableName('index option', key);
    if (typeof value === 'string') continue;
    throw unsupported(
      `index "${index.name}" on "${entry.namespaceId}"."${entry.tableName}" has option "${key}" whose value is not a string, which cannot be written in Prisma 8 PSL.`,
      'The PSL `options:` argument takes string values only, and reads every value back as a string.',
      'Write the option value as a string, or keep authoring this contract in its current source.',
      { ...meta, key },
    );
  }
}

// Relations

export function refuseToOneRelationWithoutForeignKey(modelName: string, fieldName: string): never {
  throw unsupported(
    `relation "${modelName}.${fieldName}" has no foreign key in storage, which Prisma 8 PSL cannot express.`,
    'A to-one relation is authored as `@relation(fields:…, references:…)`, which always lowers to a foreign key.',
    'Declare a foreign key for the relation, or keep authoring this contract in its current source.',
    { model: modelName, field: fieldName },
  );
}

/**
 * A foreign key no relation travels has no PSL form: the PSL source derives every foreign key from
 * a `@relation`, so this one would be lost.
 */
export function refuseUntravelledForeignKeys(
  entry: ModelWithTable,
  variant: VariantInfo | undefined,
  travelled: ReadonlySet<ForeignKey>,
): void {
  for (const fk of entry.table.foreignKeys) {
    if (travelled.has(fk) || isVariantLinkForeignKey(fk, variant)) continue;
    if (variant?.singleTable === true && !fk.source.columns.every((c) => entry.ownColumns.has(c))) {
      continue;
    }
    throw unsupported(
      `table "${entry.namespaceId}"."${entry.tableName}" has a foreign key on (${fk.source.columns.join(', ')}) that no relation of model "${entry.name}" travels, which cannot be written in Prisma 8 PSL.`,
      'The PSL source derives every foreign key from a `@relation` field; a foreign key without one has no PSL form.',
      'Declare a relation over the foreign key, or keep authoring this contract in its current source.',
      { namespaceId: entry.namespaceId, table: entry.tableName, columns: fk.source.columns },
    );
  }
}

export function refuseRelationToOtherContractSpace(input: {
  readonly modelName: string;
  readonly fieldName: string;
  readonly targetModel: string;
  readonly space: string | undefined;
}): void {
  if (input.space === undefined) return;
  throw unsupported(
    `relation "${input.modelName}.${input.fieldName}" targets model "${input.targetModel}" in contract space "${input.space}", which contract print cannot write yet.`,
    'The printer writes relations between models of this contract only.',
    KEEP_SOURCE,
    { model: input.modelName, field: input.fieldName, space: input.space },
  );
}

export function refuseManyToManyWithoutJunctionRelation(
  modelName: string,
  fieldName: string,
): never {
  throw unsupported(
    `many-to-many relation "${modelName}.${fieldName}" goes through a table whose model has no relation back to "${modelName}", so it cannot be written in Prisma 8 PSL.`,
    'PSL writes a many-to-many list field through the relations of the junction model, one to each side.',
    'Declare a model for the junction table with a relation to each side, or keep authoring this contract in its current source.',
    { model: modelName, field: fieldName },
  );
}

// Enums and value sets

/**
 * Refuses a namespace whose value sets differ from the ones the PSL source derives from the enum
 * and `native_enum` blocks the printer writes for it.
 */
export function refuseUnderivedValueSets(input: {
  readonly namespaceId: string;
  readonly actual: ReadonlyMap<string, readonly unknown[]>;
  readonly derived: ReadonlyMap<string, readonly unknown[]>;
}): void {
  const { namespaceId } = input;
  for (const [name, values] of input.actual) {
    const derived = input.derived.get(name);
    if (derived !== undefined && sameValues(derived, values)) continue;
    throw unsupported(
      `value set "${name}" in namespace "${namespaceId}" is not the value set of an enum or native enum of that name holding exactly its values, so it cannot be written in Prisma 8 PSL.`,
      'The PSL source derives each value set from an `enum` or `native_enum` block, named after the block and holding its members.',
      KEEP_SOURCE,
      { namespaceId, name },
    );
  }
  for (const name of input.derived.keys()) {
    if (input.actual.has(name)) continue;
    throw unsupported(
      `enum "${name}" in namespace "${namespaceId}" has no value set holding its members, which cannot be written in Prisma 8 PSL.`,
      'The PSL source derives a value set from every enum, so the file would read back with a value set this contract does not have.',
      KEEP_SOURCE,
      { namespaceId, name },
    );
  }
}

export function refuseEnumAndNativeEnumSharingName(namespaceId: string, name: string): never {
  throw unsupported(
    `enum "${name}" and a native enum written under the same name both derive the value set "${name}" in namespace "${namespaceId}", which cannot be written in Prisma 8 PSL.`,
    'The PSL source refuses one name declared both as an enum and as a native enum.',
    KEEP_SOURCE,
    { namespaceId, name },
  );
}

export function refuseNativeEnumWithoutValueSet(
  namespaceId: string,
  nativeEnum: PostgresNativeEnum,
): never {
  throw unsupported(
    `native enum "${nativeEnum.typeName}" in namespace "${namespaceId}" has no value set holding its members, which cannot be written in Prisma 8 PSL.`,
    'The PSL source derives a value set from every `native_enum` block, named after the block and holding its members, so the file would read back with a value set this contract does not have.',
    KEEP_SOURCE,
    { namespaceId, typeName: nativeEnum.typeName },
  );
}

export function refuseNativeEnumControl(namespaceId: string, nativeEnum: PostgresNativeEnum): void {
  if (nativeEnum.control === undefined) return;
  throw unsupported(
    `native enum "${nativeEnum.typeName}" in namespace "${namespaceId}" carries its own control policy "${nativeEnum.control}", which cannot be written in Prisma 8 PSL.`,
    'A `native_enum` block has no control attribute.',
    'Drop the policy from the enum, or keep authoring this contract in its current source.',
    { namespaceId, typeName: nativeEnum.typeName, control: nativeEnum.control },
  );
}

// Namespaces, meta and roots

/**
 * Refuses a storage or domain namespace the PSL source would not create again: one holding nothing
 * the printer writes. The PSL source creates the default namespace in both planes, a storage
 * namespace for every namespace block it writes into, and a domain namespace for each namespace
 * with models.
 */
export function refuseUnwrittenNamespaces(input: {
  readonly contract: Contract<SqlStorage>;
  readonly models: readonly ModelWithTable[];
  readonly writtenStorageNamespaces: ReadonlySet<string>;
}): void {
  const { contract } = input;
  const storageNamespaces = new Set([DEFAULT_NAMESPACE_ID, ...input.writtenStorageNamespaces]);
  const defaultDomain = contract.domain.namespaces[DEFAULT_NAMESPACE_ID];
  const domainNamespaces = new Set(input.models.map((entry) => entry.namespaceId));
  if (
    domainNamespaces.size === 0 ||
    Object.keys(defaultDomain?.valueObjects ?? {}).length > 0 ||
    Object.keys(defaultDomain?.enum ?? {}).length > 0
  ) {
    domainNamespaces.add(DEFAULT_NAMESPACE_ID);
  }
  const planes = [
    {
      plane: 'storage',
      expected: storageNamespaces,
      actual: Object.keys(contract.storage.namespaces),
    },
    {
      plane: 'domain',
      expected: domainNamespaces,
      actual: Object.keys(contract.domain.namespaces),
    },
  ];
  for (const { plane, expected, actual } of planes) {
    for (const namespaceId of actual) {
      if (expected.has(namespaceId)) continue;
      throw unsupported(
        `${plane} namespace "${namespaceId}" holds nothing Prisma 8 PSL writes, so it would not read back.`,
        'The PSL source creates a namespace only for what is written in it.',
        'Remove the empty namespace, or keep authoring this contract in its current source.',
        { plane, namespaceId },
      );
    }
    for (const namespaceId of expected) {
      if (actual.includes(namespaceId)) continue;
      throw unsupported(
        `the contract has no ${plane} namespace "${namespaceId}", which the PSL source would create.`,
        'The PSL source always creates the default namespace, and a namespace for everything it writes.',
        KEEP_SOURCE,
        { plane, namespaceId },
      );
    }
  }
}

/** Refuses top-level `meta` entries: the PSL source reads back an empty `meta`. */
export function refuseContractMeta(contract: Contract<SqlStorage>): void {
  const keys = Object.keys(contract.meta);
  if (keys.length === 0) return;
  throw unsupported(
    `the contract carries meta entries (${keys.join(', ')}), which cannot be written in Prisma 8 PSL.`,
    'The PSL source writes no top-level meta, so the file would read back with an empty meta.',
    KEEP_SOURCE,
    { keys },
  );
}

/**
 * Refuses roots that differ from the ones the PSL source derives: one per model that is not a
 * variant, keyed by its table name, or by `<namespace>.<table>` when two such models share a table
 * name.
 */
export function refuseUnderivedRoots(
  contract: Contract<SqlStorage>,
  models: readonly ModelWithTable[],
  variants: ReadonlyMap<ModelWithTable, VariantInfo | undefined>,
): void {
  const tableEntries = models.filter((entry) => variants.get(entry)?.singleTable !== true);
  const tableNameCounts = new Map<string, number>();
  for (const entry of tableEntries) {
    tableNameCounts.set(entry.tableName, (tableNameCounts.get(entry.tableName) ?? 0) + 1);
  }
  const derived = new Map<string, ModelWithTable>();
  for (const entry of tableEntries) {
    if (variants.get(entry) !== undefined) continue;
    const key =
      (tableNameCounts.get(entry.tableName) ?? 0) > 1
        ? `${entry.namespaceId}.${entry.tableName}`
        : entry.tableName;
    derived.set(key, entry);
  }
  const refuse = (root: string) =>
    unsupported(
      `root "${root}" is not a root the PSL source derives, so the contract's roots cannot be written in Prisma 8 PSL.`,
      'The PSL source derives one root per model that is not a variant, keyed by its table name.',
      KEEP_SOURCE,
      { root },
    );
  for (const [root, reference] of Object.entries(contract.roots)) {
    const entry = derived.get(root);
    if (
      entry === undefined ||
      reference.space !== undefined ||
      reference.namespace !== entry.namespaceId ||
      reference.model !== entry.name
    ) {
      throw refuse(root);
    }
  }
  for (const root of derived.keys()) {
    if (!Object.hasOwn(contract.roots, root)) throw refuse(root);
  }
}

// Row-level security

export function refuseRlsWithoutModel(namespaceId: string, tableName: string): never {
  throw unsupported(
    `table "${namespaceId}"."${tableName}" has row-level security enabled but no model, so it cannot be written in Prisma 8 PSL.`,
    'Row-level security is written as `@@rls` on the model stored in the table.',
    'Declare a model for the table, or keep authoring this contract in its current source.',
    { namespaceId, table: tableName },
  );
}

function unwritablePolicy(policy: PostgresRlsPolicy, why: string, fix: string) {
  return unsupported(
    `policy "${policy.name}" on "${policy.namespaceId}"."${policy.tableName}" cannot be written in Prisma 8 PSL.`,
    why,
    fix,
    { namespaceId: policy.namespaceId, table: policy.tableName, name: policy.name },
  );
}

export function refusePolicyWithoutModel(policy: PostgresRlsPolicy): never {
  throw unwritablePolicy(
    policy,
    'A policy block names its table through the model stored there, and no model is stored in this table.',
    'Declare a model for the table, or keep authoring this contract in its current source.',
  );
}

export function refusePolicyWithoutRls(policy: PostgresRlsPolicy): never {
  throw unwritablePolicy(
    policy,
    'The PSL source reads a policy only on a model that declares `@@rls`, and this table does not have row-level security enabled.',
    'Enable row-level security on the table, or keep authoring this contract in its current source.',
  );
}

export function refusePolicyNameNotDerived(policy: PostgresRlsPolicy): never {
  throw unwritablePolicy(
    policy,
    'The PSL source names a wire-named policy by its block name and the hash of its content, and this name is not that.',
    KEEP_SOURCE,
  );
}

/** Refuses a role outside the unbound namespace: the PSL source reads a `role` block only there. */
export function refuseRoleOutsideUnbound(namespaceId: string, name: string): void {
  if (namespaceId === UNBOUND_NAMESPACE_ID) return;
  throw unsupported(
    `role "${name}" is declared in namespace "${namespaceId}", and Prisma 8 PSL declares a role only in the unbound namespace.`,
    'The PSL source reads a `role` block only inside `namespace unbound`, because roles belong to the whole database.',
    'Declare the role in the unbound namespace, or keep authoring this contract in its current source.',
    { namespaceId, name },
  );
}

const FILED_UNDER: Readonly<Record<'rls' | 'role', string>> = {
  rls: 'The PSL source files the row-level security setting written as `@@rls` under the name of the table.',
  role: 'The PSL source files a role under the name its block is written with.',
};

/** Refuses a row-level security setting or role filed under a key the PSL source would not use. */
export function refuseEntryFiledUnderAnotherName(input: {
  readonly namespaceId: string;
  readonly kind: 'rls' | 'role';
  readonly name: string;
  readonly readsBackAs: string;
}): void {
  if (input.name === input.readsBackAs) return;
  throw unsupported(
    `namespace "${input.namespaceId}" has a "${input.kind}" entry "${input.name}" that would read back as "${input.readsBackAs}", so it cannot be written in Prisma 8 PSL.`,
    FILED_UNDER[input.kind],
    KEEP_SOURCE,
    { namespaceId: input.namespaceId, kind: input.kind, name: input.name },
  );
}

/** Refuses an entry that records a namespace other than the one it is stored in. */
export function refuseEntryInOtherNamespace(input: {
  readonly namespaceId: string;
  readonly kind: string;
  readonly name: string;
  readonly recordedNamespaceId: string;
}): void {
  if (input.recordedNamespaceId === input.namespaceId) return;
  throw unsupported(
    `the "${input.kind}" entry "${input.name}" is stored in namespace "${input.namespaceId}" but records namespace "${input.recordedNamespaceId}", so it cannot be written in Prisma 8 PSL.`,
    'The PSL source records the namespace a block is written in, so the entry would read back with the namespace it is stored in.',
    'The contract source produced an entry that disagrees with its namespace. Fix the entry if the source is a TypeScript contract; otherwise report the bug to the source that produced it.',
    { namespaceId: input.namespaceId, kind: input.kind, name: input.name },
  );
}

// Names and storage entries

/**
 * Refuses a name the printer writes where PSL reads an identifier: a model, field, value object,
 * enum, enum member, native enum, named type, policy, role or index option key.
 */
export function refuseUnwritableName(kind: string, name: string): void {
  if (name === NAME_THE_PSL_SOURCE_LOSES) {
    throw unsupported(
      `${kind} "${name}" cannot be written in Prisma 8 PSL, because the PSL source loses this name when it reads it.`,
      'The PSL source keeps names as keys of plain objects, where this name sets the prototype instead of adding a key.',
      'Rename it, or keep authoring this contract in its current source.',
      { kind, name },
    );
  }
  if (isPslIdentifier(name)) return;
  throw unsupported(
    `${kind} "${name}" is not a PSL identifier, so it cannot be written in Prisma 8 PSL.`,
    'PSL writes this name as an identifier: a letter or underscore, then letters, ASCII digits, underscores or hyphens, other than the number words `NaN` and `Infinity`.',
    'Rename it to an identifier, or keep authoring this contract in its current source.',
    { kind, name },
  );
}

/** The storage entry kinds the printer writes; any other kind is refused, whichever component defines it. */
const PRINTED_ENTRY_KINDS: ReadonlySet<string> = new Set([
  'table',
  'valueSet',
  'native_enum',
  'rls',
  'policy',
  'role',
]);

export function refuseUnprintedEntryKinds(
  namespaceId: string,
  entries: SqlStorage['namespaces'][string]['entries'],
): void {
  for (const [kind, entities] of Object.entries(entries)) {
    if (PRINTED_ENTRY_KINDS.has(kind)) continue;
    const names = Object.keys(entities ?? {});
    if (names.length === 0) continue;
    throw unsupported(
      `namespace "${namespaceId}" declares ${names.length} "${kind}" ${names.length === 1 ? 'entity' : 'entities'} (${names.join(', ')}), which the Postgres printer cannot write.`,
      'The printer writes tables, value sets, native enums, row-level security settings, policies and roles, and no other entity kind.',
      KEEP_SOURCE,
      { namespaceId, kind, names },
    );
  }
}

/** Refuses an entry filed under a kind whose entity class does not accept it. */
export function refuseInvalidEntry(namespaceId: string, kind: string, name: string): never {
  throw unsupported(
    `namespace "${namespaceId}" has a "${kind}" entry "${name}" that is not a ${kind} entity.`,
    'The printer reads each storage entry through the entity class of its kind, and this entry does not have that shape.',
    'The contract source produced an entry the Postgres target does not accept. Fix the entry if the source is a TypeScript contract; otherwise report the bug to the source that produced it.',
    { namespaceId, kind, name },
  );
}
