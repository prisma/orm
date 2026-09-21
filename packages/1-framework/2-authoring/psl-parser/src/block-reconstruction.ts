import type { AuthoringPslBlockDescriptor } from '@internal/framework-components/authoring';
import type {
  PslBlockParam,
  PslExtensionBlock,
  PslExtensionBlockAttribute,
  PslExtensionBlockParamValue,
  PslExtensionBlockParsedAttribute,
  PslSpan,
} from '@internal/framework-components/psl-ast';
import { blindCast } from '@internal/utils/casts';
import { interpretAttribute } from './attribute-spec/interpret';
import type { BlockAttributeSpecFactory } from './attribute-spec/spec-context';
import type { ParseDiagnostic } from './parse';
import { nodePslSpan } from './resolve';
import type { PslSources } from './source-file';
import type { ModelAttributeAst } from './syntax/ast/attributes';
import type { GenericBlockDeclarationAst, KeyValuePairAst } from './syntax/ast/declarations';
import { ArrayLiteralAst, type ExpressionAst } from './syntax/ast/expressions';
import { printSyntax } from './syntax/ast-helpers';

/**
 * Descriptor-free and unknown parameters become `value` stubs so validation can
 * report them via key-set comparison. Duplicate member names are first-wins.
 */
export function reconstructExtensionBlock(
  node: GenericBlockDeclarationAst,
  descriptor: AuthoringPslBlockDescriptor | undefined,
  sources: PslSources,
  diagnostics: ParseDiagnostic[],
): PslExtensionBlock {
  const sourceFile = sources.sourceFileFor(node.syntax);
  const keyword = node.keyword()?.text ?? '';
  const blockName = node.name()?.name() ?? '';

  const blockAttributes: PslExtensionBlockAttribute[] = [];
  const attributes: Record<string, PslExtensionBlockParsedAttribute> = {};
  const seenAttributeNames = new Set<string>();
  for (const attribute of node.attributes()) {
    const name = attribute.name()?.path().join('.') ?? '';
    const args = Array.from(attribute.argList()?.args() ?? [], (arg) => {
      const value = arg.value();
      return {
        kind: 'positional' as const,
        value: value === undefined ? '' : printSyntax(value.syntax).trim(),
        span: nodePslSpan(arg.syntax, sources),
      };
    });
    const span = nodePslSpan(attribute.syntax, sources);
    blockAttributes.push({ name, args, span });
    if (descriptor === undefined) continue;
    const parsed = parseBlockAttribute(
      attribute,
      name,
      span,
      descriptor,
      seenAttributeNames,
      keyword,
      blockName,
      sources,
    );
    if (parsed.ok) {
      attributes[name] = parsed.value;
    } else {
      diagnostics.push(...parsed.diagnostics);
    }
  }

  const parameters: Record<string, PslExtensionBlockParamValue> = {};
  for (const entry of node.entries()) {
    const key = entry.key()?.name();
    if (key === undefined) continue;
    const span = nodePslSpan(entry.syntax, sources);
    if (Object.hasOwn(parameters, key)) {
      diagnostics.push({
        filename: sourceFile.filename,
        code: 'PSL_EXTENSION_DUPLICATE_PARAMETER',
        message: `Duplicate parameter "${key}" in "${keyword}" block "${blockName}"; first occurrence wins`,
        range: {
          start: sourceFile.positionAt(entry.syntax.offset),
          end: sourceFile.positionAt(entry.syntax.offset + entry.syntax.green.textLength),
        },
      });
      continue;
    }
    parameters[key] = reconstructParamValue(
      entry,
      descriptor?.parameters[key],
      span,
      sources,
      diagnostics,
    );
  }

  return {
    kind: descriptor?.discriminator ?? keyword,
    keyword,
    name: blockName,
    parameters,
    blockAttributes,
    attributes,
    span: nodePslSpan(node.syntax, sources),
  };
}

function parseBlockAttribute(
  attribute: ModelAttributeAst,
  name: string,
  span: PslSpan,
  descriptor: AuthoringPslBlockDescriptor,
  seenNames: Set<string>,
  keyword: string,
  blockName: string,
  sources: PslSources,
):
  | { readonly ok: true; readonly value: PslExtensionBlockParsedAttribute }
  | { readonly ok: false; readonly diagnostics: readonly ParseDiagnostic[] } {
  const sourceFile = sources.sourceFileFor(attribute.syntax);
  const range = sourceFile.pslSpanToRange(span);
  const declared = descriptor.attributes ?? {};
  if (!Object.hasOwn(declared, name)) {
    return {
      ok: false,
      diagnostics: [
        {
          filename: sourceFile.filename,
          code: 'PSL_EXTENSION_UNKNOWN_BLOCK_ATTRIBUTE',
          message: `Unknown attribute "@@${name}" in "${keyword}" block "${blockName}"`,
          range,
        },
      ],
    };
  }
  if (seenNames.has(name)) {
    return {
      ok: false,
      diagnostics: [
        {
          filename: sourceFile.filename,
          code: 'PSL_INVALID_EXTENSION_BLOCK_ATTRIBUTE',
          message: `Duplicate attribute "@@${name}" in "${keyword}" block "${blockName}"; first occurrence wins`,
          range,
        },
      ],
    };
  }
  seenNames.add(name);
  const factory = blindCast<
    BlockAttributeSpecFactory,
    'framework core cannot name AttributeSpec, so block-attribute factories transit the descriptor erased as unknown; this is the single point that restores the factory type the descriptor surface documents'
  >(declared[name]);
  const result = interpretAttribute(attribute, factory(), { sources });
  if (!result.ok) {
    return {
      ok: false,
      diagnostics: result.failure,
    };
  }
  return { ok: true, value: { args: result.value, span } };
}

function reconstructParamValue(
  entry: KeyValuePairAst,
  param: PslBlockParam | undefined,
  span: PslSpan,
  sources: PslSources,
  diagnostics: ParseDiagnostic[],
): PslExtensionBlockParamValue {
  const value = entry.value();
  if (value === undefined) {
    return { kind: 'bare', span };
  }
  return reconstructFromExpression(value, param, span, sources, diagnostics);
}

function reconstructFromExpression(
  value: ExpressionAst,
  param: PslBlockParam | undefined,
  span: PslSpan,
  sources: PslSources,
  diagnostics?: ParseDiagnostic[],
): PslExtensionBlockParamValue {
  const raw = printSyntax(value.syntax).trim();
  if (param?.kind === 'list') {
    const sourceFile = sources.sourceFileFor(value.syntax);
    const array = ArrayLiteralAst.cast(value.syntax);
    if (!array) {
      diagnostics?.push({
        filename: sourceFile.filename,
        code: 'PSL_EXTENSION_INVALID_VALUE',
        message: `List parameter expects an array literal, got ${raw}`,
        range: {
          start: sourceFile.positionAt(value.syntax.offset),
          end: sourceFile.positionAt(value.syntax.offset + value.syntax.green.textLength),
        },
      });
      return { kind: 'value', raw, span };
    }

    const items: PslExtensionBlockParamValue[] = [];
    for (const element of array.elements()) {
      items.push(
        reconstructFromExpression(
          element,
          param.of,
          nodePslSpan(element.syntax, sources),
          sources,
          diagnostics,
        ),
      );
    }
    return { kind: 'list', items, span };
  }
  switch (param?.kind) {
    case 'ref':
      return { kind: 'ref', identifier: raw, span };
    case 'option':
      return { kind: 'option', token: raw, span };
    default:
      return { kind: 'value', raw, span };
  }
}
