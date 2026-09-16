import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import type { PslSpan, ResolvedAttribute } from '@internal/psl-parser';
import { parseQuotedStringLiteral } from '@internal/psl-parser';
import type { ExpressionAst } from '@internal/psl-parser/syntax';

export { parseQuotedStringLiteral };

export function getAttribute(
  attributes: readonly ResolvedAttribute[] | undefined,
  name: string,
): ResolvedAttribute | undefined {
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

export function unquoteStringLiteral(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^(['"])(.*)\1$/);
  if (!match) {
    return trimmed;
  }
  return match[2] ?? '';
}

export function mapFieldNamesToColumns(input: {
  readonly modelName: string;
  readonly fieldNames: readonly string[];
  readonly mapping: { readonly fieldColumns: Map<string, string> };
  readonly sourceId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
  readonly span: PslSpan;
  readonly entityLabel: string;
}): readonly string[] | undefined {
  const columns: string[] = [];
  for (const fieldName of input.fieldNames) {
    const columnName = input.mapping.fieldColumns.get(fieldName);
    if (!columnName) {
      input.diagnostics.push({
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        message: `${input.entityLabel} references unknown field "${input.modelName}.${fieldName}"`,
        sourceId: input.sourceId,
        span: input.span,
      });
      return undefined;
    }
    columns.push(columnName);
  }
  return columns;
}
