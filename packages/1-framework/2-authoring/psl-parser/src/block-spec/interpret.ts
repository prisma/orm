import type {
  AuthoringPslBlockDescriptor,
  AuthoringPslBlockDescriptorNamespace,
} from '@internal/framework-components/authoring';
import type {
  ParsedPslExtensionBlock,
  PslExtensionBlockParsedAttribute,
  PslSpan,
} from '@internal/framework-components/psl-ast';
import { blindCast } from '@internal/utils/casts';
import { notOk, ok, type Result } from '@internal/utils/result';
import { interpretAttribute, isOptionalArgType } from '../attribute-spec/interpret';
import type { BlockAttributeSpecFactory } from '../attribute-spec/spec-context';
import type { AttributeCtx } from '../attribute-spec/types';
import { diagnosticSource, type PslDiagnostic } from '../diagnostic';
import { findBlockDescriptor } from '../extension-block';
import { nodePslSpan } from '../resolve';
import type { PslSources } from '../source-file';
import type { BlockSymbol, SymbolTable } from '../symbol-table';
import type { AstNode } from '../syntax/ast-helpers';
import { blockSpecFactoryOf } from './descriptor';
import type { BlockSpec, InferBlock } from './types';

export interface InterpretExtensionBlockInput<S> {
  readonly block: BlockSymbol;
  readonly descriptor: AuthoringPslBlockDescriptor;
  readonly spec: S;
  readonly symbols: SymbolTable;
  readonly sources: PslSources;
}

/**
 * Binds one registered block's entries and `@@` attributes directly from the
 * AST against its spec. Successful interpretation yields the typed envelope;
 * any failure yields the full diagnostic list instead — an invalid block has
 * no partially-valid envelope.
 *
 * Span ownership: an expression failure carries the expression's own span
 * (minted by the value rule), duplicate/unknown/bare-key failures carry the
 * entry span, and a missing required key carries the block span.
 */
export function interpretExtensionBlock<S extends BlockSpec<unknown>>(
  input: InterpretExtensionBlockInput<S>,
): Result<ParsedPslExtensionBlock<InferBlock<S>>, readonly PslDiagnostic[]> {
  const { block, descriptor, spec, symbols, sources } = input;
  const ctx: AttributeCtx = { sources, symbols };
  const diagnostics: PslDiagnostic[] = [];
  const values: Record<string, unknown> = Object.create(null);
  const parameterSpans: Record<string, PslSpan> = Object.create(null);
  const seen = new Set<string>();

  for (const entry of block.node.entries()) {
    const key = entry.key()?.name();
    if (key === undefined) continue;
    const span = nodePslSpan(entry.syntax, sources);
    if (seen.has(key)) {
      diagnostics.push(
        entryDiagnostic(
          'PSL_EXTENSION_DUPLICATE_PARAMETER',
          `Duplicate parameter "${key}" in "${block.keyword}" block "${block.name}"; first occurrence wins`,
          ctx,
          entry,
          span,
        ),
      );
      continue;
    }
    seen.add(key);

    const rule =
      spec.mode === 'fixed'
        ? Object.hasOwn(spec.parameters, key)
          ? spec.parameters[key]?.type
          : undefined
        : spec.value.type;
    if (rule === undefined) {
      diagnostics.push(
        entryDiagnostic(
          'PSL_EXTENSION_UNKNOWN_PARAMETER',
          `Unknown parameter "${key}" in "${block.keyword}" block "${block.name}". The block does not declare this parameter.`,
          ctx,
          entry,
          span,
        ),
      );
      continue;
    }

    parameterSpans[key] = span;
    const value = entry.value();
    if (value === undefined) {
      if (spec.mode === 'entries' && spec.allowBare) {
        values[key] = undefined;
        continue;
      }
      diagnostics.push(
        entryDiagnostic(
          'PSL_INVALID_EXTENSION_BLOCK_MEMBER',
          `Parameter "${key}" in "${block.keyword}" block "${block.name}" must be written as "${key} = <value>".`,
          ctx,
          entry,
          span,
        ),
      );
      continue;
    }
    const parsed = rule.parse(value, ctx);
    if (parsed.ok) values[key] = parsed.value;
    else diagnostics.push(...parsed.failure);
  }

  if (spec.mode === 'fixed') {
    for (const [key, param] of Object.entries(spec.parameters)) {
      if (seen.has(key)) continue;
      if (isOptionalArgType(param.type)) {
        if (param.type.hasDefault) values[key] = param.type.defaultValue;
        continue;
      }
      diagnostics.push(
        entryDiagnostic(
          'PSL_EXTENSION_MISSING_REQUIRED_PARAMETER',
          `Required parameter "${key}" is missing from "${block.keyword}" block "${block.name}".`,
          ctx,
          block.node,
          block.span,
        ),
      );
    }
  }

  const interpretedAttributes = interpretExtensionBlockAttributes({
    block,
    descriptor,
    symbols,
    sources,
  });
  diagnostics.push(...interpretedAttributes.diagnostics);

  if (diagnostics.length > 0) {
    return notOk<readonly PslDiagnostic[]>(diagnostics);
  }
  return ok({
    kind: descriptor.discriminator,
    keyword: block.keyword,
    name: block.name,
    values: blindCast<
      InferBlock<S>,
      'The interpreter builds the output record structurally from the spec; TypeScript cannot relate the dynamically-keyed record to the spec-inferred output type.'
    >(values),
    parameterSpans,
    attributes: interpretedAttributes.attributes,
    span: block.span,
  });
}

export interface InterpretExtensionBlockAttributesInput {
  readonly block: BlockSymbol;
  readonly descriptor: AuthoringPslBlockDescriptor;
  readonly symbols: SymbolTable;
  readonly sources: PslSources;
}

/**
 * Interprets the `@@` attributes a block declares against the descriptor's
 * attribute spec factories, each bound with the complete
 * `{ symbols, block }` context. Failed attributes surface as diagnostics and
 * leave no entry; the first occurrence of a duplicate name wins.
 */
export function interpretExtensionBlockAttributes(input: InterpretExtensionBlockAttributesInput): {
  readonly attributes: Readonly<Record<string, PslExtensionBlockParsedAttribute>>;
  readonly diagnostics: readonly PslDiagnostic[];
} {
  const { block, descriptor, symbols, sources } = input;
  const declared = descriptor.attributes ?? {};
  const attributes: Record<string, PslExtensionBlockParsedAttribute> = Object.create(null);
  const diagnostics: PslDiagnostic[] = [];
  const seenNames = new Set<string>();

  for (const attribute of block.node.attributes()) {
    const name = attribute.name()?.path().join('.') ?? '';
    const span = nodePslSpan(attribute.syntax, sources);
    if (!Object.hasOwn(declared, name)) {
      diagnostics.push({
        code: 'PSL_EXTENSION_UNKNOWN_BLOCK_ATTRIBUTE',
        message: `Unknown attribute "@@${name}" in "${block.keyword}" block "${block.name}"`,
        ...diagnosticSource(sources, attribute.syntax).at(span),
      });
      continue;
    }
    if (seenNames.has(name)) {
      diagnostics.push({
        code: 'PSL_INVALID_EXTENSION_BLOCK_ATTRIBUTE',
        message: `Duplicate attribute "@@${name}" in "${block.keyword}" block "${block.name}"; first occurrence wins`,
        ...diagnosticSource(sources, attribute.syntax).at(span),
      });
      continue;
    }
    seenNames.add(name);
    const factory = blindCast<
      BlockAttributeSpecFactory,
      'framework core cannot name AttributeSpec, so block-attribute factories transit the descriptor erased as unknown; this is the single point that restores the factory type the descriptor surface documents'
    >(declared[name]);
    const result = interpretAttribute(attribute, factory({ symbols, block }), {
      sources,
      symbols,
    });
    if (result.ok) {
      attributes[name] = { args: result.value, span };
    } else {
      diagnostics.push(...result.failure);
    }
  }

  return { attributes, diagnostics };
}

function entryDiagnostic(
  code: PslDiagnostic['code'],
  message: string,
  ctx: AttributeCtx,
  node: AstNode,
  span: PslSpan,
): PslDiagnostic {
  return { code, message, ...diagnosticSource(ctx.sources, node.syntax).at(span) };
}

export interface InterpretExtensionBlocksResult {
  readonly parsedBlocks: ReadonlyMap<BlockSymbol, ParsedPslExtensionBlock>;
  readonly diagnostics: readonly PslDiagnostic[];
}

/**
 * The canonical block-resolution function: consumers resolve registered
 * blocks against an already-collected table, exactly as attributes are
 * resolved by their consumers. Binds each registered block's spec and
 * interprets its values and `@@` attributes; only successes enter the map,
 * and every value/attribute failure is returned once as diagnostics — the
 * caller owns their reporting. Unregistered keywords are skipped. Spec
 * factories see the complete table and never observe another block's
 * interpreted output.
 */
export function interpretExtensionBlocks(
  symbolTable: SymbolTable,
  sources: PslSources,
  pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace,
): InterpretExtensionBlocksResult {
  const parsedBlocks = new Map<BlockSymbol, ParsedPslExtensionBlock>();
  const diagnostics: PslDiagnostic[] = [];
  const scopes = [symbolTable.topLevel, ...Object.values(symbolTable.topLevel.namespaces)];
  for (const scope of scopes) {
    for (const block of Object.values(scope.blocks)) {
      const descriptor = findBlockDescriptor(pslBlockDescriptors, block.keyword);
      if (descriptor === undefined) continue;
      const spec = blockSpecFactoryOf(descriptor)({ symbols: symbolTable, block });
      const parsed = interpretExtensionBlock({
        block,
        descriptor,
        spec,
        symbols: symbolTable,
        sources,
      });
      if (parsed.ok) parsedBlocks.set(block, parsed.value);
      else diagnostics.push(...parsed.failure);
    }
  }
  return { parsedBlocks, diagnostics };
}
