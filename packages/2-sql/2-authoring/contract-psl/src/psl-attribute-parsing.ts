import type {
  FieldSymbol,
  ModelSymbol,
  PslDiagnostic,
  PslSpan,
  ResolvedAttribute,
} from '@internal/psl-parser';
import {
  type DiagnosticSource,
  type PslDiagnosticCollector,
  parseQuotedStringLiteral,
} from '@internal/psl-parser';
import type {
  ExpressionAst,
  FieldAttributeAst,
  ModelAttributeAst,
} from '@internal/psl-parser/syntax';
import { assertDefined } from '@internal/utils/assertions';

export { parseQuotedStringLiteral };

export function storageName(
  symbol: ModelSymbol | FieldSymbol,
  physicalNames: ReadonlyMap<ModelSymbol | FieldSymbol, string>,
): string {
  const name = physicalNames.get(symbol);
  assertDefined(name, 'Physical names are populated for every model and field before lowering');
  return name;
}

export function getAttribute<TNode extends FieldAttributeAst | ModelAttributeAst>(
  attributes: readonly ResolvedAttribute<TNode>[] | undefined,
  name: string,
): ResolvedAttribute<TNode> | undefined {
  return attributes?.find((attribute) => attribute.name === name);
}

export function formatDbAttributeMigrationMessage(attribute: ResolvedAttribute): string {
  const renderedArguments = attribute.args
    .map((argument) =>
      argument.kind === 'named' && argument.name !== undefined
        ? `${argument.name}: ${argument.value}`
        : argument.value,
    )
    .join(', ');
  const argumentList = attribute.args.length === 0 ? '' : `(${renderedArguments})`;
  const constructorName = attribute.name.slice('db.'.length);

  return `@${attribute.name}${argumentList} is no longer supported; use ${constructorName}${argumentList} in type position`;
}

export function getNamedArgument(attribute: ResolvedAttribute, name: string): string | undefined {
  const entry = attribute.args.find((arg) => arg.kind === 'named' && arg.name === name);
  if (entry?.kind !== 'named') {
    return undefined;
  }
  return entry.value;
}

export function getPositionalArgumentEntry(
  attribute: ResolvedAttribute,
  index = 0,
): { value: string; expression?: ExpressionAst; span: PslSpan } | undefined {
  const entries = attribute.args.filter((arg) => arg.kind === 'positional');
  const entry = entries[index];
  if (entry?.kind !== 'positional') {
    return undefined;
  }
  return {
    value: entry.value,
    ...(entry.expression !== undefined ? { expression: entry.expression } : {}),
    span: entry.span,
  };
}

export function mapFieldNamesToColumns(input: {
  readonly model: ModelSymbol;
  readonly physicalNames: ReadonlyMap<ModelSymbol | FieldSymbol, string>;
  readonly fieldNames: readonly string[];
  readonly source: DiagnosticSource;
  readonly diagnostics: PslDiagnosticCollector;
  readonly span: PslSpan;
  readonly entityLabel: string;
}): readonly string[] | undefined {
  const columns: string[] = [];
  for (const fieldName of input.fieldNames) {
    const field = input.model.fields[fieldName];
    if (field === undefined) {
      input.diagnostics.push({
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        message: `${input.entityLabel} references unknown field "${input.model.name}.${fieldName}"`,
        ...input.source.at(input.span),
      });
      return undefined;
    }
    columns.push(storageName(field, input.physicalNames));
  }
  return columns;
}

/**
 * The `PSL_DUPLICATE_ATTRIBUTE` diagnostic for a model attribute declared more than once on one
 * model. Shared by the built-in `@@control` and `@@hint` paths and the contributed-model-attribute
 * path so the code and wording stay in one place. `name` is the bare attribute name (`control`,
 * `rls`, …).
 */
export function duplicateModelAttributeDiagnostic(input: {
  readonly name: string;
  readonly modelName: string;
  readonly source: DiagnosticSource;
  readonly span: PslSpan;
}): PslDiagnostic {
  return {
    code: 'PSL_DUPLICATE_ATTRIBUTE',
    message: `\`@@${input.name}\` declared more than once on model "${input.modelName}".`,
    ...input.source.at(input.span),
  };
}
