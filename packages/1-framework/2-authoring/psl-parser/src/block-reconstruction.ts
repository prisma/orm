import type { AuthoringPslBlockDescriptor } from '@internal/framework-components/authoring';
import type {
  PslBlockParam,
  PslDiagnostic,
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
import type { Range, SourceFile } from './source-file';
import type { ModelAttributeAst } from './syntax/ast/attributes';
import type { GenericBlockDeclarationAst, KeyValuePairAst } from './syntax/ast/declarations';
import { ArrayLiteralAst, type ExpressionAst } from './syntax/ast/expressions';
import { printSyntax } from './syntax/ast-helpers';

const BLOCK_ATTRIBUTE_SOURCE_ID = 'unknown';

/**
 * Descriptor-free and unknown parameters become `value` stubs so validation can
 * report them via key-set comparison. Duplicate member names are first-wins.
 */
export function reconstructExtensionBlock(
  node: GenericBlockDeclarationAst,
  descriptor: AuthoringPslBlockDescriptor | undefined,
  sourceFile: SourceFile,
  diagnostics: ParseDiagnostic[],
): PslExtensionBlock {
  const keyword = node.keyword()?.text ?? '';
  const blockName = node.name()?.name() ?? '';

  const blockAttributes: PslExtensionBlockAttribute[] = [];
  const attributes: Record<string, PslExtensionBlockParsedAttribute> = {};
  for (const attribute of node.attributes()) {
    const name = attribute.name()?.path().join('.') ?? '';
    const args = Array.from(attribute.argList()?.args() ?? [], (arg) => {
      const value = arg.value();
      return {
        kind: 'positional' as const,
        value: value === undefined ? '' : printSyntax(value.syntax).trim(),
        span: nodePslSpan(arg.syntax, sourceFile),
      };
    });
    const span = nodePslSpan(attribute.syntax, sourceFile);
    blockAttributes.push({ name, args, span });
    if (descriptor === undefined) continue;
    const parsed = parseBlockAttribute(
      attribute,
      name,
      span,
      descriptor,
      attributes,
      keyword,
      blockName,
      sourceFile,
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
    const span = nodePslSpan(entry.syntax, sourceFile);
    if (Object.hasOwn(parameters, key)) {
      diagnostics.push({
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
      sourceFile,
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
    span: nodePslSpan(node.syntax, sourceFile),
  };
}

function parseBlockAttribute(
  attribute: ModelAttributeAst,
  name: string,
  span: PslSpan,
  descriptor: AuthoringPslBlockDescriptor,
  parsedSoFar: Readonly<Record<string, PslExtensionBlockParsedAttribute>>,
  keyword: string,
  blockName: string,
  sourceFile: SourceFile,
):
  | { readonly ok: true; readonly value: PslExtensionBlockParsedAttribute }
  | { readonly ok: false; readonly diagnostics: readonly ParseDiagnostic[] } {
  const range = pslSpanToRange(span, sourceFile);
  const declared = descriptor.attributes ?? {};
  if (!Object.hasOwn(declared, name)) {
    return {
      ok: false,
      diagnostics: [
        {
          code: 'PSL_EXTENSION_UNKNOWN_BLOCK_ATTRIBUTE',
          message: `Unknown attribute "@@${name}" in "${keyword}" block "${blockName}"`,
          range,
        },
      ],
    };
  }
  if (Object.hasOwn(parsedSoFar, name)) {
    return {
      ok: false,
      diagnostics: [
        {
          code: 'PSL_INVALID_EXTENSION_BLOCK_ATTRIBUTE',
          message: `Duplicate attribute "@@${name}" in "${keyword}" block "${blockName}"; first occurrence wins`,
          range,
        },
      ],
    };
  }
  const factory = blindCast<
    BlockAttributeSpecFactory,
    'framework core cannot name AttributeSpec, so block-attribute factories transit the descriptor erased as unknown; this is the single point that restores the factory type the descriptor surface documents'
  >(declared[name]);
  const result = interpretAttribute(attribute, factory(), {
    level: 'block',
    sourceId: BLOCK_ATTRIBUTE_SOURCE_ID,
    sourceFile,
  });
  if (!result.ok) {
    return {
      ok: false,
      diagnostics: result.failure.map((diagnostic) => toParseDiagnostic(diagnostic, sourceFile)),
    };
  }
  return { ok: true, value: { args: result.value, span } };
}

function toParseDiagnostic(diagnostic: PslDiagnostic, sourceFile: SourceFile): ParseDiagnostic {
  return {
    code: diagnostic.code,
    message: diagnostic.message,
    range: pslSpanToRange(diagnostic.span, sourceFile),
  };
}

function pslSpanToRange(span: PslSpan, sourceFile: SourceFile): Range {
  return {
    start: sourceFile.positionAt(span.start.offset),
    end: sourceFile.positionAt(span.end.offset),
  };
}

function reconstructParamValue(
  entry: KeyValuePairAst,
  param: PslBlockParam | undefined,
  span: PslSpan,
  sourceFile: SourceFile,
  diagnostics: ParseDiagnostic[],
): PslExtensionBlockParamValue {
  const value = entry.value();
  if (value === undefined) {
    return { kind: 'bare', span };
  }
  return reconstructFromExpression(value, param, span, sourceFile, diagnostics);
}

function reconstructFromExpression(
  value: ExpressionAst,
  param: PslBlockParam | undefined,
  span: PslSpan,
  sourceFile: SourceFile,
  diagnostics?: ParseDiagnostic[],
): PslExtensionBlockParamValue {
  const raw = printSyntax(value.syntax).trim();
  if (param?.kind === 'list') {
    const array = ArrayLiteralAst.cast(value.syntax);
    if (!array) {
      diagnostics?.push({
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
          nodePslSpan(element.syntax, sourceFile),
          sourceFile,
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
