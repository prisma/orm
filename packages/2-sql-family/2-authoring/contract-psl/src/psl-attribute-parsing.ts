import type { AuthoringContributions } from '@internal/framework-components/authoring';
import type {
  FieldSymbol,
  ModelSymbol,
  PslSpan,
  ResolvedAttribute,
  SymbolTable,
} from '@internal/psl-parser';
import {
  type DiagnosticSource,
  diagnosticSource,
  type PslDiagnosticCollector,
  parseQuotedStringLiteral,
} from '@internal/psl-parser';
import type {
  ExpressionAst,
  FieldAttributeAst,
  ModelAttributeAst,
  PslSources,
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

export function formatDbAttributeMigrationMessage(
  attribute: ResolvedAttribute,
  renamedTypeConstructors: Readonly<Record<string, string>> | undefined,
): string {
  const renderedArguments = attribute.args
    .map((argument) =>
      argument.kind === 'named' && argument.name !== undefined
        ? `${argument.name}: ${argument.value}`
        : argument.value,
    )
    .join(', ');
  const argumentList = attribute.args.length === 0 ? '' : `(${renderedArguments})`;
  const nativeType = attribute.name.slice('db.'.length);
  const renamed =
    renamedTypeConstructors !== undefined && Object.hasOwn(renamedTypeConstructors, nativeType)
      ? renamedTypeConstructors[nativeType]
      : undefined;
  const constructorName = renamed ?? nativeType;

  return `@${attribute.name}${argumentList} is no longer supported; use ${constructorName}${argumentList} in type position`;
}

function isNameMap(value: unknown): value is Readonly<Record<string, string>> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every((name) => typeof name === 'string')
  );
}

/**
 * The target's renamed type constructors, contributed through `target.authoring.renamedTypeConstructors`: each former `@db.*` name mapped to the constructor that replaced it. Duck-typed so the SQL family stays blind to which names a target renamed.
 */
export function renamedTypeConstructorsOf(
  authoring: AuthoringContributions | undefined,
): Readonly<Record<string, string>> | undefined {
  if (authoring === undefined || !('renamedTypeConstructors' in authoring)) return undefined;
  return isNameMap(authoring.renamedTypeConstructors)
    ? authoring.renamedTypeConstructors
    : undefined;
}

/**
 * Refuses each `@db.*` attribute on a model or mixin field once, with the constructor to write instead. The binder leaves these to the interpreter because the suggestion needs the target. A mixin's field is shared by the models that use it, so each attribute is reported by its node.
 */
export function reportFieldDbAttributes(input: {
  readonly symbolTable: SymbolTable;
  readonly sources: PslSources;
  readonly diagnostics: PslDiagnosticCollector;
  readonly renamedTypeConstructors: Readonly<Record<string, string>> | undefined;
}): void {
  const reported = new Set<ResolvedAttribute['node']>();
  for (const namespace of Object.values(input.symbolTable.namespaces)) {
    const owners = [
      ...Object.values(namespace.models),
      ...Object.values(namespace.mixins).filter((mixin) => mixin.keyword !== 'type'),
    ];
    for (const owner of owners) {
      for (const field of Object.values(owner.fields)) {
        for (const attribute of field.attributes) {
          if (!attribute.name.startsWith('db.') || reported.has(attribute.node)) continue;
          reported.add(attribute.node);
          input.diagnostics.push({
            code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
            message: formatDbAttributeMigrationMessage(attribute, input.renamedTypeConstructors),
            ...diagnosticSource(input.sources, field.node.syntax).at(attribute.span),
          });
        }
      }
    }
  }
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
