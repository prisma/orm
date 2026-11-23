import type {
  BetterAuthField,
  BetterAuthModel,
  ReferentialAction,
} from '../models/better-auth-models';
import { lowerFirst, upperFirst } from '../models/identifiers';
import type { FoundModel } from '../models/model-lookup';
import type { ComparedModel, ContractComparison } from './compare';
import { idFieldOf, pslTypeOf } from './psl-types';

/** One field line, as its columns: name, type, then attributes when there are any. */
type FieldLine = readonly [name: string, type: string, attributes?: string | undefined];

export interface PrintedBlock {
  /** The model's name: as printed for a missing model, as in the contract for an existing one. */
  readonly modelName: string;
  readonly namespaceId: string;
  readonly existing: boolean;
  /** The table a missing model is stored in; `undefined` for an existing model. */
  readonly table: string | undefined;
  /** The columns of the scalar fields the block adds to an existing model. */
  readonly columns: readonly string[];
  readonly fieldNames: readonly string[];
  readonly fieldLines: readonly string[];
  readonly attributeLines: readonly string[];
}

export interface PrintedPsl {
  readonly blocks: readonly PrintedBlock[];
  readonly notes: readonly string[];
  readonly text: string;
}

interface PrintedModel {
  readonly name: string;
  readonly namespaceId: string;
  readonly existing: boolean;
  readonly table: string | undefined;
  readonly columns: string[];
  readonly taken: Set<string>;
  readonly fields: FieldLine[];
  readonly backRelations: FieldLine[];
  readonly attributes: string[];
}

const actionNames: Readonly<Record<ReferentialAction, string>> = {
  cascade: 'Cascade',
  'no action': 'NoAction',
  restrict: 'Restrict',
  'set null': 'SetNull',
  'set default': 'SetDefault',
};

function existingPrintedModel(
  found: FoundModel,
  betterAuthFields: readonly string[],
): PrintedModel {
  return {
    name: found.name,
    namespaceId: found.namespaceId,
    existing: true,
    table: undefined,
    columns: [],
    taken: new Set([
      ...betterAuthFields,
      ...Object.keys(found.model.fields),
      ...Object.keys(found.model.relations),
    ]),
    fields: [],
    backRelations: [],
    attributes: [],
  };
}

function printedModelFor(
  model: ComparedModel,
  comparison: ContractComparison,
): PrintedModel | undefined {
  const betterAuthFields = ['id', ...model.expected.fields.map((field) => field.name)];
  switch (model.status) {
    case 'missing':
      return {
        name: upperFirst(model.expected.physicalName),
        namespaceId: comparison.namespace ?? comparison.defaultNamespace,
        existing: false,
        table: model.expected.physicalName,
        columns: [],
        taken: new Set(betterAuthFields),
        fields: [],
        backRelations: [],
        attributes: [],
      };
    case 'found':
      return existingPrintedModel(model.found, betterAuthFields);
    case 'ambiguous':
      return undefined;
  }
}

function typeName(of: PrintedModel, from: PrintedModel): string {
  return of.namespaceId === from.namespaceId ? of.name : `${of.namespaceId}.${of.name}`;
}

function scalarLine(field: BetterAuthField, comparison: ContractComparison): FieldLine {
  const optional = field.attribute.required === false ? '?' : '';
  const type = `${pslTypeOf(field.attribute, field.reference, comparison)}${optional}`;
  return field.attribute.unique === true ? [field.name, type, '@unique'] : [field.name, type];
}

function idLine(comparison: ContractComparison): FieldLine {
  const { name, type, attributes } = idFieldOf(comparison.idStrategy);
  return [name, type, attributes];
}

function freeName(name: string, printed: PrintedModel): string {
  let free = name;
  while (printed.taken.has(free)) free = `${free}_`;
  return free;
}

function relationFieldName(foreignKey: string, holder: PrintedModel): string {
  const stripped = foreignKey.endsWith('Id') ? foreignKey.slice(0, -2) : foreignKey;
  return stripped === '' || stripped === foreignKey || holder.taken.has(stripped)
    ? freeName(`${foreignKey}Relation`, holder)
    : stripped;
}

function foreignKeyCount(expected: BetterAuthModel, referenced: string): number {
  return expected.fields.filter((field) => field.reference?.model === referenced).length;
}

function indexLines(expected: BetterAuthModel): string[] {
  const lines = [
    ...expected.fields
      .filter((field) => field.attribute.index === true && field.attribute.unique !== true)
      .map((field) => `@@index([${field.name}])`),
    ...expected.indexes.map(
      (index) => `${index.unique ? '@@unique' : '@@index'}([${index.fields.join(', ')}])`,
    ),
  ];
  return [...new Set(lines)];
}

function alignedLines(lines: readonly FieldLine[]): string[] {
  const nameWidth = Math.max(0, ...lines.map(([name]) => name.length));
  const typeWidth = Math.max(0, ...lines.map(([, type]) => type.length));
  return lines.map(([name, type, attributes]) =>
    attributes === undefined || attributes === ''
      ? `${name.padEnd(nameWidth)} ${type}`
      : `${name.padEnd(nameWidth)} ${type.padEnd(typeWidth)} ${attributes}`,
  );
}

function blockText(block: PrintedBlock, indent: string): string {
  const body = [...block.fieldLines.map((line) => `  ${line}`)];
  if (block.attributeLines.length > 0) {
    body.push('', ...block.attributeLines.map((line) => `  ${line}`));
  }
  return [`model ${block.modelName} {`, ...body, '}']
    .map((line) => (line === '' ? '' : `${indent}${line}`))
    .join('\n');
}

/** PSL text for printed blocks; blocks of missing models go inside a `namespace` block when the adapter's `namespace` option is set. */
export function renderBlocks(
  blocks: readonly PrintedBlock[],
  namespace: string | undefined,
): string {
  const chunks: string[] = [];
  let run: PrintedBlock[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const inner = run.map((block) => blockText(block, '  ')).join('\n\n');
    chunks.push(`namespace ${namespace} {\n${inner}\n}`);
    run = [];
  };
  for (const block of blocks) {
    if (namespace !== undefined && !block.existing) {
      run.push(block);
      continue;
    }
    flush();
    chunks.push(blockText(block, ''));
  }
  flush();
  return chunks.join('\n\n');
}

/**
 * The PSL that adds what the comparison found missing: whole models for missing models, and the missing fields and new back-relation fields of existing models.
 */
export function printPsl(comparison: ContractComparison): PrintedPsl {
  const printedModels = new Map<string, PrintedModel>();
  for (const model of comparison.models) {
    const printed = printedModelFor(model, comparison);
    if (printed !== undefined) printedModels.set(model.expected.physicalName, printed);
  }
  for (const [physicalName, found] of comparison.referencedModels) {
    printedModels.set(physicalName, existingPrintedModel(found, []));
  }
  const notes: string[] = [];

  for (const model of comparison.models) {
    const holder = printedModels.get(model.expected.physicalName);
    if (holder === undefined) continue;
    if (model.status === 'found') {
      for (const name of model.missingFields) {
        const field = model.expected.fields.find((candidate) => candidate.name === name);
        holder.fields.push(
          field === undefined ? idLine(comparison) : scalarLine(field, comparison),
        );
        holder.columns.push(name);
      }
      continue;
    }
    holder.fields.push(idLine(comparison));
    for (const field of model.expected.fields) {
      holder.fields.push(scalarLine(field, comparison));
      const reference = field.reference;
      if (reference === undefined) continue;
      const referenced = printedModels.get(reference.model);
      const optional = field.attribute.required === false;

      let action = reference.onDelete;
      if ((action === 'set null' && !optional) || action === 'set default') {
        notes.push(
          `${holder.name}.${field.name}: Better Auth asks for onDelete ${action}, which needs ${action === 'set null' ? 'an optional field' : 'a default'}; NoAction is used instead`,
        );
        action = 'no action';
      }

      const relationName = relationFieldName(field.name, holder);
      holder.taken.add(relationName);

      let relationLabel: string | undefined;
      if (referenced !== undefined) {
        const list = field.attribute.unique !== true;
        const base = `${lowerFirst(holder.name)}${list ? 's' : ''}`;
        const named =
          referenced.taken.has(base) || foreignKeyCount(model.expected, reference.model) > 1;
        const backName = named ? freeName(`${base}By${upperFirst(field.name)}`, referenced) : base;
        relationLabel = named ? `"${holder.name}_${field.name}"` : undefined;
        referenced.taken.add(backName);
        referenced.backRelations.push([
          backName,
          `${typeName(holder, referenced)}${list ? '[]' : '?'}`,
          relationLabel === undefined ? undefined : `@relation(${relationLabel})`,
        ]);
      }

      const referencedType =
        referenced === undefined ? upperFirst(reference.model) : typeName(referenced, holder);
      const relationArguments = [
        ...(relationLabel === undefined ? [] : [relationLabel]),
        `fields: [${field.name}]`,
        `references: [${reference.field}]`,
        `onDelete: ${actionNames[action]}`,
      ].join(', ');
      holder.fields.push([
        relationName,
        `${referencedType}${optional ? '?' : ''}`,
        `@relation(${relationArguments})`,
      ]);
    }
    holder.attributes.push(
      ...indexLines(model.expected),
      `@@map("${model.expected.physicalName}")`,
    );
  }

  const blocks: PrintedBlock[] = [];
  for (const printed of printedModels.values()) {
    const lines = [...printed.fields, ...printed.backRelations];
    if (lines.length === 0) continue;
    blocks.push({
      modelName: printed.name,
      namespaceId: printed.namespaceId,
      existing: printed.existing,
      table: printed.table,
      columns: printed.columns,
      fieldNames: lines.map(([name]) => name),
      fieldLines: alignedLines(lines),
      attributeLines: printed.attributes,
    });
  }
  return { blocks, notes, text: renderBlocks(blocks, comparison.namespace) };
}
