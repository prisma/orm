import type {
  Contract,
  ContractModel,
  ExecutionMutationDefaultPhases,
} from '@internal/contract/types';
import type {
  PslAttributeArgument,
  PslField,
  PslFieldAttribute,
  PslModel,
  PslModelAttribute,
} from '@internal/framework-components/psl-ast';
import type { ReferentialAction, SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import {
  buildAttribute,
  buildMapAttribute,
  escapePslString,
  namedArg,
  positionalArg,
  SYNTHETIC_SPAN,
} from '../psl-infer/psl-literals';
import { printGeneratorDefault, printStorageDefault } from './print-defaults';
import {
  foreignKeyOf,
  modelStorageOf,
  type RelationSite,
  referenceRelation,
  relationKey,
} from './print-relations';
import { printColumnType, TEMPORAL_PRESET_BY_GENERATOR_ID } from './print-types';

export interface PrintModelInput {
  readonly contract: Contract<SqlStorage>;
  readonly namespaceId: string;
  readonly modelName: string;
  readonly model: ContractModel;
  readonly enumHandleByTypeName: ReadonlyMap<string, string>;
  readonly relationNames: ReadonlyMap<string, string>;
  readonly executionDefaults: ReadonlyMap<string, ExecutionMutationDefaultPhases>;
}

export function executionDefaultKey(namespace: string, table: string, column: string): string {
  return JSON.stringify([namespace, table, column]);
}

function lowerFirst(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

const REFERENTIAL_ACTION_TOKENS: Readonly<Record<ReferentialAction, string>> = {
  cascade: 'Cascade',
  restrict: 'Restrict',
  setNull: 'SetNull',
  setDefault: 'SetDefault',
  noAction: 'NoAction',
};

export function printModel(input: PrintModelInput): PslModel {
  const { contract, namespaceId, modelName, model } = input;
  const storage = modelStorageOf(model);
  const table = contract.storage.namespaces[storage.namespaceId]?.entries.table?.[storage.table];
  if (table === undefined) {
    throw new InternalError(
      `Model "${modelName}": table "${storage.namespaceId}.${storage.table}" is missing from the storage plane`,
    );
  }
  const fieldByColumn = new Map<string, string>();
  for (const [fieldName, fieldStorage] of Object.entries(storage.fields)) {
    fieldByColumn.set(fieldStorage.column, fieldName);
  }
  const fieldNamesOf = (columns: readonly string[]): string =>
    `[${columns.map((column) => fieldByColumn.get(column) ?? column).join(', ')}]`;

  const fields: PslField[] = [];
  for (const [fieldName, field] of Object.entries(model.fields)) {
    const label = `Model "${modelName}", field "${fieldName}"`;
    const columnName = storage.fields[fieldName]?.column;
    const column = columnName === undefined ? undefined : table.columns[columnName];
    if (columnName === undefined || column === undefined) {
      throw new InternalError(`${label}: no storage column`);
    }
    if (field.type.kind !== 'scalar') {
      throw new InternalError(
        `${label}: a "${field.type.kind}" field has no Prisma 8 PSL spelling`,
      );
    }
    fields.push(
      printScalarField({
        fieldName,
        columnName,
        column,
        table,
        label,
        phases: input.executionDefaults.get(
          executionDefaultKey(storage.namespaceId, storage.table, columnName),
        ),
        enumHandleByTypeName: input.enumHandleByTypeName,
      }),
    );
  }
  for (const [fieldName, relation] of Object.entries(model.relations)) {
    fields.push(
      printRelationField(
        {
          namespaceId,
          modelName,
          fieldName,
          model,
          relation: referenceRelation(relation, `Model "${modelName}", relation "${fieldName}"`),
        },
        input,
        fieldNamesOf,
      ),
    );
  }

  const attributes: PslModelAttribute[] = [];
  if (table.primaryKey !== undefined && table.primaryKey.columns.length > 1) {
    const args: PslAttributeArgument[] = [positionalArg(fieldNamesOf(table.primaryKey.columns))];
    if (table.primaryKey.name !== undefined) {
      args.push(namedArg('map', `"${escapePslString(table.primaryKey.name)}"`));
    }
    attributes.push(buildAttribute('model', 'id', args));
  }
  for (const unique of table.uniques) {
    const args: PslAttributeArgument[] = [positionalArg(fieldNamesOf(unique.columns))];
    if (unique.name !== undefined) args.push(namedArg('map', `"${escapePslString(unique.name)}"`));
    attributes.push(buildAttribute('model', 'unique', args));
  }
  for (const index of table.indexes) {
    const args: PslAttributeArgument[] = [];
    if (index.columns !== undefined) {
      args.push(positionalArg(fieldNamesOf(index.columns)));
    } else if (index.expression !== undefined) {
      args.push(namedArg('expression', `"${escapePslString(index.expression)}"`));
    }
    if (index.unique) args.push(namedArg('unique', 'true'));
    if (index.type !== undefined) args.push(namedArg('type', `"${escapePslString(index.type)}"`));
    if (index.options !== undefined) {
      const entries = Object.entries(index.options)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, value]) => `${key}: "${escapePslString(String(value))}"`);
      args.push(namedArg('options', entries.length === 0 ? '{}' : `{ ${entries.join(', ')} }`));
    }
    if (index.where !== undefined)
      args.push(namedArg('where', `"${escapePslString(index.where)}"`));
    args.push(
      index.prefix !== undefined
        ? namedArg('name', `"${escapePslString(index.prefix)}"`)
        : namedArg('map', `"${escapePslString(index.name)}"`),
    );
    attributes.push(buildAttribute('model', 'index', args));
  }
  for (const check of table.checks ?? []) {
    attributes.push(
      buildAttribute('model', 'check', [
        namedArg('expression', `"${escapePslString(check.expression)}"`),
        check.prefix !== undefined
          ? namedArg('name', `"${escapePslString(check.prefix)}"`)
          : namedArg('map', `"${escapePslString(check.name)}"`),
      ]),
    );
  }
  if (table.control !== undefined) {
    attributes.push(buildAttribute('model', 'control', [positionalArg(table.control)]));
  }
  if (storage.table !== lowerFirst(modelName)) {
    attributes.push(buildMapAttribute('model', storage.table));
  }

  return { kind: 'model', name: modelName, fields, attributes, span: SYNTHETIC_SPAN };
}

function printScalarField(input: {
  readonly fieldName: string;
  readonly columnName: string;
  readonly column: StorageTable['columns'][string];
  readonly table: StorageTable;
  readonly label: string;
  readonly phases: ExecutionMutationDefaultPhases | undefined;
  readonly enumHandleByTypeName: ReadonlyMap<string, string>;
}): PslField {
  const { fieldName, columnName, column, table, label, phases } = input;
  const attributes: PslFieldAttribute[] = [];
  const isSingleId =
    table.primaryKey !== undefined &&
    table.primaryKey.columns.length === 1 &&
    table.primaryKey.columns[0] === columnName;
  if (isSingleId) {
    attributes.push(
      buildAttribute(
        'field',
        'id',
        table.primaryKey?.name === undefined
          ? []
          : [namedArg('map', `"${escapePslString(table.primaryKey.name)}"`)],
      ),
    );
  }

  const presetType = phases === undefined ? undefined : printTemporalPreset(phases, column, label);
  if (presetType === undefined) {
    if (column.default !== undefined && phases?.onCreate !== undefined) {
      throw new InternalError(`${label}: both a storage default and an execution generator`);
    }
    if (column.default !== undefined) {
      attributes.push(printStorageDefault(column.default, column, label));
    } else if (phases?.onCreate !== undefined) {
      attributes.push(printGeneratorDefault(phases.onCreate, label));
    }
  }
  if (column.noCheck !== undefined && column.noCheck.length > 0) {
    attributes.push(buildAttribute('field', 'noCheck', column.noCheck.map(positionalArg)));
  }
  if (columnName !== fieldName) {
    attributes.push(buildMapAttribute('field', columnName));
  }

  const type = presetType ?? printColumnType(column, input.enumHandleByTypeName, label);
  return {
    kind: 'field',
    name: fieldName,
    typeName: type.typeName,
    ...ifDefined('typeConstructor', type.typeConstructor),
    optional: column.nullable,
    list: column.many === true,
    attributes,
    span: SYNTHETIC_SPAN,
  };
}

/**
 * A create-and-update "now" generator pair is the field preset
 * `temporal.<timestamp|timestamptz>(<precision>, onCreate: now, onUpdate: now)`.
 * Any other phase combination has no Prisma 8 PSL spelling.
 */
function printTemporalPreset(
  phases: ExecutionMutationDefaultPhases,
  column: StorageTable['columns'][string],
  label: string,
):
  | { readonly typeName: string; readonly typeConstructor: PslField['typeConstructor'] }
  | undefined {
  if (phases.onUpdate === undefined) return undefined;
  const preset =
    phases.onCreate?.id === phases.onUpdate.id
      ? TEMPORAL_PRESET_BY_GENERATOR_ID[phases.onUpdate.id]
      : undefined;
  if (preset === undefined || preset.codecId !== column.codecId || column.default !== undefined) {
    throw new InternalError(
      `${label}: generators onCreate "${phases.onCreate?.id}" and onUpdate "${phases.onUpdate.id}" on codec "${column.codecId}" have no Prisma 8 PSL spelling`,
    );
  }
  const precision = column.typeParams?.['precision'];
  const args: PslAttributeArgument[] = [];
  if (precision !== undefined) args.push(positionalArg(String(precision)));
  args.push(namedArg('onCreate', 'now'), namedArg('onUpdate', 'now'));
  return {
    typeName: `temporal.${preset.preset}`,
    typeConstructor: {
      kind: 'typeConstructor',
      path: ['temporal', preset.preset],
      args,
      span: SYNTHETIC_SPAN,
    },
  };
}

function printRelationField(
  site: RelationSite,
  input: PrintModelInput,
  fieldNamesOf: (columns: readonly string[]) => string,
): PslField {
  const { relation, fieldName } = site;
  const label = `Model "${site.modelName}", relation "${fieldName}"`;
  const target = input.contract.domain.namespaces[relation.to.namespace]?.models[relation.to.model];
  if (target === undefined) {
    throw new InternalError(`${label}: target model "${relation.to.model}" is missing`);
  }
  const name = input.relationNames.get(relationKey(site.namespaceId, site.modelName, fieldName));
  const args: PslAttributeArgument[] = [];
  if (name !== undefined) args.push(positionalArg(`"${escapePslString(name)}"`));

  const foreignKey = foreignKeyOf(input.contract, site);
  let optional = false;
  let list = false;
  if (foreignKey !== undefined && relation.cardinality !== 'N:M') {
    const targetStorage = modelStorageOf(target);
    const targetFieldByColumn = new Map(
      Object.entries(targetStorage.fields).map(([field, fieldStorage]) => [
        fieldStorage.column,
        field,
      ]),
    );
    args.push(
      namedArg('fields', fieldNamesOf(foreignKey.source.columns)),
      namedArg(
        'references',
        `[${foreignKey.target.columns
          .map((column) => targetFieldByColumn.get(column) ?? column)
          .join(', ')}]`,
      ),
    );
    if (foreignKey.onDelete !== undefined) {
      args.push(namedArg('onDelete', REFERENTIAL_ACTION_TOKENS[foreignKey.onDelete]));
    }
    if (foreignKey.onUpdate !== undefined) {
      args.push(namedArg('onUpdate', REFERENTIAL_ACTION_TOKENS[foreignKey.onUpdate]));
    }
    if (foreignKey.name !== undefined) {
      args.push(namedArg('map', `"${escapePslString(foreignKey.name)}"`));
    }
    // Prisma 8 derives an index over the foreign key unless an authored one
    // covers it; the contract already states every index it has.
    args.push(namedArg('index', 'false'));
    optional = relation.cardinality === '1:N' ? false : relation.nullable;
  } else if (relation.cardinality === 'N:M' || relation.cardinality === '1:N') {
    list = true;
  } else {
    optional = true;
  }

  return {
    kind: 'field',
    name: fieldName,
    typeName: relation.to.model,
    ...ifDefined(
      'typeNamespaceId',
      relation.to.namespace === site.namespaceId ? undefined : relation.to.namespace,
    ),
    optional,
    list,
    attributes: args.length > 0 ? [buildAttribute('field', 'relation', args)] : [],
    span: SYNTHETIC_SPAN,
  };
}
