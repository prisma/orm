import {
  type AuthoringArgumentDescriptor,
  type AuthoringPslBlockDescriptorNamespace,
  type AuthoringTypeChoiceOption,
  type AuthoringTypeChoiceRow,
  type DataTypeSupport,
  describeAdmittedForms,
  isAuthoringTypeChoiceOption,
  writtenTypeConstructorCall,
} from '@internal/framework-components/authoring';
import { dataTypeId } from '@internal/framework-components/codec';
import {
  type AttributeSymbol,
  type Binder,
  type BlockSymbol,
  type CompositeTypeSymbol,
  type ConstantSymbol,
  type ContributedTypeChoiceSymbol,
  type ContributedTypeSymbol,
  chosenTypeConstructor,
  type FieldSymbol,
  type FunctionSymbol,
  findBlockDescriptor,
  isContributedTypeChoice,
  type MixinSymbol,
  type ModelSymbol,
  type NamedTypeSymbol,
  type NamespaceSymbol,
  type ParameterSymbol,
  printTypeConstructorCall,
  readResolvedConstructorCall,
} from '@internal/psl-parser';
import {
  GenericBlockDeclarationAst,
  MixinDeclarationAst,
  type PslSources,
  type SyntaxNode,
  type SyntaxToken,
  TypeAnnotationAst,
} from '@internal/psl-parser/syntax';
import { type Hover, MarkupKind } from 'vscode-languageserver';
import type { PslCursorInput } from './attribute-syntax-context';
import { identTokenAt, resolvedNodeAt } from './cursor-resolution';
import {
  namedParameterText,
  renderSignatureLabel,
  resolveSignatureParameters,
} from './signature-help';

export interface ProvidePslHoverInput extends PslCursorInput {
  readonly binder: Binder;
  readonly pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace;
  /** The stack's data types, which say how a type constructor's value arguments are written. */
  readonly dataTypes: DataTypeSupport;
  readonly sources: PslSources;
}

type HoverEntitySymbol =
  | ModelSymbol
  | CompositeTypeSymbol
  | FieldSymbol
  | NamedTypeSymbol
  | BlockSymbol
  | MixinSymbol;

type HoverResult =
  | { readonly kind: 'entity'; readonly symbol: HoverEntitySymbol }
  | { readonly kind: 'namespace'; readonly symbol: NamespaceSymbol }
  | { readonly kind: 'attribute'; readonly symbol: AttributeSymbol }
  | {
      readonly kind: 'contributedType';
      readonly symbol: ContributedTypeSymbol;
      readonly annotation: TypeAnnotationAst | undefined;
    }
  | { readonly kind: 'parameter'; readonly symbol: ParameterSymbol }
  | { readonly kind: 'function'; readonly symbol: FunctionSymbol }
  | { readonly kind: 'constant'; readonly symbol: ConstantSymbol };

export function providePslHover(input: ProvidePslHoverInput): Hover | null {
  const offset = input.sourceFile.offsetAt(input.position);
  const token = identTokenAt(input.document.syntax, offset);
  if (token === undefined) return null;
  const value = hoverValueAt(input, token);
  if (value === undefined) return null;
  return {
    contents: { kind: MarkupKind.Markdown, value },
    range: {
      start: input.sourceFile.positionAt(token.offset),
      end: input.sourceFile.positionAt(token.endOffset),
    },
  };
}

function hoverValueAt(input: ProvidePslHoverInput, token: SyntaxToken): string | undefined {
  const result = resolveHoverResult(input.binder, token);
  if (result !== undefined) return renderHoverResult(result, input);
  return blockKeywordDocumentationAt(token, input.pslBlockDescriptors);
}

function resolveHoverResult(binder: Binder, token: SyntaxToken): HoverResult | undefined {
  const resolution = resolvedNodeAt(token, binder)?.resolution;
  switch (resolution?.kind) {
    case 'model':
    case 'compositeType':
    case 'namedType':
    case 'block':
    case 'mixin':
    case 'field':
      return { kind: 'entity', symbol: resolution.symbol };
    case 'namespace':
      return { kind: 'namespace', symbol: resolution.symbol };
    case 'attribute':
      return { kind: 'attribute', symbol: resolution.symbol };
    case 'contributedType':
      return {
        kind: 'contributedType',
        symbol: resolution.symbol,
        annotation: token.parent.findAncestor(TypeAnnotationAst.cast),
      };
    case 'parameter':
      return { kind: 'parameter', symbol: resolution.symbol };
    case 'function':
      return { kind: 'function', symbol: resolution.symbol };
    case 'constant':
      return { kind: 'constant', symbol: resolution.symbol };
    default:
      return undefined;
  }
}

function renderHoverResult(result: HoverResult, input: ProvidePslHoverInput): string {
  if (result.kind === 'entity') return renderEntityContent(result.symbol);
  if (result.kind === 'namespace') return renderNamespaceContent(result.symbol);
  if (result.kind === 'attribute') return renderAttributeContent(result.symbol);
  if (result.kind === 'contributedType') return renderContributedTypeContent(result, input);
  if (result.kind === 'parameter') return renderParameterContent(result.symbol);
  if (result.kind === 'function') return renderFunctionContent(result.symbol);
  return renderConstantContent(result.symbol);
}

function renderEntityContent(entity: HoverEntitySymbol): string {
  const fence = ['```prisma', renderDeclarationLine(entity), '```'].join('\n');
  return withDocumentation(fence, entity.node.docComment());
}

function renderNamespaceContent(namespace: NamespaceSymbol): string {
  return ['```prisma', `namespace ${namespace.name}`, '```'].join('\n');
}

function renderAttributeContent(symbol: AttributeSymbol): string {
  const name = `${symbol.level === 'field' ? '@' : '@@'}${symbol.name}`;
  const params = resolveSignatureParameters(symbol.spec, undefined);
  const { label } = renderSignatureLabel(name, symbol.spec, params);
  const fence = ['```prisma', label, '```'].join('\n');
  return withDocumentation(fence, symbol.spec.documentation);
}

function renderContributedTypeContent(
  result: Extract<HoverResult, { readonly kind: 'contributedType' }>,
  input: ProvidePslHoverInput,
): string {
  const { symbol } = result;
  const fence = ['```prisma', renderContributedTypeLabel(symbol, input.dataTypes), '```'].join(
    '\n',
  );
  if (!isContributedTypeChoice(symbol)) {
    return withDocumentation(fence, symbol.descriptor.documentation);
  }
  const chosen = renderChosenType(symbol, result.annotation, input);
  const head = chosen === undefined ? fence : `${fence}\n\n${chosen}`;
  return `${withDocumentation(head, symbol.descriptor.documentation)}\n\n${renderTypeChoices(symbol, input.dataTypes)}`;
}

/** The explicit type `type`, at the level of the type choice `symbol`, called with `args` as the tools write it; `undefined` when the type choice names no such type or an argument has no literal. */
function writtenChosenType(
  symbol: ContributedTypeChoiceSymbol,
  type: string,
  args: readonly unknown[],
  dataTypes: DataTypeSupport,
): string | undefined {
  const descriptor = symbol.choiceTypes.get(type);
  return (
    descriptor &&
    writtenTypeConstructorCall([...symbol.path.slice(0, -1), type], descriptor, args, dataTypes)
  );
}

/** The explicit type the call at `annotation` becomes, or `undefined` when its arguments choose none or it cannot be written. */
function renderChosenType(
  symbol: ContributedTypeChoiceSymbol,
  annotation: TypeAnnotationAst | undefined,
  input: ProvidePslHoverInput,
): string | undefined {
  const call = readResolvedConstructorCall(annotation, input.sources);
  const chosen = chosenTypeConstructor(symbol, call, input.dataTypes);
  const written =
    chosen.ok && writtenChosenType(symbol, chosen.value.type, chosen.value.args, input.dataTypes);
  if (written === false || written === undefined) return undefined;
  const callText = call === undefined ? symbol.path.join('.') : printTypeConstructorCall(call);
  return `${inlineCode(callText)} is exactly ${inlineCode(written)}.`;
}

/** Each combination of a type choice's options, as written, and the explicit type it becomes. */
function renderTypeChoices(
  symbol: ContributedTypeChoiceSymbol,
  dataTypes: DataTypeSupport,
): string {
  const { descriptor } = symbol;
  const options = descriptor.args.filter(isAuthoringTypeChoiceOption);
  const cell = (value: string | undefined, option: AuthoringTypeChoiceOption) =>
    value === option.default ? `${value} (default)` : (value ?? '');
  const becomes = (row: AuthoringTypeChoiceRow) => {
    const defaults = row.defaults ?? {};
    const args = (symbol.choiceTypes.get(row.type)?.args ?? []).map((argument) =>
      argument.name !== undefined && Object.hasOwn(defaults, argument.name)
        ? defaults[argument.name]
        : undefined,
    );
    const written = writtenChosenType(symbol, row.type, args, dataTypes);
    return inlineCode(written ?? `${[...symbol.path.slice(0, -1), row.type].join('.')}(...)`);
  };
  return [
    `| ${[...options.map((option) => option.name), 'Becomes'].join(' | ')} |`,
    `| ${[...options, undefined].map(() => '---').join(' | ')} |`,
    ...descriptor.choices.map(
      (row) =>
        `| ${[...options.map((option) => cell(row.when[option.name], option)), becomes(row)].join(' | ')} |`,
    ),
  ].join('\n');
}

/** `text` as a Markdown code span, fenced by more backticks than any run inside it. */
function inlineCode(text: string): string {
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longestRun + 1);
  const padding = text.startsWith('`') || text.endsWith('`') || longestRun > 0 ? ' ' : '';
  return `${fence}${padding}${text}${padding}${fence}`;
}

function renderParameterContent(symbol: ParameterSymbol): string {
  const fence = ['```prisma', namedParameterText(symbol.name, symbol.param.type), '```'].join('\n');
  return withDocumentation(fence, symbol.param.documentation);
}

function renderFunctionContent(symbol: FunctionSymbol): string {
  const params = resolveSignatureParameters(symbol.signature, undefined);
  const { label } = renderSignatureLabel(symbol.name, symbol.signature, params);
  const fence = ['```prisma', label, '```'].join('\n');
  return withDocumentation(fence, symbol.signature.documentation);
}

function renderConstantContent(symbol: ConstantSymbol): string {
  const fence = ['```prisma', symbol.name, '```'].join('\n');
  return withDocumentation(fence, symbol.documentation);
}

function withDocumentation(fence: string, documentation: string | undefined): string {
  return documentation === undefined || documentation === ''
    ? fence
    : `${fence}\n\n${documentation}`;
}

function renderContributedTypeLabel(
  symbol: ContributedTypeSymbol,
  dataTypes: DataTypeSupport,
): string {
  const path = symbol.path.join('.');
  const { descriptor } = symbol;
  const args = descriptor.kind === 'typeAlias' ? [] : (descriptor.args ?? []);
  if (args.length === 0) return path;
  const labels = args.map((arg, index) => {
    const key = arg.name ?? `arg${index + 1}`;
    return `${key}${arg.optional === true ? '?' : ''}: ${argumentTypeLabel(arg, dataTypes)}`;
  });
  return `${path}(${labels.join(', ')})`;
}

function argumentTypeLabel(
  arg: AuthoringArgumentDescriptor | AuthoringTypeChoiceOption,
  dataTypes: DataTypeSupport,
): string {
  return arg.kind === 'value'
    ? describeAdmittedForms(dataTypes, dataTypeId(arg.dataType))
    : arg.values.join(' | ');
}

function blockKeywordDocumentationAt(
  token: SyntaxToken,
  pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace,
): string | undefined {
  const declaration =
    GenericBlockDeclarationAst.cast(token.parent) ?? MixinDeclarationAst.cast(token.parent);
  if (declaration === undefined || declaration.keyword()?.offset !== token.offset) return undefined;
  return findBlockDescriptor(pslBlockDescriptors, token.text)?.documentation;
}

function renderDeclarationLine(entity: HoverEntitySymbol): string {
  if (entity.kind === 'block') return `${entity.keyword} ${entity.name}`;
  if (entity.kind === 'mixin') return `${entity.keyword} mixin ${entity.name}`;
  if (entity.kind === 'field' || entity.kind === 'namedType') {
    return collapseWhitespace(printSyntaxWithoutComments(entity.node.syntax));
  }
  return `${entity.node.keyword()?.text ?? ''} ${entity.name}`;
}

function printSyntaxWithoutComments(node: SyntaxNode): string {
  let text = '';
  for (const token of node.tokens()) {
    if (token.kind === 'Comment') continue;
    text += token.text;
  }
  return text;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
